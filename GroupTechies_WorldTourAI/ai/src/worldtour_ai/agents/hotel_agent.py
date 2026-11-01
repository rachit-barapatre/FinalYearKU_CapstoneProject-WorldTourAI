"""Hotel search per trip city, ranked with a heap Top-K selection."""

from __future__ import annotations

import contextvars
import math
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

from worldtour_ai.agents.base_agent import BaseAgent
from worldtour_ai.data.places import lookup_place
from worldtour_ai.services.request_parser import trip_start
from worldtour_ai.tools.toolkit import hotel_search_tool

MAX_CITIES = 3
STAY_SHARE = 0.35


class HotelAgent(BaseAgent):
    agent_id = "HOTEL_AGENT"
    agent_name = "Hotel Agent"
    responsibilities = [
        "Ask the OpenRouter model for real hotels that match the request for the destination given",
        "Locate each hotel on Geoapify",
        "Rank them with Top-K",
    ]
    algorithms = ["Heap", "Top-K", "Sorting"]
    tools = ["hotel_search_tool"]
    provider = "Google Hotels via SerpApi; OpenRouter suggestions + Geoapify, then Geoapify places, as fallbacks"
    llm_role = "Suggests hotel candidates and typical rates. Does not pick the hotel. Top-K does."

    def execute(self, state: dict) -> dict:
        request = state.get("parsed_request") or {}
        cities = (request.get("cities") or [])[:MAX_CITIES] or [request.get("destination")]
        days = request.get("duration_days")
        total_nights = request.get("duration_nights") or (max(int(days) - 1, 1) if days else 1)
        base, extra = divmod(max(int(total_nights), 1), len(cities))
        nights_by_city = {city: max(1, base + (1 if index < extra else 0)) for index, city in enumerate(cities)}
        travelers = int(request.get("travelers") or 1)
        rooms = max(1, math.ceil(travelers / 2))
        nightly_target = None
        if request.get("budget"):
            total_budget = float(request["budget"]) * (travelers if request.get("budget_scope") == "per_person" else 1)
            nightly_target = round(total_budget * STAY_SHARE / max(total_nights, 1) / rooms)
        events = [self.started(f"Searching hotels in {', '.join(str(c) for c in cities)}")]
        start, _assumed = trip_start(request)
        check_in, offset = {}, 0
        for city in cities:
            check_in[city] = (start + timedelta(days=offset)).isoformat()
            offset += nights_by_city[city]

        def search(city_name: str) -> dict:
            place = lookup_place(city_name)
            return self.invoke(
                hotel_search_tool,
                {
                    "city": place.name if place else city_name,
                    "lat": place.lat if place else None,
                    "lon": place.lon if place else None,
                    "nights": nights_by_city.get(city_name, 1),
                    "preferences": request.get("preferences") or [],
                    "hotel_preferences": request.get("hotel_preferences") or [],
                    "travelers": request.get("travelers"),
                    "trip_type": request.get("trip_type"),
                    "budget": request.get("budget"),
                    "currency": request.get("currency"),
                    "start_date": request.get("start_date"),
                    "check_in": check_in[city_name],
                    "adults_per_room": 2 if travelers >= 2 else 1,
                    "rooms": rooms,
                    "nightly_target": nightly_target,
                },
            )

        results, errors = [], []
        with ThreadPoolExecutor(max_workers=len(cities)) as pool:
            # copy_context keeps the run_id and agent on the API log lines written from these threads
            futures = [pool.submit(contextvars.copy_context().run, search, city) for city in cities]
            for future in futures:
                try:
                    results.append(future.result())
                except Exception as exc:
                    errors.append(str(exc))
        if not results:
            message = errors[0] if errors else "no hotel results"
            events.append(self.failed(message))
            return {"hotel_result": None, "errors": errors, "agent_execution_history": events}

        options = [option for result in results for option in result.get("options") or []]
        sources = {result.get("data_source") for result in results}
        merged = {
            "provider_used": ", ".join(sorted({str(r.get("provider_used")) for r in results})),
            "data_source": results[0].get("data_source") if len(sources) == 1 else "mixed",
            "options": options,
            "algorithms_executed": results[0].get("algorithms_executed") or [],
            "per_city": [
                {"city": r["options"][0].get("city") if r.get("options") else None, "provider_used": r.get("provider_used"),
                 "data_source": r.get("data_source"), "fallback_reason": r.get("fallback_reason")}
                for r in results
            ],
        }
        warnings = [f"Hotel search failed for one city: {error}" for error in errors]
        events.append(self.completed(f"Top-K hotel ranking finished for {len(results)} city(ies)"))
        return {"hotel_result": merged, "warnings": warnings, "agent_execution_history": events}
