"""The day-by-day step: fast, bounded, parallel, and never stuck. No network; the 'LLM' is a local fake."""

import copy
import json
import re
import time

import pytest
from fastapi.testclient import TestClient

from worldtour_ai.config.settings import reset_settings_cache
from worldtour_ai.providers.llm import openrouter_provider as llm
from worldtour_ai.agents import recommendation_agent
from worldtour_ai.services import day_writer
from worldtour_ai.services.day_writer import describe_days, write_days
from worldtour_ai.services.itinerary_composer import NOT_SIGHTS
from worldtour_ai.utils.exceptions import ProviderError
from worldtour_ai.web.app import app
from worldtour_ai.workflows import travel_graph

client = TestClient(app)
FIVE_DAYS = "Plan a 5 day trip from Ahmedabad to Goa for 2 people, starting 2026-12-10, budget 90000 INR, we like beaches and food"
MARK = "AI-WRITTEN"


@pytest.fixture(autouse=True)
def isolated(monkeypatch, tmp_path):
    monkeypatch.setenv("CACHE_DIR", str(tmp_path))
    for name in ("AI_DESCRIPTION_TIMEOUT_SECONDS", "AI_DAYS_PER_REQUEST", "AI_PARALLEL_REQUESTS", "AI_DESCRIPTION_RETRIES"):
        monkeypatch.delenv(name, raising=False)
    reset_settings_cache()
    llm.resume_llm()
    yield
    llm.resume_llm()
    reset_settings_cache()


GOA_PLACES = [
    ("Fort Aguada", "history", 15.4920, 73.7730), ("Basilica of Bom Jesus", "culture", 15.5009, 73.9116),
    ("Se Cathedral", "culture", 15.5025, 73.9120), ("Baga Beach", "beach", 15.5553, 73.7517),
    ("Calangute Beach", "beach", 15.5440, 73.7550), ("Anjuna Flea Market", "shopping", 15.5740, 73.7410),
    ("Chapora Fort", "history", 15.6060, 73.7360), ("Fontainhas Latin Quarter", "culture", 15.4960, 73.8290),
    ("Dudhsagar Falls", "nature", 15.3144, 74.3143), ("Mangueshi Temple", "culture", 15.4510, 73.9710),
    ("Reis Magos Fort", "history", 15.5000, 73.8000), ("Miramar Beach", "beach", 15.4800, 73.8100),
    ("Museum of Goa", "culture", 15.5400, 73.8400), ("Sunset Cruise Mandovi", "entertainment", 15.4990, 73.8250),
]


class FakePlaces:
    """Stands in for the Geoapify places tool, which is not reachable offline."""

    def invoke(self, payload):
        items = [
            {"place_id": f"p{i}", "name": n, "category": c, "lat": la, "lon": lo, "score": 10 - i * 0.2, "address": "Goa"}
            for i, (n, c, la, lo) in enumerate(GOA_PLACES)
        ]
        return json.dumps({"places": items, "algorithms_executed": ["Top-K"]})


def parse_prompt(user: str) -> dict[int, list[str]]:
    """Day number -> the sight names in that day's part of the compact prompt."""
    days: dict[int, list[str]] = {}
    current = None
    for line in user.splitlines():
        head = re.match(r"Day (\d+) ", line)
        if head:
            current = int(head.group(1))
            days[current] = []
            continue
        row = re.match(r"\d\d:\d\d-\d\d:\d\d (.+?) \[(\w+)\]", line)
        if row and current and row.group(2) not in NOT_SIGHTS:
            days[current].append(row.group(1).lower().replace("dinner at ", "")[:18])
    return days


