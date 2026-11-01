"""Ground travel (train, bus, cab) between the origin and the destination for domestic and nearby trips."""

from __future__ import annotations

from worldtour_ai.agents.base_agent import BaseAgent
from worldtour_ai.data.places import lookup_place
from worldtour_ai.tools.toolkit import ground_transport_tool


class TransportAgent(BaseAgent):
    agent_id = "TRANSPORT_AGENT"
    agent_name = "Ground Transport Agent"
    responsibilities = [
        "Measure the road distance and drive time with OSRM",
        "Price train, bus and cab options from distance",
        "Rank the options with a priority queue",
    ]
    algorithms = ["Priority Queue"]
    tools = ["ground_transport_tool"]
    provider = "OSRM for road distance; per-country fare estimates"
    llm_role = "None. Options and ranking are deterministic."

    def execute(self, state: dict) -> dict:
        request = state.get("parsed_request") or {}
        origin = lookup_place(request.get("origin"))
        destination = lookup_place((request.get("cities") or [None])[0]) or lookup_place(request.get("destination"))
        events = [self.started("Checking trains, buses and cabs")]
        if not origin or not destination:
            events.append(self.failed("Origin or destination could not be located"))
            return {"transport_result": None, "agent_execution_history": events}
        try:
            result = self.invoke(
                ground_transport_tool,
                {"origin": origin.name, "destination": destination.name, "travelers": request.get("travelers") or 1},
            )
        except Exception as exc:
            events.append(self.failed(str(exc)))
            return {"transport_result": None, "errors": [str(exc)], "agent_execution_history": events}
        warnings = []
        if result.get("note"):
            warnings.append(result["note"])
        wanted = {"train", "bus", "cab", "road"} & set(request.get("transport_preferences") or [])
        if wanted and not result.get("options"):
            warnings.append(f"You asked to travel by {', '.join(sorted(wanted))}, but there is no road or rail link, so flights are used.")
        events.append(self.completed(f"{len(result.get('options') or [])} ground option(s) priced"))
        return {"transport_result": result, "warnings": warnings, "agent_execution_history": events}
