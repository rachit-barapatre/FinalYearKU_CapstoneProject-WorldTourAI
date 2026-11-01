"""Shared LangGraph state."""

from __future__ import annotations

import operator
from typing import Annotated, TypedDict


class TravelState(TypedDict, total=False):
    run_id: str  # ties together every log line of one plan (utils/agent_logs.py)
    original_user_request: str
    parsed_request: dict | None
    constraints: dict
    flight_result: dict | None
    transport_result: dict | None
    hotel_result: dict | None
    budget_result: dict | None
    route_result: dict | None
    itinerary_result: dict | None
    weather_result: dict | None
    recommendation_result: dict | None
    warnings: Annotated[list, operator.add]
    errors: Annotated[list, operator.add]
    optimization_metrics: dict
    final_plan: dict | None
    agent_execution_history: Annotated[list, operator.add]
    replan_count: int
    conversation_history: list
    required_agents: list
    missing_fields: list
    needs_clarification: bool
    clarification_question: str
    pending_fields: list
    resume: bool
    request_ready: bool
    weather_conflict: bool
    weather_checked: bool
    adjustments: dict
    halt: bool


def fresh_state(
    text: str,
    conversation: list[dict] | None = None,
    previous: dict | None = None,
    pending: list[str] | None = None,
    resume: bool = False,
    ready: bool = False,
) -> TravelState:
    """ready=True means `previous` is a complete request collected by the chat intake."""
    history = conversation or [{"role": "user", "content": text}]
    return {
        "original_user_request": text,
        "conversation_history": history,
        "parsed_request": previous,
        "constraints": {},
        "flight_result": None,
        "transport_result": None,
        "hotel_result": None,
        "budget_result": None,
        "route_result": None,
        "itinerary_result": None,
        "weather_result": None,
        "recommendation_result": None,
        "warnings": [],
        "errors": [],
        "optimization_metrics": {},
        "final_plan": None,
        "agent_execution_history": [],
        "replan_count": 0,
        "required_agents": [],
        "missing_fields": [],
        "needs_clarification": False,
        "clarification_question": "",
        "pending_fields": pending or [],
        "resume": resume,
        "request_ready": ready,
        "weather_conflict": False,
        "weather_checked": False,
        "adjustments": {},
        "halt": False,
    }
