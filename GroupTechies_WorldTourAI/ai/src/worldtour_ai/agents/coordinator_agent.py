"""Decides which registered agents are required for this request."""

from __future__ import annotations

from worldtour_ai.agents.base_agent import BaseAgent
from worldtour_ai.algorithms.graphs.geo import haversine_km
from worldtour_ai.data.places import lookup_place

# Closer than this within one country, a flight is never quicker than road or rail.
DOMESTIC_FLIGHT_MIN_KM = 150


class CoordinatorAgent(BaseAgent):
    agent_id = "COORDINATOR_AGENT"
    agent_name = "Coordinator Agent"
    responsibilities = [
        "Receive the parsed request",
        "Choose the agents required for this request",
        "Record failures and hand results to the finalizer",
    ]
    algorithms = ["LangGraph StateGraph"]
    tools = []
    provider = "none"
    llm_role = "Does not choose routes or budgets. The workflow graph controls execution."

    def ground_wanted(self, request: dict) -> bool:
        """Trains, buses and cabs for domestic trips, and for nearby international ones (under 1,000 km)."""
        origin = lookup_place(request.get("origin"))
        destination = lookup_place(request.get("destination")) or lookup_place((request.get("cities") or [None])[0])
        if not origin or not destination or origin.name == destination.name or None in (origin.lat, destination.lat):
            return False
        if origin.country == destination.country:
            return True
        return haversine_km(origin.lat, origin.lon, destination.lat, destination.lon) <= 1000

    def flight_skip_reason(self, request: dict) -> str | None:
        origin = lookup_place(request.get("origin"))
        destination = lookup_place(request.get("destination")) or lookup_place((request.get("cities") or [None])[0])
        if not request.get("origin"):
            return "Flights were not searched because no origin city was given."
        if not origin:
            return f"Flights were not searched because '{request.get('origin')}' is not in the airport catalog yet."
        if not destination:
            return f"Flights were not searched because '{request.get('destination')}' is not in the airport catalog yet."
        if origin.name == destination.name:
            return "Flights were not searched because origin and destination are the same place."
        prefs = set(request.get("transport_preferences") or [])
        domestic = origin.country == destination.country
        if not domestic and prefs and not prefs & {"flight"} and prefs & {"road", "train", "bus", "cab"} and self.ground_wanted(request):
            return "Flights were not searched because you asked to travel by " + "/".join(sorted(prefs)) + "."
        if origin.lat is not None and destination.lat is not None and domestic:
            distance = haversine_km(origin.lat, origin.lon, destination.lat, destination.lon)
            if distance <= DOMESTIC_FLIGHT_MIN_KM:
                return f"Flights were not searched because {origin.name} to {destination.name} is about {distance:.0f} km. Road or rail is more practical."
        return None

    def select_agents(self, request: dict) -> list[str]:
        agents = []
        origin = lookup_place(request.get("origin"))
        destination = lookup_place(request.get("destination")) or lookup_place((request.get("cities") or [None])[0])
        prefs = set(request.get("transport_preferences") or [])
        ground = self.ground_wanted(request)
        domestic = bool(origin and destination and origin.country == destination.country)
        # Within one country the traveler always sees flights next to trains and buses, even after asking for a
        # train: the preference picks the default option, and they can still compare and switch.
        ground_only = bool(prefs) and "flight" not in prefs and bool(prefs & {"road", "train", "bus", "cab"}) and ground and not domestic
        days = request.get("duration_days") or 0
        distance = None
        if origin and destination and origin.lat is not None and destination.lat is not None:
            distance = haversine_km(origin.lat, origin.lon, destination.lat, destination.lon)
        needs_flight = (
            origin
            and destination
            and origin.name != destination.name
            and not ground_only
            and (distance is None or distance > DOMESTIC_FLIGHT_MIN_KM or not domestic or "flight" in prefs)
        )
        if needs_flight:
            agents.append("FLIGHT_AGENT")
        if ground:
            agents.append("TRANSPORT_AGENT")
        if days > 1:
            agents.append("HOTEL_AGENT")
        if request.get("destination") or request.get("cities"):
            agents.extend(["WEATHER_AGENT", "RECOMMENDATION_AGENT", "ROUTE_AGENT"])
        if days > 1 or request.get("budget") is not None or request.get("preferences"):
            if "BUDGET_AGENT" not in agents:
                agents.append("BUDGET_AGENT")
        if days >= 1 and (request.get("destination") or request.get("cities")):
            agents.append("ITINERARY_AGENT")
        return agents

    def execute(self, state: dict) -> dict:
        request = state.get("parsed_request") or {}
        required = self.select_agents(request)
        warnings = []
        if "FLIGHT_AGENT" not in required:
            reason = self.flight_skip_reason(request)
            if reason:
                warnings.append(reason)
        return {
            "required_agents": required,
            "warnings": warnings,
            "agent_execution_history": [
                self.started("Workflow initialized"),
                self.completed("Required agents: " + ", ".join(required)),
            ],
        }
