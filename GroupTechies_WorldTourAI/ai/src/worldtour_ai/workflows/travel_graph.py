"""LangGraph workflow for a single travel request."""

from __future__ import annotations

from langgraph.graph import END, START, StateGraph

from worldtour_ai.agents.budget_agent import BudgetAgent
from worldtour_ai.agents.coordinator_agent import CoordinatorAgent
from worldtour_ai.agents.flight_agent import FlightAgent
from worldtour_ai.agents.hotel_agent import HotelAgent
from worldtour_ai.agents.itinerary_agent import ItineraryAgent
from worldtour_ai.agents.recommendation_agent import RecommendationAgent
from worldtour_ai.agents.route_agent import RouteAgent
from worldtour_ai.agents.transport_agent import TransportAgent
from worldtour_ai.agents.weather_agent import WeatherAgent
from worldtour_ai.config.settings import get_settings
from worldtour_ai.services.constraint_validator import validate_request, validate_schedule
from worldtour_ai.services.finalizer import build_final_plan
from worldtour_ai.services.request_parser import (
    clarification_message,
    missing_essential,
    parse_travel_text,
    user_skipped,
)
from worldtour_ai.services.weather_conflicts import detect_weather_conflicts
from worldtour_ai.utils.events import (
    AGENT_COMPLETED,
    AGENT_STARTED,
    CONSTRAINT_VIOLATION,
    REPLAN_TRIGGERED,
    WORKFLOW_COMPLETED,
    WORKFLOW_STARTED,
    make_event,
)
from worldtour_ai.utils.agent_logs import agent_span
from worldtour_ai.workflows.state import TravelState


def _transcript(history: list[dict]) -> str:
    return "\n".join(item.get("content", "") for item in history if item.get("role") == "user")


def _guard(agent, state: dict) -> dict:
    if agent.agent_id not in (state.get("required_agents") or []):
        return {}
    try:
        with agent_span(agent.agent_id, state.get("run_id")) as span:
            span["result"] = agent.execute(state)
        return span["result"]
    except Exception as exc:
        return {
            "errors": [f"{agent.agent_id}: {exc}"],
            "warnings": [f"{agent.agent_id} failed and the workflow continued."],
            "agent_execution_history": [make_event("AGENT_FAILED", agent.agent_id, str(exc))],
        }


def request_parser(state: TravelState) -> dict:
    if state.get("request_ready") and state.get("parsed_request"):
        # The chat intake already collected and parsed every constraint.
        return {
            "parsed_request": dict(state["parsed_request"]),
            "missing_fields": [],
            "needs_clarification": False,
            "clarification_question": "",
            "pending_fields": [],
            "agent_execution_history": [
                make_event(WORKFLOW_STARTED, "COORDINATOR_AGENT", "Workflow started"),
                make_event(AGENT_STARTED, "REQUEST_PARSER", "Using the details collected in the chat"),
                make_event(AGENT_COMPLETED, "REQUEST_PARSER", "Request understood"),
            ],
        }
    history = state.get("conversation_history") or []
    text = _transcript(history) or state.get("original_user_request") or ""
    last_user = ""
    for item in reversed(history):
        if item.get("role") == "user":
            last_user = item.get("content") or ""
            break
    pending = list(state.get("pending_fields") or [])
    if pending and last_user:
        text = last_user
    if pending and user_skipped(last_user):
        previous = dict(state.get("parsed_request") or {})
        notes = list(previous.get("parser_notes") or [])
        notes.append("You chose to continue without: " + ", ".join(pending) + ".")
        previous["parser_notes"] = notes
        if "budget" in pending:
            previous["budget_is_user_stated"] = False
        if "origin" in pending and previous.get("destination"):
            previous["origin"] = previous.get("origin")
        request = parse_travel_text(text, pending_fields=[], previous=previous)
    else:
        request = parse_travel_text(text, pending_fields=pending, previous=state.get("parsed_request"))
    if user_skipped(last_user):
        data = request.model_dump()
        if "budget" in pending:
            data["budget"] = None
            data["budget_is_user_stated"] = False
        if "origin" in pending:
            data["origin"] = data.get("origin")
        request_data = data
    else:
        request_data = request.model_dump()
    from worldtour_ai.schemas.models import TravelRequest

    model = TravelRequest.model_validate(request_data)
    missing = missing_essential(model)
    if user_skipped(last_user):
        missing = [field for field in missing if field not in pending]
    events = []
    if not state.get("resume"):
        events.append(make_event(WORKFLOW_STARTED, "COORDINATOR_AGENT", "Workflow started"))
    events.append(make_event(AGENT_STARTED, "REQUEST_PARSER", "Understanding the request"))
    if missing and not state.get("resume"):
        question = clarification_message(missing)
        events.append(make_event(AGENT_COMPLETED, "REQUEST_PARSER", "More detail is needed before optimization"))
        return {
            "parsed_request": request_data,
            "missing_fields": missing,
            "needs_clarification": True,
            "clarification_question": question,
            "pending_fields": missing,
            "agent_execution_history": events,
        }
    if missing and state.get("resume"):
        # A resumed turn still missing essentials gets one more question.
        question = clarification_message(missing)
        events.append(make_event(AGENT_COMPLETED, "REQUEST_PARSER", "Still missing required details"))
        return {
            "parsed_request": request_data,
            "missing_fields": missing,
            "needs_clarification": True,
            "clarification_question": question,
            "pending_fields": missing,
            "agent_execution_history": events,
        }
    events.append(make_event(AGENT_COMPLETED, "REQUEST_PARSER", "Request understood"))
    return {
        "parsed_request": request_data,
        "missing_fields": [],
        "needs_clarification": False,
        "clarification_question": "",
        "pending_fields": [],
        "agent_execution_history": events,
    }


