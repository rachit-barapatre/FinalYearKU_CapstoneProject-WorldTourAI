"""The HTTP contract of the planner, and that an offline plan is complete and usable, not just a 200."""

import json

import pytest
from fastapi.testclient import TestClient

from worldtour_ai.config.settings import reset_settings_cache
from worldtour_ai.web.app import app

reset_settings_cache()
client = TestClient(app)

REQUEST = "Plan a 3 day trip from Ahmedabad to Goa for 2 people, starting 2026-12-10, budget 60000 INR, we like beaches and food"


def test_health_reports_sources_without_keys():
    body = client.get("/api/health").json()
    assert body["status"] == "ok"
    assert set(body["sources"]) == {"live_fares_and_hotels", "ai", "maps_and_places", "flight_schedules"}
    assert all(isinstance(value, bool) for value in body["sources"].values())


def test_chat_rejects_empty_and_malformed_requests():
    assert client.post("/api/chat", json={"message": "   "}).status_code == 400
    assert client.post("/api/chat", json={"nothing": 1}).status_code == 422


def test_plan_refuses_a_chat_that_is_not_ready():
    assert client.post("/api/plan", json={"session": {}}).status_code == 400
    assert client.post("/api/plan", json={"session": {"stage": "collecting"}}).status_code == 400


def test_access_code_is_enforced_when_set(monkeypatch):
    monkeypatch.setenv("ACCESS_CODE", "letmein")
    assert client.post("/api/chat", json={"message": "hi"}).status_code == 401
    assert client.post("/api/chat", json={"message": "hi"}, headers={"X-Access-Code": "wrong"}).status_code == 401
    assert client.post("/api/chat", json={"message": "hi"}, headers={"X-Access-Code": "letmein"}).status_code == 200


def test_error_responses_do_not_leak_internals(monkeypatch):
    def boom(*_a, **_k):
        raise RuntimeError("secret-internal-detail")

    monkeypatch.setattr("worldtour_ai.web.app.chat_step", boom)
    response = client.post("/api/chat", json={"message": "hello"})
    assert response.status_code == 500
    assert "secret-internal-detail" not in response.text


@pytest.fixture(scope="module")
def planned():
    chat = client.post("/api/chat", json={"message": REQUEST, "currency": "INR"}).json()
    assert chat["ready"] is True, chat["reply"]
    events, plan, errors = [], None, []
    with client.stream("POST", "/api/plan", json={"session": chat["session"]}) as response:
        assert response.status_code == 200
        for line in response.iter_lines():
            if not line:
                continue
            message = json.loads(line)
            if message["type"] == "event":
                events.append(message["event"])
            elif message["type"] == "plan":
                plan = message["plan"]
                assert message["session"]["stage"] == "planned"
            elif message["type"] == "error":
                errors.append(message["message"])
    return plan, events, errors


def test_plan_stream_finishes_with_a_plan(planned):
    plan, events, errors = planned
    assert errors == []
    assert plan is not None
    assert events, "no agent progress events were streamed"


def test_offline_plan_is_complete_and_consistent(planned):
    plan, _events, _errors = planned
    assert plan["origin"] == "Ahmedabad" and plan["destination"] == "Goa"
    assert plan["duration"]["days"] == 3 and plan["travelers"] == 2
    assert plan["dates"]["start_date"] == "2026-12-10"
    assert len(plan["daily_itinerary"]) == 3
    assert [day["day"] for day in plan["daily_itinerary"]] == [1, 2, 3]
    assert len(plan["packages"]) == 3
    assert plan["estimated_cost"] > 0
    assert plan["display_currency"] == "INR"
    assert plan["budget"]["amount"] == 60000
    assert plan["budget_breakdown"], "no cost breakdown"
    assert plan["transport_choice"], "no way of getting there was chosen"


def test_offline_plan_says_what_it_could_not_get(planned):
    plan, _events, _errors = planned
    assert plan["warnings"], "a plan built without any data source must say so"


def test_exports_work_for_a_plan(planned):
    plan, _events, _errors = planned
    text = client.post("/api/export/text", json={"plan": plan})
    assert text.status_code == 200 and "Goa" in text.text
    ics = client.post("/api/export/ics", json={"plan": plan})
    assert ics.status_code == 200 and ics.text.startswith("BEGIN:VCALENDAR")
