"""Flight planning: live Google Flights fares (SerpApi) for the trip dates, Aviationstack schedules as fallback."""

from __future__ import annotations

from datetime import timedelta

from worldtour_ai.agents.base_agent import BaseAgent
from worldtour_ai.data.places import lookup_place
from worldtour_ai.services.request_parser import trip_start
from worldtour_ai.tools.toolkit import flight_search_tool


class FlightAgent(BaseAgent):
    agent_id = "FLIGHT_AGENT"
    agent_name = "Flight Agent"
    responsibilities = [
        "Search round-trip fares for the travel dates",
        "Compare price, duration, and stops",
        "Rank options with a priority queue",
    ]
    algorithms = ["Priority Queue", "Sorting"]
    tools = ["flight_search_tool"]
    provider = "Google Flights via SerpApi; Aviationstack schedules as fallback"
    llm_role = "Does not rank flights. The priority queue does."

    def execute(self, state: dict) -> dict:
        request = state.get("parsed_request") or {}
        origin = lookup_place(request.get("origin"))
        destination = lookup_place(request.get("destination")) or lookup_place((request.get("cities") or [None])[0])
        events = [self.started("Searching flight data")]
        if not origin or not destination or not origin.iata or not destination.iata:
            events.append(self.failed("Could not resolve airport codes"))
            return {
                "flight_result": None,
                "warnings": ["Flight search skipped because an airport code was missing."],
                "agent_execution_history": events,
            }
        start, assumed = trip_start(request)
        days = max(int(request.get("duration_days") or 1), 1)
        depart = start.isoformat()
        back = request.get("end_date") or (start + timedelta(days=days - 1)).isoformat()
        try:
            result = self.invoke(
                flight_search_tool,
                {"origin_iata": origin.iata, "destination_iata": destination.iata, "travel_date": depart, "return_date": back},
            )
            for option in result.get("options") or []:
                option["direction"] = "outbound"
            live_fares = result.get("provider_used") == "serpapi_google_flights"
            if not live_fares:
                result["options"] = _prefer_usable_times(result.get("options") or [], "arrival_time", lambda hour: 7 <= hour <= 15)
            if "return_options" not in result:
                # Schedule-only providers search each direction separately.
                returning = self.invoke(
                    flight_search_tool,
                    {"origin_iata": destination.iata, "destination_iata": origin.iata, "travel_date": back},
                )
                result["return_options"] = returning.get("options") or []
            for option in result["return_options"]:
                option["direction"] = "return"
            result["return_options"] = _prefer_usable_times(result["return_options"], "departure_time", lambda hour: 14 <= hour <= 23)
        except Exception as exc:
            events.append(self.failed(str(exc)))
            return {"flight_result": None, "errors": [str(exc)], "warnings": ["Flight search failed: " + str(exc)], "agent_execution_history": events}
        result["dates_assumed"] = assumed
        result["search_dates"] = {"depart": depart, "return": back}
        source = result.get("provider_used")
        events.append(self.completed(f"Ranked outbound and return options from {source}"))
        warnings = []
        if live_fares and assumed:
            warnings.append(f"No travel dates were given, so flight fares are for example dates ({depart} to {back}). They will change for your real dates.")
        elif not live_fares:
            reason = result.get("fallback_reason")
            warnings.append(
                "Live fares were unavailable"
                + (f" ({reason})" if reason else " (add a free SERPAPI_API_KEY for real Google Flights prices)")
                + ", so flight times come from current Aviationstack schedules and fares are distance-based estimates."
            )
        if result.get("return_error"):
            warnings.append(f"Return flight details could not be loaded ({result['return_error']}).")
        return {"flight_result": result, "warnings": warnings, "agent_execution_history": events}


def _prefer_usable_times(options: list[dict], field: str, good_hour) -> list[dict]:
    """Keep the score order, but among equal scores prefer flights that leave usable time at the destination."""

    def hour(option: dict) -> int | None:
        value = str(option.get(field) or "")
        return int(value.split("T", 1)[1][:2]) if "T" in value and value.split("T", 1)[1][:2].isdigit() else None

    return sorted(
        options,
        key=lambda option: (-round(option.get("score") or 0, 3), 0 if hour(option) is not None and good_hour(hour(option)) else 1),
    )
