"""Builds a WorldTour graph from routing data, then runs Dijkstra and A*."""

from __future__ import annotations

from worldtour_ai.agents.base_agent import BaseAgent
from worldtour_ai.data.places import lookup_place
from worldtour_ai.tools.toolkit import route_optimization_tool


class RouteAgent(BaseAgent):
    agent_id = "ROUTE_AGENT"
    agent_name = "Route Agent"
    responsibilities = [
        "Collect routing data",
        "Construct the optimization graph",
        "Run Dijkstra and A*",
        "Measure distances between trip cities for the Budget Agent",
    ]
    algorithms = ["Dijkstra", "A*"]
    tools = ["route_optimization_tool"]
    provider = "OSRM"
    llm_role = "Does not claim a shortest path. Dijkstra and A* return it."

    def execute(self, state: dict) -> dict:
        request = state.get("parsed_request") or {}
        events = [self.started("Building the route graph")]
        places = []
        # The hotel is chosen later by the Budget Agent, so the graph starts from the city centre.
        anchor = lookup_place((request.get("cities") or [None])[0] or request.get("destination"))
        if anchor and anchor.lat is not None:
            places.append({"id": "center", "name": f"{anchor.name} centre", "lat": anchor.lat, "lon": anchor.lon})
        city_sequence = []
        for city in request.get("cities") or []:
            found = lookup_place(city)
            if found and found.lat is not None:
                places.append({"id": f"city:{found.name}", "name": found.name, "lat": found.lat, "lon": found.lon})
                city_sequence.append(f"city:{found.name}")
        for place in (state.get("recommendation_result") or {}).get("places") or []:
            if place.get("lat") is None:
                continue
            places.append(
                {
                    "id": place.get("place_id") or place.get("name"),
                    "name": place.get("name"),
                    "lat": place["lat"],
                    "lon": place["lon"],
                }
            )
        unique = []
        seen = set()
        for place in places:
            if place["id"] in seen:
                continue
            seen.add(place["id"])
            unique.append(place)
        try:
            result = self.invoke(
                route_optimization_tool,
                {
                    "places": unique[:12],
                    "city_sequence": city_sequence,
                    "include_trip": len(request.get("cities") or []) >= 3,
                },
            )
        except Exception as exc:
            events.append(self.failed(str(exc)))
            return {"route_result": None, "errors": [str(exc)], "agent_execution_history": events}
        warnings = []
        if result.get("data_source") == "local_graph_fallback":
            warnings.append("Route distances came from the local graph fallback, not a live OSRM calculation.")
        events.append(self.completed("Dijkstra and A* finished"))
        return {"route_result": result, "warnings": warnings, "agent_execution_history": events}
