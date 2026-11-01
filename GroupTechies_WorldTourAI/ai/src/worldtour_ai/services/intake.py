"""Chat-style intake: collect every essential trip constraint before the workflow starts.

Answers are parsed with the fast heuristic parser so each follow-up question appears
immediately. The OpenRouter parse of the first message runs in the background and only
fills fields the conversation left empty.
"""

from __future__ import annotations

import re
from concurrent.futures import ThreadPoolExecutor
from typing import Callable

from pydantic import ValidationError

from worldtour_ai.config.settings import get_settings
from worldtour_ai.schemas.models import TravelRequest
from worldtour_ai.services.feasibility import check_feasibility
from worldtour_ai.services.request_parser import (
    clarification_message,
    complete_dates,
    grounded_llm_fields,
    missing_essential,
    parse_travel_text,
    resolve_currency,
    user_skipped,
)

MAX_ROUNDS = 3
_FLAGS = {"budget_is_user_stated", "cities_are_suggestions"}
_OPTIONAL = {"start_date", "preferences"}


def intake_missing(request: TravelRequest, first_round: bool = False) -> list[str]:
    """Essential fields plus the traveler count, which drives flight and hotel costs.

    The first question also asks for travel dates and interests/pace. Those are
    optional, so they are not asked again if the user leaves them out.
    """
    missing = missing_essential(request)
    if not request.travelers and "travelers" not in missing:
        missing.append("travelers")
    # Dates and interests are optional: they are asked only together with a real gap, never on their own,
    # so a complete request goes straight to planning (flexible dates, a balanced mix of sights).
    if first_round and missing:
        if not request.start_date:
            missing.append("start_date")
        if not request.preferences and not request.pace:
            missing.append("preferences")
    return missing


def collect_request(text: str, ask: Callable[[str], str | None]) -> tuple[dict | None, list[dict]]:
    """Ask for missing details until the request is complete. Returns (request, history), or None on EOF."""
    history = [{"role": "user", "content": text}]
    pool = ThreadPoolExecutor(max_workers=1)
    llm_future = pool.submit(grounded_llm_fields, text)
    try:
        request = parse_travel_text(text, use_llm=False)
        skipped: list[str] = []
        for round_number in range(MAX_ROUNDS):
            missing = [field for field in intake_missing(request, round_number == 0) if field not in skipped]
            if not missing:
                break
            question = clarification_message(missing)
            answer = ask(question)
            if answer is None:
                return None, history
            answer = answer.strip() or "skip"
            history += [{"role": "assistant", "content": question}, {"role": "user", "content": answer}]
            if user_skipped(answer):
                skipped.extend(field for field in missing if field not in _OPTIONAL)
                continue
            request = parse_travel_text(answer, pending_fields=missing, previous=request.model_dump(), use_llm=False)

        try:
            # The chat answers are already parsed; don't keep the user waiting on a slow free model.
            grounded = llm_future.result(timeout=get_settings().parser_llm_wait_seconds)
        except Exception:
            grounded = None
        data = finalize_collected(request, skipped, grounded)
        checked = resolve_feasibility(data, ask, history)
        if checked is None:
            return None, history
        return TravelRequest.model_validate(checked).model_dump(), history
    finally:
        pool.shutdown(wait=False, cancel_futures=True)


def finalize_collected(request: TravelRequest, skipped: list[str], grounded: dict | None) -> dict:
    """Notes for skipped fields, LLM fields for anything still empty, then dates, pace and currency."""
    data = request.model_dump()
    notes = list(data.get("parser_notes") or [])
    if skipped:
        notes.append("You chose to continue without: " + ", ".join(skipped) + ".")
    unresolved = [field for field in intake_missing(request) if field not in skipped]
    if unresolved:
        notes.append("Still not provided after the questions: " + ", ".join(unresolved) + ".")
    data["parser_notes"] = notes
    merge_grounded(data, grounded)
    data["pace"] = data.get("pace") or "balanced"
    complete_dates(data)
    resolve_currency(data)
    return TravelRequest.model_validate(data).model_dump()


def merge_grounded(data: dict, grounded: dict | None) -> None:
    """Fill only empty fields from the grounded LLM parse; the user's own answers always win."""
    data["parser_mode"] = "openrouter+heuristic" if grounded else "heuristic"
    for key, value in (grounded or {}).items():
        if key in _FLAGS or value in (None, [], "", {}):
            continue
        if data.get(key) not in (None, [], ""):
            continue
        try:
            # The free model sometimes returns the wrong shape (e.g. {} for a list); skip such fields.
            TravelRequest.model_validate({**data, key: value})
        except ValidationError:
            continue
        data[key] = value
        if key == "budget":
            data["budget_is_user_stated"] = True
        if key == "cities":
            data["cities_are_suggestions"] = False