class FakeLLM:
    """Answers like a good model: valid JSON for exactly the days asked, naming every sight."""

    def __init__(self, delay: float = 0.0, fail=None):
        self.delay, self.fail, self.calls, self.prompts = delay, fail or (lambda n: None), 0, []

    def __call__(self, system, user, timeout, max_tokens):
        self.calls += 1
        self.prompts.append(user)
        outcome = self.fail(self.calls)
        if isinstance(outcome, BaseException):
            raise outcome
        if self.delay:
            time.sleep(self.delay)
        if outcome is not None:
            return outcome
        days = [
            {"day": n, "title": f"Day {n} – Theme", "morning": f"{MARK} morning. You see {', '.join(s)}.",
             "midday": f"{MARK} midday.", "evening": f"{MARK} evening."}
            for n, s in parse_prompt(user).items()
        ]
        return json.dumps({"days": days})


def run_plan(message: str, completer=None):
    """Full offline workflow over the real HTTP stream, with `completer` standing in for the free LLM."""
    chat = client.post("/api/chat", json={"message": message, "currency": "INR"}).json()
    assert chat["ready"] is True, chat["reply"]
    original = travel_graph.describe_days
    saved_tool, recommendation_agent.places_tool = recommendation_agent.places_tool, FakePlaces()
    travel_graph.describe_days = lambda state: describe_days(state, completer)
    events, plan, errors = [], None, []
    try:
        with client.stream("POST", "/api/plan", json={"session": chat["session"]}) as response:
            assert response.status_code == 200
            for line in response.iter_lines():
                if not line:
                    continue
                item = json.loads(line)
                if item["type"] == "event":
                    events.append(item["event"])
                elif item["type"] == "plan":
                    plan = item["plan"]
                elif item["type"] == "error":
                    errors.append(item["message"])
    finally:
        travel_graph.describe_days = original
        recommendation_agent.places_tool = saved_tool
    return plan, events, errors


@pytest.fixture(scope="module")
def offline_days():
    reset_settings_cache()
    plan, _events, errors = run_plan(FIVE_DAYS)
    assert plan and not errors
    return plan["daily_itinerary"]


def money(value):
    return f"Rs {value:.0f}"


def fresh(days):
    return copy.deepcopy(days)


# ----------------------------------------------------------------------------- the timetable itself


def test_every_day_has_a_complete_timetable_without_any_ai(offline_days):
    assert [d["day"] for d in offline_days] == [1, 2, 3, 4, 5]
    for day in offline_days:
        sights = [a for a in day["activities"] if a["category"] not in NOT_SIGHTS]
        assert day["activities"], f"day {day['day']} is empty"
        assert day["morning"] and day["midday"] and day["evening"] and day["title"].startswith(f"Day {day['day']}")
        times = [(a["start_minute"], a["end_minute"]) for a in day["activities"]]
        assert all(start < end for start, end in times) and times == sorted(times)
        assert all(b[0] >= a[1] - 1 for a, b in zip(times, times[1:])), "activities overlap"
        assert sights or day["day"] in (1, 5), f"day {day['day']} has no sights"


def test_sights_come_from_recommendations_and_no_place_repeats(offline_days):
    names = [a["name"] for d in offline_days for a in d["activities"] if a["category"] not in NOT_SIGHTS | {"food"}]
    assert len(names) >= 6, "a 5-day trip with 14 candidate places should schedule many"
    assert len(names) == len(set(names)), "a place is scheduled twice"
    assert set(names) <= {n for n, *_ in GOA_PLACES}, "a scheduled sight was not a recommended place"


# ----------------------------------------------------------------------------- the writer


def test_days_are_written_in_parallel_small_requests_and_all_get_text(offline_days):
    days = fresh(offline_days)
    fake = FakeLLM(delay=0.4)
    started = time.perf_counter()
    result = write_days(days, {"destination": "Goa", "travelers": 2}, {}, money, fake)
    elapsed = time.perf_counter() - started
    assert fake.calls == 3, "5 days at 2 per request is 3 requests"
    assert elapsed < 0.4 * 3 * 0.8, f"requests ran one after another ({elapsed:.2f}s)"
    assert result.written == 5 and not result.notes
    for day in days:
        assert MARK in day["morning"] and MARK in day["evening"]
        assert day["activities"], "the AI must not remove activities"
    assert [d["activities"] for d in days] == [d["activities"] for d in offline_days], "the timetable must not change"