def constraint_validator(state: TravelState) -> dict:
    if state.get("needs_clarification"):
        return {}
    result = validate_request(state.get("parsed_request") or {})
    events = [
        make_event(AGENT_STARTED, "CONSTRAINT_VALIDATOR", "Validating constraints"),
        make_event(AGENT_COMPLETED, "CONSTRAINT_VALIDATOR", "Constraints checked"),
    ]
    if result["violations"]:
        events.append(
            make_event(CONSTRAINT_VIOLATION, "CONSTRAINT_VALIDATOR", "; ".join(item["message"] for item in result["violations"]))
        )
    return {"constraints": result, "parsed_request": result["request"], "agent_execution_history": events}


def coordinator(state: TravelState) -> dict:
    if state.get("needs_clarification"):
        return {}
    with agent_span("COORDINATOR_AGENT", state.get("run_id")) as span:
        span["result"] = CoordinatorAgent().execute(state)
    return span["result"]


def flight_node(state: TravelState) -> dict:
    return _guard(FlightAgent(), state)


def transport_node(state: TravelState) -> dict:
    return _guard(TransportAgent(), state)


def hotel_node(state: TravelState) -> dict:
    return _guard(HotelAgent(), state)


def weather_node(state: TravelState) -> dict:
    return _guard(WeatherAgent(), state)


def recommendation_node(state: TravelState) -> dict:
    return _guard(RecommendationAgent(), state)


def budget_node(state: TravelState) -> dict:
    return _guard(BudgetAgent(), state)


def route_node(state: TravelState) -> dict:
    return _guard(RouteAgent(), state)


def itinerary_node(state: TravelState) -> dict:
    return _guard(ItineraryAgent(), state)


