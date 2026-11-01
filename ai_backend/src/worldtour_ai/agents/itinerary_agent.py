"""Day timetables built deterministically from recommendation places (no LLM; the day writer adds prose afterwards)."""

from __future__ import annotations

from worldtour_ai.agents.base_agent import BaseAgent
from datetime import timedelta

from worldtour_ai.data.cost_levels import DAILY_ESTIMATE, DEFAULT_DAILY
from worldtour_ai.data.places import lookup_place
from worldtour_ai.services.itinerary_composer import (
    build_timetable,
    catalog_from_places,
    city_change_blocks,
    city_per_day,
    day_windows,
    endpoint_blocks,
    plan_days,
    RoadTimes,
    present_days,
)
from worldtour_ai.providers.factory import RoutingGateway
from worldtour_ai.services.request_parser import trip_start
from worldtour_ai.services.transport import local_rates
from worldtour_ai.services.weather_conflicts import is_bad_weather
from worldtour_ai.tools.toolkit import schedule_tool
from worldtour_ai.utils.events import AGENT_PROGRESS, make_event
from worldtour_ai.utils.money import format_money

HOT_DAY_C = 35
MAX_ROUTED_POINTS = 60  # the public OSRM table service accepts up to 100 coordinates


class ItineraryAgent(BaseAgent):
    agent_id = "ITINERARY_AGENT"
    agent_name = "Itinerary Agent"
    responsibilities = [
        "Pick the best recommended places for the available time, by pace",
        "Group nearby places on the same day and keep outdoor sights off rainy days and hot middays",
        "Build an exact timetable: transfers by walk or cab, visits, meals, check-in, city changes and departure",
    ]
    algorithms = ["Nearest Neighbour", "Greedy", "Interval Scheduling"]
    tools = ["schedule_tool"]
    provider = "None (the day writer step adds AI descriptions afterwards)"
    llm_role = "None. The timetable is exact and built without the LLM."

    @staticmethod
    def _road_times(plans: list[dict], stays: dict) -> RoadTimes | None:
        """One routing-service table for every place the days may visit and the hotels, so legs use real roads.

        Returns None (the timetable then falls back to labelled straight-line estimates) when OSRM is off or fails.
        """
        points, seen = [], set()
        for stay in stays.values():
            if stay and stay.get("lat") is not None:
                points.append({"lat": stay["lat"], "lon": stay["lon"]})
        for plan in plans:
            for item in list(plan.get("sights") or []) + ([plan["dinner"]] if plan.get("dinner") else []):
                if item.get("lat") is not None:
                    points.append({"lat": item["lat"], "lon": item["lon"]})
        unique = []
        for point in points:
            key = RoadTimes._key(point["lat"], point["lon"])
            if key not in seen:
                seen.add(key)
                unique.append(point)
        if len(unique) < 2 or len(unique) > MAX_ROUTED_POINTS:
            return None
        try:
            table = RoutingGateway().table(unique)
        except Exception:
            return None
        if table.get("provider_used") != "osrm" or table.get("fallback_reason"):
            return None  # only measured road data counts; the local fallback is just another straight-line guess
        return RoadTimes([(p["lat"], p["lon"]) for p in unique], table.get("distances_m") or [], table.get("durations_s") or [])

    def execute(self, state: dict) -> dict:
        request = state.get("parsed_request") or {}
        events = [self.started("Planning the days from recommended places")]
        budget = state.get("budget_result") or {}
        currency, rate = budget.get("display_currency") or "USD", budget.get("usd_to_display") or 1.0

        def money(amount_usd: float) -> str:
            return format_money(amount_usd, currency, rate, approx=True)

        places = (state.get("recommendation_result") or {}).get("places") or []
        costs = {item.get("id"): float(item.get("cost") or 0) for item in budget.get("selected_items") or []}
        if "selected_items" in budget:
            # The knapsack decides which paid places fit the budget; free places are always allowed.
            unaffordable = {item.get("id") for item in budget.get("rejected_items") or []}
            places = [p for p in places if p.get("place_id") in costs or p.get("place_id") not in unaffordable]
        catalog = catalog_from_places(places, request.get("excluded_places"))
        day_count = max(int(request.get("duration_days") or 1), 1)
        travelers = int(request.get("travelers") or 1)
        cities = [name for name in (request.get("cities") or []) if name] or [request.get("destination")]
        day_cities = city_per_day(cities, day_count)
        place = lookup_place(cities[0]) or lookup_place(request.get("destination"))
        country = place.country if place else None
        rates = DAILY_ESTIMATE.get(country or "", DEFAULT_DAILY)
        hotels = (state.get("hotel_result") or {}).get("options") or []
        recommended_ids = budget.get("recommended_hotel_ids") or [budget.get("recommended_hotel_id")]
        weather = state.get("weather_result") or {}
        rows = {row.get("day"): row for row in weather.get("days") or [] if row.get("day")}
        bad_days = {day for day, row in rows.items() if is_bad_weather(row)}
        hot_days = {day for day, row in rows.items() if (row.get("temp_max_c") or 0) >= HOT_DAY_C}

        start_blocks, end_blocks = endpoint_blocks(
            budget.get("transport"), state.get("flight_result"), day_count,
            request.get("origin"), day_cities[0], country, travelers,
        )
        legs = {(leg.get("to") or ""): leg for leg in (budget.get("intercity") or {}).get("legs") or []}
        for index in range(1, day_count):
            if day_cities[index] != day_cities[index - 1]:
                leg = legs.get(day_cities[index]) or {"from": day_cities[index - 1], "to": day_cities[index]}
                start_blocks.setdefault(index + 1, []).extend(city_change_blocks(leg, 9 * 60, country, travelers))
        windows = day_windows(start_blocks, end_blocks, day_count, request.get("pace"))
        stays = {city: _stay_for_day(hotels, recommended_ids, city) for city in dict.fromkeys(day_cities)}
        anchors = {city: (stay["lat"], stay["lon"]) for city, stay in stays.items() if stay and stay.get("lat") is not None}
        plans = plan_days(
            catalog, day_cities, windows, request.get("pace"), bad_days, hot_days,
            bool((state.get("adjustments") or {}).get("force_indoor")), anchors,
        )
        roads = self._road_times(plans, stays)
        warnings = []
        if not catalog:
            warnings.append("No attractions were available, so the days only show travel, meals and the hotel.")
        daily, algorithms, local_total = [], ["Nearest Neighbour"] if catalog else [], 0.0
        for day_number, city in enumerate(day_cities, start=1):
            index = day_number - 1
            full_day = not start_blocks.get(day_number)
            entries = start_blocks.get(day_number, []) + build_timetable(
                plans[index], windows[index], stays.get(city), country, travelers,
                request.get("pace"), rates["food"], full_day, roads,
            ) + end_blocks.get(day_number, [])
            if entries:
                try:
                    scheduled = self.invoke(schedule_tool, {"intervals": entries})
                except Exception as exc:
                    events.append(self.failed(str(exc)))
                    return {"itinerary_result": None, "errors": [str(exc)], "agent_execution_history": events}
                algorithms.extend(scheduled.get("algorithms_executed") or [])
                entries = sorted(scheduled.get("selected") or [], key=lambda item: item["start"])
            day_transport = sum(float(e.get("cost_usd") or 0) for e in entries if e.get("category") == "transfer")
            local_total += day_transport
            daily.append(
                {
                    "day": day_number,
                    # From the traveler's start date, not from the forecast, so it is right even without weather data.
                    "date": (trip_start(request)[0] + timedelta(days=day_number - 1)).isoformat() if request.get("start_date") else None,
                    "city": city,
                    "stay": stays.get(city),
                    "weather": rows.get(day_number),
                    "local_transport_usd": round(day_transport, 2),
                    "activities": [
                        {
                            "activity_id": item.get("activity_id"),
                            "name": item.get("name"),
                            "day": day_number,
                            "slot": item.get("slot"),
                            "start_minute": item["start"],
                            "end_minute": item["end"],
                            "category": item.get("category"),
                            "detail": item.get("detail") or "",
                            "cost_usd": item.get("cost_usd"),
                            "mode": item.get("mode"),
                            "lat": item.get("lat"),
                            "lon": item.get("lon"),
                            # Where the fact comes from: provider (a real map/flight record), road_routing (measured
                            # by OSRM) or estimate (calculated here from distance or typical prices).
                            "source": item.get("source") or _default_source(item),
                        }
                        for item in entries
                    ],
                }
            )
        present_days(daily, money)
        # Not AGENT_COMPLETED yet: the day writer finishes this step after the weather recheck, so the step
        # only turns green when the days really are final.
        events.append(make_event(AGENT_PROGRESS, self.agent_id, "Timetable built. Writing the day descriptions"))
        scheduled_ids = {a["activity_id"] for day in daily for a in day["activities"]}
        paid = [costs[i] for i in scheduled_ids if costs.get(i)]
        return {
            "itinerary_result": {
                "days": daily,
                "paid_activities_usd": round(sum(paid), 2),
                "paid_activities_count": len(paid),
                "local_transport_usd": round(local_total, 2),
                "local_transport_mode": local_rates(country)["name"],
                "daily_spend": {
                    **rates,
                    "detail": f"Food is about {money(rates['food'])} per person per day (planning estimate). "
                    f"Local transport is the sum of the cab rides in the timetable ({local_rates(country)['name']}).",
                },
                "algorithms_executed": list(dict.fromkeys(algorithms)),
            },
            "warnings": warnings,
            "agent_execution_history": events,
        }


