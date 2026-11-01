"""Writes the traveler-facing day descriptions with the free LLM, in small parallel requests.

The timetable is already complete (and has built-in text) before this runs, so the AI is only an upgrade of the
prose. Everything here is bounded: one wall-clock deadline for the whole trip, a few days per request, requests in
parallel, one retry only for empty or unreadable answers, and an instant skip when the AI is off or paused.
"""

from __future__ import annotations

import copy
import hashlib
import threading
import time
from dataclasses import dataclass, field
from typing import Callable

from worldtour_ai.agents.itinerary_agent import money_formatter, weather_lines
from worldtour_ai.config.settings import get_settings
from worldtour_ai.providers.llm.openrouter_provider import (
    EmptyAnswerError,
    OpenRouterProvider,
    llm_paused,
)
from worldtour_ai.services.itinerary_composer import DETAIL_PROMPT, apply_llm_details, detail_prompt
from worldtour_ai.utils.cache import ResponseCache
from worldtour_ai.utils.events import AGENT_COMPLETED, make_event
from worldtour_ai.utils.exceptions import ProviderError

CACHE_TTL_SECONDS = 6 * 3600
TOKENS_PER_DAY = 330  # reply budget per day (title + three short paragraphs), so a request cannot ramble

Completer = Callable[..., str]


@dataclass
class WriteResult:
    written: int = 0
    total: int = 0
    calls: int = 0
    cached: int = 0
    seconds: float = 0.0
    notes: list[str] = field(default_factory=list)


def _batches(days: list[dict], size: int) -> list[list[dict]]:
    size = max(size, 1)
    return [days[i : i + size] for i in range(0, len(days), size)]


def _default_completer() -> Completer:
    provider = OpenRouterProvider()
    return lambda system, user, timeout, max_tokens: provider.complete(
        system, user, timeout=timeout, attempts=1, max_tokens=max_tokens
    )


def _cache_key(model: str, prompt: str) -> str:
    return "daytext-" + hashlib.sha256(f"{model}\n{DETAIL_PROMPT}\n{prompt}".encode()).hexdigest()[:32]


def write_days(
    days: list[dict],
    request: dict,
    weather_text: dict,
    money,
    completer: Completer | None = None,
) -> WriteResult:
    """Replace the built-in day text with AI text where the AI answered and it matches the timetable.

    `days` is updated in place (on the calling thread only). Days the AI did not reach keep their built-in text.
    """
    settings = get_settings()
    result = WriteResult(total=len(days))
    started = time.perf_counter()
    if not days or not settings.ai_day_descriptions:
        return result
    if completer is None:
        if not settings.openrouter_api_key or settings.disable_network:
            result.notes.append("The AI writer is not configured, so each day uses the built-in summary.")
            return result
        if llm_paused():
            result.notes.append("The AI writer is resting after a recent failure, so each day uses the built-in summary.")
            return result
        completer = _default_completer()

    limit = float(settings.ai_description_timeout_seconds)
    deadline = started + limit
    retries = max(int(settings.ai_description_retries), 0)
    floor = min(3.0, limit * 0.25)  # not worth starting a request with less time than this
    cache = ResponseCache()
    batches = _batches(days, settings.ai_days_per_request)
    slots: list[dict] = [{"done": threading.Event(), "text": None, "error": None, "calls": 0, "cached": False} for _ in batches]
    gate = threading.Semaphore(max(int(settings.ai_parallel_requests), 1))
    lock = threading.Lock()
    prompts = [detail_prompt(batch, request, weather_text, money) for batch in batches]

    def work(index: int) -> None:
        slot, batch, prompt = slots[index], batches[index], prompts[index]
        key = _cache_key(settings.openrouter_free_model, prompt)
        try:
            hit = cache.get(key)
            if hit and isinstance(hit.get("text"), str):
                slot["text"], slot["cached"] = hit["text"], True
                return
            with gate:
                for attempt in range(retries + 1):
                    remaining = deadline - time.perf_counter()
                    if remaining < floor:
                        slot["error"] = slot["error"] or "timeout"
                        return
                    try:
                        with lock:
                            result.calls += 1
                        raw = completer(DETAIL_PROMPT, prompt, remaining, TOKENS_PER_DAY * len(batch) + 120)
                    except EmptyAnswerError:
                        slot["error"] = "empty"
                        continue  # one more try: free models sometimes return nothing
                    except ProviderError as exc:
                        slot["error"] = str(exc)
                        return  # timeouts, rate limits and failures are not retried; the built-in text is used
                    # Check on a copy: only a usable answer is kept, and nothing is mutated off the main thread.
                    if apply_llm_details(raw, copy.deepcopy(batch)) > 0:
                        slot["text"], slot["error"] = raw, None
                        cache.set(key, {"text": raw}, CACHE_TTL_SECONDS)
                        return
                    slot["error"] = "unusable"
        except Exception as exc:  # a worker must never take the plan down
            slot["error"] = f"{type(exc).__name__}"
        finally:
            slot["done"].set()

    for index in range(len(batches)):
        threading.Thread(target=work, args=(index,), daemon=True).start()
    for slot in slots:
        slot["done"].wait(timeout=max(deadline - time.perf_counter(), 0))

    reasons: list[str] = []
    for batch, slot in zip(batches, slots):
        if slot["done"].is_set() and slot["text"]:
            result.written += apply_llm_details(slot["text"], batch)
            result.cached += 1 if slot["cached"] else 0
        else:
            reasons.append(slot["error"] if slot["done"].is_set() else "timeout")
    result.seconds = time.perf_counter() - started
    if result.written < result.total:
        if "timeout" in reasons:
            result.notes.append(
                f"The AI writer did not finish within {limit:.0f} seconds, so some days use the built-in summary."
            )
        elif reasons or result.written == 0:
            result.notes.append("The AI writer could not describe every day, so those days use the built-in summary.")
        else:
            result.notes.append(
                f"The AI wrote descriptions for {result.written} of {result.total} days; "
                "the other days use the built-in summary because the AI text did not match the timetable."
            )
    return result


def describe_days(state: dict, completer: Completer | None = None) -> dict:
    """Workflow step after the replan loop: add AI prose to the finished timetable, then finish the itinerary step."""
    itinerary = state.get("itinerary_result")
    if not itinerary or state.get("needs_clarification"):
        return {}
    updated = copy.deepcopy(itinerary)
    try:
        outcome = write_days(
            updated.get("days") or [], state.get("parsed_request") or {}, weather_lines(state), money_formatter(state), completer
        )
    except Exception as exc:  # the timetable is complete without the AI text, so this step can never fail the plan
        return {
            "warnings": [f"Day descriptions use the built-in summary because the AI writer failed ({type(exc).__name__})."],
            "agent_execution_history": [make_event(AGENT_COMPLETED, "ITINERARY_AGENT", "Day timetables finished")],
        }
    message = "Day timetables finished"
    if outcome.written:
        message += f" ({outcome.written} of {outcome.total} days described by the AI)"
    return {
        "itinerary_result": updated,
        "warnings": outcome.notes,
        "agent_execution_history": [make_event(AGENT_COMPLETED, "ITINERARY_AGENT", message)],
    }
