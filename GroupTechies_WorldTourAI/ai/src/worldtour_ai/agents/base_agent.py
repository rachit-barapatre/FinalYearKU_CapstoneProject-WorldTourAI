"""Shared agent metadata and event helpers."""

from __future__ import annotations

import json

from worldtour_ai.utils.events import AGENT_COMPLETED, AGENT_FAILED, AGENT_STARTED, make_event


class BaseAgent:
    agent_id = "BASE"
    agent_name = "Base Agent"
    responsibilities: list[str] = []
    algorithms: list[str] = []
    tools: list[str] = []
    provider = ""
    llm_role = "Does not optimize. Explains structured tool results when an LLM is available."

    def execute(self, state: dict) -> dict:
        raise NotImplementedError

    def started(self, message: str) -> dict:
        return make_event(AGENT_STARTED, self.agent_id, message)

    def completed(self, message: str) -> dict:
        return make_event(AGENT_COMPLETED, self.agent_id, message)

    def failed(self, message: str) -> dict:
        return make_event(AGENT_FAILED, self.agent_id, message)

    @staticmethod
    def invoke(tool, payload: dict) -> dict:
        return json.loads(tool.invoke({"payload_json": json.dumps(payload)}))
