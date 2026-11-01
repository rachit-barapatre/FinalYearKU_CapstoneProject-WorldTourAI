"""Attraction discovery. BFS, DFS, and Top-K run on the place graph."""

from __future__ import annotations

from worldtour_ai.agents.base_agent import BaseAgent
from worldtour_ai.data.places import lookup_place
from worldtour_ai.tools.toolkit import places_tool


class RecommendationAgent(BaseAgent):
    agent_id = "RECOMMENDATION_AGENT"
    agent_name = "Recommendation Agent"
    responsibilities = ["Discover attractions", "Filter by preferences", "Return the top places"]
    algorithms = ["BFS", "DFS", "Top-K", "Sorting"]
    tools = ["places_tool"]
    provider = "Geoapify"
    llm_role = "Does not rank places. BFS, DFS, and Top-K do."

    def execute(self, state: dict) -> dict:
        request = state.get("parsed_request") or {}
        names = list(request.get("cities") or []) or [request.get("destination")]
        located = [place for place in (lookup_place(name) for name in names[:4]) if place]
        events = [self.started("Finding attractions")]
        if not located:
            events.append(self.failed("No city to search"))
            return {"recommendation_result": None, "warnings": ["No located city for recommendations."], "agent_execution_history": events}
        preferences = request.get("preferences") or request.get("activity_preferences") or []
        slots = {"relaxed": 2, "balanced": 3, "packed": 4}.get(request.get("pace") or "balanced", 3)
        days = int(request.get("duration_days") or 3)
        per_city = min(30, max(8, -(-days * slots // len(located)) + 4))
        excluded = [name.strip().lower() for name in request.get("excluded_places") or [] if name.strip()]
        if "traveling with children" not in (request.get("special_requirements") or []) and request.get("trip_type") != "family":
            # Children's venues only when the request mentions children or a family trip.
            excluded += ["kidzania", "kids", "children", "playland", "play area", "toy"]
        result: dict = {}
        places: list[dict] = []
        algorithms: list[str] = []
        for place in located:
            try:
                found = self.invoke(
                    places_tool,
                    {"city": place.name, "lat": place.lat, "lon": place.lon, "preferences": preferences, "limit": per_city},
                )
            except Exception as exc:
                events.append(self.failed(f"{place.name}: {exc}"))
                continue
            result = result or found
            kept = [item for item in found.get("places") or [] if not any(word in item.get("name", "").lower() for word in excluded)]
            for item in kept[:per_city]:
                item["city"] = place.name
                item["place_id"] = f"{place.name}:{item.get('place_id')}"
                places.append(item)
            algorithms.extend(found.get("algorithms_executed") or [])
        if not places:
            events.append(self.failed("No attractions returned"))
            return {"recommendation_result": None, "errors": ["No attractions returned"], "agent_execution_history": events}
        result = {**result, "places": places, "algorithms_executed": list(dict.fromkeys(algorithms))}
        warnings = []
        events.append(self.completed("BFS, DFS, and Top-K finished"))
        return {"recommendation_result": result, "warnings": warnings, "agent_execution_history": events}
