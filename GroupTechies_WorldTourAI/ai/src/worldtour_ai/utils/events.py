"""Workflow event names stored in agent_execution_history."""

from __future__ import annotations

from datetime import datetime, timezone


AGENT_STARTED = "AGENT_STARTED"
AGENT_COMPLETED = "AGENT_COMPLETED"
AGENT_FAILED = "AGENT_FAILED"
AGENT_RETRYING = "AGENT_RETRYING"
WORKFLOW_STARTED = "WORKFLOW_STARTED"
WORKFLOW_COMPLETED = "WORKFLOW_COMPLETED"
WORKFLOW_FAILED = "WORKFLOW_FAILED"
CONSTRAINT_VIOLATION = "CONSTRAINT_VIOLATION"
REPLAN_TRIGGERED = "REPLAN_TRIGGERED"


def make_event(event: str, agent_id: str, message: str, **extra: object) -> dict:
    payload = {
        "event": event,
        "agent_id": agent_id,
        "message": message,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    payload.update(extra)
    return payload