def test_each_request_only_contains_its_own_days(offline_days):
    fake = FakeLLM()
    write_days(fresh(offline_days), {"destination": "Goa"}, {}, money, fake)
    seen = sorted(n for prompt in fake.prompts for n in parse_prompt(prompt))
    assert seen == [1, 2, 3, 4, 5], "every day is sent exactly once"


def test_empty_answer_is_retried_once_then_works(offline_days):
    days = fresh(offline_days)
    first = {"done": False}

    def fail(n):
        if n == 1:
            return llm.EmptyAnswerError("empty")

    fake = FakeLLM(fail=fail)
    result = write_days(days, {}, {}, money, fake)
    assert result.written == 5 and fake.calls == 4  # three batches + one retry


def test_always_empty_falls_back_fast_with_built_in_text(offline_days, monkeypatch):
    days = fresh(offline_days)
    fake = FakeLLM(fail=lambda n: llm.EmptyAnswerError("empty"))
    started = time.perf_counter()
    result = write_days(days, {}, {}, money, fake)
    assert time.perf_counter() - started < 2
    assert result.written == 0 and fake.calls == 6, "one retry per request, never more"
    assert days == offline_days, "built-in text is kept untouched"
    assert result.notes


def test_blank_text_and_malformed_json_use_the_built_in_summary(offline_days):
    for bad in ("", "   ", "not json at all", '{"days": [', '{"days": "oops"}', "[]"):
        days = fresh(offline_days)
        result = write_days(days, {}, {}, money, FakeLLM(fail=lambda n, bad=bad: bad))
        assert result.written == 0 and days == offline_days, repr(bad)


def test_answer_that_drops_a_sight_is_rejected_for_that_day_only(offline_days):
    days = fresh(offline_days)

    class DropsSights(FakeLLM):
        def __call__(self, system, user, timeout, max_tokens):
            data = json.loads(super().__call__(system, user, timeout, max_tokens))
            for item in data["days"]:
                if item["day"] == 2:
                    item["morning"] = item["midday"] = item["evening"] = "Free time."
            return json.dumps(data)

    assert [a for a in offline_days[1]["activities"] if a["category"] not in NOT_SIGHTS], "day 2 needs sights for this test"
    result = write_days(days, {}, {}, money, DropsSights())
    assert days[1] == offline_days[1] and result.written == 4
    assert any("did not match" in n for n in result.notes)


def test_provider_failure_is_not_retried_and_falls_back(offline_days):
    days = fresh(offline_days)
    fake = FakeLLM(fail=lambda n: ProviderError("OpenRouter returned 503"))
    result = write_days(days, {}, {}, money, fake)
    assert fake.calls == 3 and result.written == 0 and days == offline_days


def test_slow_model_is_cut_off_at_the_deadline_with_a_fast_fallback(offline_days, monkeypatch):
    monkeypatch.setenv("AI_DESCRIPTION_TIMEOUT_SECONDS", "1.2")
    reset_settings_cache()
    days = fresh(offline_days)
    started = time.perf_counter()
    result = write_days(days, {}, {}, money, FakeLLM(delay=5))
    elapsed = time.perf_counter() - started
    assert elapsed < 2.0, f"waited {elapsed:.1f}s for a model that needs 5s"
    assert result.written == 0 and days == offline_days
    assert any("did not finish" in n for n in result.notes)


def test_one_failing_request_keeps_the_others(offline_days):
    days = fresh(offline_days)
    fake = FakeLLM(fail=lambda n: ProviderError("429") if n == 2 else None)
    result = write_days(days, {}, {}, money, fake)
    assert 0 < result.written < 5
    written = [MARK in d["morning"] for d in days]
    assert sum(written) == result.written
    assert all(d["morning"] and d["activities"] for d in days)