_YES = {"yes", "y", "ok", "okay", "sure", "do it", "sounds good", "go with that", "apply", "yes please", "fine", "accept"}
_CONTINUE = {"continue", "proceed", "go ahead", "as is", "keep it", "ignore", "no", "anyway", "plan anyway", "no thanks", "n"}


def trim_suggested_cities(data: dict) -> None:
    """Cities the user did not name are trimmed quietly so each one gets about 1.5 days."""
    days = int(data.get("duration_days") or 0)
    cities = data.get("cities") or []
    fit = max(1, int(days // 1.5)) if days else len(cities)
    if data.get("cities_are_suggestions") and len(cities) > fit:
        data["cities"] = cities[:fit]
        data["parser_notes"] = [*(data.get("parser_notes") or []), f"Kept {', '.join(cities[:fit])} so each city gets enough time."]


def blocking_issues(data: dict) -> list[dict]:
    return [issue for issue in check_feasibility(data, *_rates(data)) if issue["blocking"]]


def feasibility_message(issues: list[dict]) -> str:
    lines = ["Before I plan, some things don't add up:", ""]
    for number, issue in enumerate(issues, start=1):
        lines += [f"{number}. {issue['message']}", f"   {issue['question']}"]
    lines += ["", "Reply 'yes' to accept my suggestion(s), tell me what to change, or say 'continue' to plan it as is."]
    return "\n".join(lines)


def apply_feasibility_answer(data: dict, issues: list[dict], answer: str) -> tuple[dict, bool]:
    """Apply the user's reply to the listed issues. Returns (data, whether the reply was understood)."""
    data = dict(data)
    lowered = " ".join(answer.lower().split()).strip(".! ")
    if lowered in _CONTINUE:
        data["accepted_risks"] = list(dict.fromkeys([*(data.get("accepted_risks") or []), *(i["code"] for i in issues)]))
        data["parser_notes"] = [*(data.get("parser_notes") or []), "You chose to keep: " + "; ".join(i["message"] for i in issues)]
        return data, True
    if lowered in _YES:
        for issue in issues:
            if issue["fix"]:
                data.update(issue["fix"])
                if "duration_days" in issue["fix"]:
                    data["end_date"] = None
                    data.pop("duration_nights", None)
            else:
                data["accepted_risks"] = [*(data.get("accepted_risks") or []), issue["code"]]
        complete_dates(data)
        return data, True
    keep = re.match(r"^(?:keep|only)\s*(\d+)?", lowered)
    city_issue = next((i for i in issues if i["code"] == "too_many_cities"), None)
    if keep and city_issue:
        count = int(keep.group(1)) if keep.group(1) else len(city_issue["alternative"]["cities"])
        data["cities"] = (data.get("cities") or [])[: max(1, count)]
        return data, True
    if any(i["code"] == "same_place" for i in issues):
        parsed = parse_travel_text(answer, pending_fields=["destination"], previous={**data, "destination": None, "cities": []}, use_llm=False)
        if parsed.destination and parsed.destination != data.get("origin"):
            data.update(destination=parsed.destination, cities=parsed.cities, cities_are_suggestions=parsed.cities_are_suggestions)
            return data, True
    updated, changes = apply_refinement(data, answer)
    return (updated, True) if changes else (data, False)


def accept_remaining(data: dict) -> dict:
    """After the question rounds, anything still unresolved is planned as is and remembered as accepted."""
    remaining = blocking_issues(data)
    if remaining:
        data["accepted_risks"] = list(dict.fromkeys([*(data.get("accepted_risks") or []), *(i["code"] for i in remaining)]))
    return data


def resolve_feasibility(data: dict, ask: Callable[[str], str | None], history: list[dict]) -> dict | None:
    """Explain constraints that make the trip unrealistic and let the user fix or accept them before planning."""
    trim_suggested_cities(data)
    for _ in range(MAX_ROUNDS):
        issues = blocking_issues(data)
        if not issues:
            return data
        question = feasibility_message(issues)
        answer = ask(question)
        if answer is None:
            return None
        history += [{"role": "assistant", "content": question}, {"role": "user", "content": answer}]
        data, understood = apply_feasibility_answer(data, issues, answer)
        if not understood:
            data["parser_notes"] = [*(data.get("parser_notes") or []), "Note: " + "; ".join(i["message"] for i in issues)]
    return accept_remaining(data)


def _rates(data: dict) -> tuple[float | None, float]:
    """USD per unit of the budget currency, and display-currency units per USD. Cached; static fallback."""
    from worldtour_ai.providers.factory import CurrencyGateway
    from worldtour_ai.utils.money import display_currency

    gateway = CurrencyGateway()
    source = (data.get("currency") or "USD").upper()
    display = display_currency(data)
    try:
        usd_per_unit = 1.0 if source == "USD" else float(gateway.convert(1.0, source, "USD")["rate"])
    except Exception:
        usd_per_unit = None
    try:
        to_display = 1.0 if display == "USD" else float(gateway.convert(1.0, "USD", display)["rate"])
    except Exception:
        to_display = 1.0
    return usd_per_unit, to_display


_PACKAGE_WORDS = {
    "budget": ("budget", "cheaper", "cheapest", "cheaper hotel", "save money", "lower cost"),
    "balanced": ("balanced", "middle", "mid range", "mid-range"),
    "premium": ("premium", "luxury", "better hotel", "upgrade", "nicer hotel", "best hotel"),
}
_REMOVE = re.compile(r"^(?:please\s+)?(?:remove|skip|drop|exclude|no|without|don't include|dont include)\s+(?:the\s+)?(.+?)[.!]?$")


def apply_refinement(request: dict, text: str) -> tuple[dict, list[str]]:
    """Apply a follow-up change to a finished plan. Returns the new request and what changed (empty if not understood)."""
    lowered = " ".join(text.lower().split())
    new = dict(request)
    changes: list[str] = []
    stripped = re.sub(r"^(?:switch to|use|go|choose|pick|i want|show me|make it)\s+(?:the\s+|a\s+)?", "", lowered)
    stripped = re.sub(r"\s+(?:package|option|plan|one)$", "", stripped)
    for package, words in _PACKAGE_WORDS.items():
        if stripped in words:
            new["package_choice"] = package
            return new, [f"switched to the {package.title()} package"]
    removal = _REMOVE.match(lowered)
    if removal:
        name = removal.group(1).strip()
        new["excluded_places"] = list(dict.fromkeys([*(request.get("excluded_places") or []), name]))
        return new, [f"removed '{name}'"]
    if re.search(r"\bmore relaxed\b|\bslower\b|\bless (?:busy|packed)\b|\bfewer (?:activities|places)\b", lowered):
        new["pace"] = "relaxed"
        changes.append("pace set to relaxed")
    elif re.search(r"\bmore (?:activities|places|packed)\b|\bbusier\b|\bpack(?:ed)? more\b", lowered):
        new["pace"] = "packed"
        changes.append("pace set to packed")
    parsed = parse_travel_text(text, use_llm=False).model_dump()
    if parsed.get("pace") and not changes:
        new["pace"] = parsed["pace"]
        changes.append(f"pace set to {parsed['pace']}")
    if parsed.get("budget") is not None:
        new["budget"] = parsed["budget"]
        new["budget_scope"] = parsed.get("budget_scope") or new.get("budget_scope")
        if not parsed.get("currency_assumed"):
            new["currency"], new["currency_assumed"] = parsed.get("currency"), False
        new["budget_is_user_stated"] = True
        new["package_choice"] = None
        changes.append(f"budget set to {parsed['budget']:g} {new.get('currency') or 'USD'}")
    modes = [mode for mode in parsed.get("transport_preferences") or [] if mode not in (request.get("transport_preferences") or [])]
    if modes:
        new["transport_preferences"] = modes
        changes.append("travel by " + " / ".join(modes))
    if parsed.get("travelers"):
        new["travelers"] = parsed["travelers"]
        changes.append(f"{parsed['travelers']} traveler(s)")
    if parsed.get("start_date"):
        new["start_date"] = parsed["start_date"]
        new["end_date"] = parsed.get("end_date")
        if parsed.get("end_date"):
            new["duration_days"] = None
        changes.append("travel dates updated")
    elif re.search(r"\b\d+\s*-?\s*days?\b|\ba week\b|\bweekend\b", lowered) and parsed.get("duration_days"):
        new["duration_days"] = parsed["duration_days"]
        new["end_date"] = None
        changes.append(f"{parsed['duration_days']} days")
    added = [item for item in parsed.get("preferences") or [] if item not in (request.get("preferences") or [])]
    if added:
        new["preferences"] = [*(request.get("preferences") or []), *added]
        changes.append("added interests: " + ", ".join(added))
    if changes:
        new.pop("duration_nights", None)
        complete_dates(new)
    return TravelRequest.model_validate(new).model_dump(), changes