def _default_source(item: dict) -> str:
    if item.get("activity_id") in ("flight:outbound", "flight:return"):
        return "provider"  # flight number, airline and times come from the flight provider
    return "estimate"


def weather_lines(state: dict) -> dict:
    weather = state.get("weather_result") or {}
    return {row.get("day"): _weather_line(row, weather.get("data_source")) for row in weather.get("days") or [] if row.get("day")}


def money_formatter(state: dict):
    budget = state.get("budget_result") or {}
    currency, rate = budget.get("display_currency") or "USD", budget.get("usd_to_display") or 1.0
    return lambda amount_usd: format_money(amount_usd, currency, rate, approx=True)


def _weather_line(row: dict, source: str | None) -> str:
    text = f"{row.get('condition', 'unknown')}, {row.get('temp_min_c')}–{row.get('temp_max_c')} °C, rain {row.get('precipitation_probability')}%"
    if row.get("source") == "seasonal_historical" or source == "seasonal_historical":
        text += " (typical for the date, not a forecast)"
    if (row.get("temp_max_c") or 0) >= HOT_DAY_C:
        text += "; very hot, keep midday indoors"
    return text


def _stay_for_day(hotels: list[dict], recommended_ids: list, city: str | None) -> dict | None:
    if not hotels:
        return None
    key = (city or "").strip().lower()
    in_city = [hotel for hotel in hotels if (hotel.get("city") or "").strip().lower() == key] or hotels
    hotel = next((item for item in in_city if item.get("option_id") in recommended_ids), in_city[0])
    return {
        "option_id": hotel.get("option_id"),
        "name": hotel.get("name"),
        "area": hotel.get("area"),
        "price_per_night": hotel.get("price_per_night"),
        "tier": hotel.get("tier"),
        "lat": hotel.get("lat"),
        "lon": hotel.get("lon"),
    }