def test_late_answer_after_deadline_is_ignored_not_half_applied(offline_days, monkeypatch):
    monkeypatch.setenv("AI_DESCRIPTION_TIMEOUT_SECONDS", "1")
    reset_settings_cache()
    days = fresh(offline_days)
    write_days(days, {}, {}, money, FakeLLM(delay=1.6))
    snapshot = copy.deepcopy(days)
    time.sleep(1.0)  # the straggler threads finish now
    assert days == snapshot


def test_same_request_twice_does_not_call_the_ai_again(offline_days):
    first, second = FakeLLM(), FakeLLM()
    write_days(fresh(offline_days), {"destination": "Goa"}, {}, money, first)
    days = fresh(offline_days)
    result = write_days(days, {"destination": "Goa"}, {}, money, second)
    assert first.calls == 3 and second.calls == 0, "answers are reused (e.g. when the browser restarts a dropped plan)"
    assert result.written == 5 and MARK in days[0]["morning"]


def test_ai_is_skipped_instantly_when_unconfigured_or_paused(offline_days, monkeypatch):
    days = fresh(offline_days)
    result = write_days(days, {}, {}, money)  # no key in tests
    assert result.written == 0 and result.calls == 0 and "not configured" in result.notes[0]
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-test-not-a-real-key")
    monkeypatch.setenv("DISABLE_NETWORK", "false")
    reset_settings_cache()
    llm.pause_llm()
    result = write_days(fresh(offline_days), {}, {}, money)
    assert result.calls == 0 and "resting" in result.notes[0]


def test_ai_can_be_switched_off(offline_days, monkeypatch):
    monkeypatch.setenv("AI_DAY_DESCRIPTIONS", "false")
    reset_settings_cache()
    fake = FakeLLM()
    assert write_days(fresh(offline_days), {}, {}, money, fake).calls == 0 and fake.calls == 0


def test_prompt_is_compact(offline_days):
    fake = FakeLLM()
    write_days(fresh(offline_days), {"destination": "Goa", "travelers": 2}, {}, money, fake)
    per_day = sum(len(p) for p in fake.prompts) / 5
    assert per_day < 900, f"{per_day:.0f} characters per day"


# ----------------------------------------------------------------------------- through the workflow and the stream


def test_stream_delivers_the_final_plan_with_ai_text_and_ordered_progress():
    fake = FakeLLM()
    plan, events, errors = run_plan(FIVE_DAYS, fake)
    assert plan and not errors
    assert fake.calls == 3, "the LLM is called once per batch, not again for any weather replan"
    assert all(MARK in d["morning"] for d in plan["daily_itinerary"])
    order = [(e["event"], e["agent_id"]) for e in events]
    progress = order.index(("AGENT_PROGRESS", "ITINERARY_AGENT"))
    done = order.index(("AGENT_COMPLETED", "ITINERARY_AGENT"))
    assert order.count(("AGENT_COMPLETED", "ITINERARY_AGENT")) == 1
    assert progress < done < order.index(("WORKFLOW_COMPLETED", "COORDINATOR_AGENT"))


def test_stream_still_finishes_with_a_complete_plan_when_the_ai_fails():
    fake = FakeLLM(fail=lambda n: ProviderError("OpenRouter request failed: ReadTimeout"))
    started = time.perf_counter()
    plan, events, errors = run_plan(FIVE_DAYS, fake)
    assert time.perf_counter() - started < 15
    assert plan and not errors
    days = plan["daily_itinerary"]
    assert len(days) == 5 and all(d["activities"] and d["morning"] for d in days)
    assert not any(MARK in d["morning"] for d in days)
    assert ("AGENT_COMPLETED", "ITINERARY_AGENT") in [(e["event"], e["agent_id"]) for e in events]
    assert any("built-in summary" in w for w in plan.get("warnings", []))


def test_writer_crash_cannot_fail_the_plan(monkeypatch):
    monkeypatch.setattr(day_writer, "write_days", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
    plan, events, errors = run_plan(FIVE_DAYS)
    assert plan and not errors and len(plan["daily_itinerary"]) == 5
    assert ("AGENT_COMPLETED", "ITINERARY_AGENT") in [(e["event"], e["agent_id"]) for e in events]