def weather_recheck(state: TravelState) -> dict:
    if state.get("needs_clarification"):
        return {}
    itinerary = (state.get("itinerary_result") or {}).get("days") or []
    forecast = (state.get("weather_result") or {}).get("days") or []
    conflicts = detect_weather_conflicts(itinerary, forecast)
    schedule_issues = validate_schedule(itinerary)
    events = [make_event(AGENT_COMPLETED, "WEATHER_AGENT", "Rechecked the itinerary against the forecast")]
    warnings = []
    for issue in schedule_issues["violations"]:
        warnings.append(f"Schedule check: {issue['message']}")
    if schedule_issues["violations"]:
        events.append(make_event(CONSTRAINT_VIOLATION, "CONSTRAINT_VALIDATOR", "; ".join(v["message"] for v in schedule_issues["violations"])))
    if conflicts:
        events.append(make_event(CONSTRAINT_VIOLATION, "WEATHER_AGENT", f"{len(conflicts)} weather conflict(s)"))
        if int(state.get("replan_count") or 0) >= get_settings().max_replan_attempts:
            for conflict in conflicts:
                warnings.append(f"Day {conflict['day']}: {conflict['activity']} is outdoors on a wet day. Keep an indoor backup.")
    return {
        "weather_conflict": bool(conflicts),
        "weather_checked": True,
        "adjustments": {"conflicts": conflicts, "force_indoor": bool(conflicts)},
        "warnings": warnings,
        "agent_execution_history": events,
    }


def replan(state: TravelState) -> dict:
    # The itinerary agent runs next with force_indoor, so outdoor places are left out of every day.
    count = int(state.get("replan_count") or 0) + 1
    return {
        "replan_count": count,
        "weather_conflict": False,
        "adjustments": {"force_indoor": True, "conflicts": []},
        "agent_execution_history": [make_event(REPLAN_TRIGGERED, "COORDINATOR_AGENT", f"Replan attempt {count}")],
    }


def finalizer(state: TravelState) -> dict:
    if state.get("needs_clarification"):
        return {}
    plan = build_final_plan(state)
    return {
        "final_plan": plan,
        "optimization_metrics": plan.get("optimization_metrics") or {},
        "agent_execution_history": [make_event(WORKFLOW_COMPLETED, "COORDINATOR_AGENT", "Final plan ready")],
    }


def _after_parser(state: TravelState) -> str:
    return "clarify" if state.get("needs_clarification") else "constraint_validator"


def _after_recheck(state: TravelState) -> str:
    limit = get_settings().max_replan_attempts
    if state.get("weather_conflict") and int(state.get("replan_count") or 0) < limit:
        return "replan"
    return "finalizer"


def build_workflow():
    graph = StateGraph(TravelState)
    graph.add_node("request_parser", request_parser)
    graph.add_node("constraint_validator", constraint_validator)
    graph.add_node("coordinator", coordinator)
    graph.add_node("flight_agent", flight_node)
    graph.add_node("transport_agent", transport_node)
    graph.add_node("hotel_agent", hotel_node)
    graph.add_node("weather_agent", weather_node)
    graph.add_node("recommendation_agent", recommendation_node)
    graph.add_node("budget_agent", budget_node)
    graph.add_node("route_agent", route_node)
    graph.add_node("itinerary_agent", itinerary_node)
    graph.add_node("weather_recheck", weather_recheck)
    graph.add_node("replan", replan)
    graph.add_node("finalizer", finalizer)

    graph.add_edge(START, "request_parser")
    graph.add_conditional_edges(
        "request_parser",
        _after_parser,
        {"clarify": END, "constraint_validator": "constraint_validator"},
    )
    graph.add_edge("constraint_validator", "coordinator")
    graph.add_edge("coordinator", "flight_agent")
    graph.add_edge("coordinator", "transport_agent")
    graph.add_edge("transport_agent", "route_agent")
    graph.add_edge("coordinator", "hotel_agent")
    graph.add_edge("coordinator", "weather_agent")
    graph.add_edge("coordinator", "recommendation_agent")
    graph.add_edge("flight_agent", "route_agent")
    graph.add_edge("hotel_agent", "route_agent")
    graph.add_edge("weather_agent", "route_agent")
    graph.add_edge("recommendation_agent", "route_agent")
    graph.add_edge("route_agent", "budget_agent")
    graph.add_edge("budget_agent", "itinerary_agent")
    graph.add_edge("itinerary_agent", "weather_recheck")
    graph.add_conditional_edges("weather_recheck", _after_recheck, {"replan": "replan", "finalizer": "finalizer"})
    graph.add_edge("replan", "itinerary_agent")
    graph.add_edge("finalizer", END)
    return graph.compile()
