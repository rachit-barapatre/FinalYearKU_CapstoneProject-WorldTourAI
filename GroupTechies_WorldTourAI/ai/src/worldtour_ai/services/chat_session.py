"""Stateless, one-message-at-a-time version of the chat for the web API.

The browser keeps the session dict and sends it back with every message, so no server
memory is needed between requests (which suits serverless hosting). Stages:

    collecting  -> asking for missing trip details
    feasibility -> the trip doesn't add up; waiting for yes / a change / continue
    ready       -> the request is complete; the client should run the plan
    planned     -> a plan exists; new messages are treated as changes to it
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

import re

from worldtour_ai.config.settings import get_settings
from worldtour_ai.data.places import lookup_place, normalize
from worldtour_ai.schemas.models import TravelRequest
from worldtour_ai.services.intake import (
    MAX_ROUNDS,
    _OPTIONAL,
    accept_remaining,
    apply_feasibility_answer,
    apply_refinement,
    blocking_issues,
    feasibility_message,
    finalize_collected,
    intake_missing,
    merge_grounded,
    trim_suggested_cities,
)
from worldtour_ai.services.request_parser import (
    clarification_message,
    grounded_llm_fields,
    missing_essential,
    parse_travel_text,
    trip_start,
    user_skipped,
)
from worldtour_ai.utils.money import display_currency


def new_session() -> dict:
    return {"stage": "collecting", "request": None, "pending": [], "skipped": [], "round": 0, "history": []}


def chat_step(session: dict | None, message: str, use_llm: bool = True, defaults: dict | None = None) -> dict:
    """Advance the conversation by one user message. Returns {session, reply, ready, changes}.

    defaults: a signed-in traveler's saved settings, {"home_city": ..., "currency": ...}. The home city
    is the starting point when the first message names none; the currency is used for display.
    """
    session = dict(session or new_session())
    text = (message or "").strip()
    history = list(session.get("history") or [])
    history.append({"role": "user", "content": text})
    stage = session.get("stage") or "collecting"
    changes: list[str] = []

    if stage == "planned":
        updated, changes = apply_refinement(session["request"], text)
        if not changes:
            return _reply(session, history, "I didn't catch a change there. Try 'premium', 'by train', '5 days', "
                          "'budget 50000 INR', 'remove <place>' or 'more relaxed'.")
        session["request"] = updated
        return _check_feasibility(session, history, changes, round_number=0)

    if stage == "feasibility":
        issues = blocking_issues(session["request"])
        data, understood = apply_feasibility_answer(session["request"], issues, text)
        if not understood:
            return _reply(session, history, "Sorry, I didn't understand. Reply 'yes', tell me what to change "
                          "(for example '6 days' or 'budget 80000 INR'), or say 'continue'.")
        session["request"] = data
        return _check_feasibility(session, history, changes, round_number=int(session.get("feasibility_round") or 0) + 1)

    # Collecting the trip details. The built-in parser reads the message instantly; the AI is asked only
    # when an essential detail is still missing (it is slow, but cheaper for the traveler than a question).
    if session.get("request") is None:
        request = parse_travel_text(text or "trip", use_llm=False)
        request = _apply_defaults(request, defaults or {})
        if use_llm and _ai_might_help(request, text):
            data = request.model_dump()
            merge_grounded(data, _llm_fields_within_limit(text))
            request = TravelRequest.model_validate(data)
    elif user_skipped(text):
        session["skipped"] = [*session.get("skipped", []), *(f for f in session.get("pending", []) if f not in _OPTIONAL)]
        request = TravelRequest.model_validate(session["request"])
    else:
        pending = session.get("pending") or []
        request = parse_travel_text(text, pending_fields=pending, previous=session["request"], use_llm=False)
        still = [field for field in pending if field not in _OPTIONAL and field in _essentials_missing(request)]
        if use_llm and still and len(still) == len([f for f in pending if f not in _OPTIONAL]):
            # Nothing in the answer was understood: let the AI read it in the context of the question.
            data = request.model_dump()
            merge_grounded(data, _llm_fields_within_limit(f"{_question_context(pending)} Answer: {text}"))
            request = TravelRequest.model_validate(data)
    round_number = int(session.get("round") or 0)
    missing = [field for field in intake_missing(request, round_number == 0) if field not in session.get("skipped", [])]
    if missing and round_number < MAX_ROUNDS:
        session.update(request=request.model_dump(), pending=missing, round=round_number + 1)
        said = " ".join(item["content"] for item in history if item["role"] == "user")
        return _reply(session, history, _ask(request, missing, said))
    data = finalize_collected(request, session.get("skipped", []), None)
    trim_suggested_cities(data)
    session.update(request=data, pending=[])
    return _check_feasibility(session, history, changes, round_number=0)


def _apply_defaults(request: TravelRequest, defaults: dict) -> TravelRequest:
    data = request.model_dump()
    home = lookup_place(defaults.get("home_city")) if defaults.get("home_city") else None
    if home and not data.get("origin") and normalize(home.name) != normalize(str(data.get("destination") or "")):
        data["origin"] = home.name
        data["parser_notes"] = [*(data.get("parser_notes") or []), f"Starting from {home.name}, your home city in Settings."]
    currency = str(defaults.get("currency") or "").upper()
    if re.fullmatch(r"[A-Z]{3}", currency):
        data["preferred_currency"] = currency
    return TravelRequest.model_validate(data)


def _essentials_missing(request: TravelRequest) -> list[str]:
    missing = missing_essential(request)
    if not request.travelers:
        missing.append("travelers")
    return missing


def _ai_might_help(request: TravelRequest, text: str) -> bool:
    """The AI can only find what the message contains: worth the wait when a detail other than the
    destination is missing from a message long enough to hold it ("somewhere with snow" names no place)."""
    return bool(set(_essentials_missing(request)) - {"destination"}) and len(text.split()) >= 8


def _question_context(pending: list[str]) -> str:
    return "The traveler was asked for: " + ", ".join(pending).replace("_", " ") + "."


def _ask(request: TravelRequest, missing: list[str], said: str = "") -> str:
    """Say what was understood, then ask only for what is missing (with destination ideas when none was given)."""
    known = understood(request.model_dump())
    question = clarification_message(missing)
    if "destination" in missing:
        ideas = destination_ideas(request, said)
        question = question.replace("Where do you want to go?", f"Where do you want to go? ({ideas})")
    if not known:
        return question
    lead = "I can plan that." if len(missing) == 1 else "I can plan this trip, but I need a few details."
    return question.replace(lead, f"Got it: {known}.\n\n" + ("Just one more thing." if len(missing) == 1 else "A few more details:"), 1)


def understood(request: dict) -> str:
    """'Mumbai → Goa · 4 days · 2 travelers · 40,000 INR · beach' from whatever is known so far."""
    parts = []
    origin, destination = request.get("origin"), request.get("destination")
    cities = [c for c in request.get("cities") or [] if c != destination]
    where = destination if destination and destination != "Multi-city" else ", ".join(cities)
    if destination and destination != "Multi-city" and cities and not request.get("cities_are_suggestions"):
        where = ", ".join([destination, *cities])
    if origin and where:
        parts.append(f"{origin} → {where}")
    elif where:
        parts.append(f"a trip to {where}")
    elif origin:
        parts.append(f"from {origin}")
    if request.get("duration_days"):
        parts.append(f"{request['duration_days']} days")
    if request.get("travelers"):
        parts.append(f"{request['travelers']} traveler{'s' if request['travelers'] > 1 else ''}")
    if request.get("budget") is not None:
        amount = f"{request['budget']:,.0f} {request.get('currency') or ''}".strip()
        parts.append(amount + (" each" if request.get("budget_scope") == "per_person" else ""))
    if request.get("start_date"):
        parts.append(f"from {request['start_date']}")
    interests = [*(request.get("preferences") or [])]
    if request.get("pace"):
        interests.append(f"{request['pace']} pace")
    if interests:
        parts.append(", ".join(interests))
    return " · ".join(parts)


_IDEAS = [
    (("beach", "beaches", "sea", "island"), "for beaches, Goa, Andaman or Puducherry are great"),
    (("snow", "mountain", "mountains", "hill", "hills", "trek"), "for mountains and snow, Manali, Shimla or Kashmir"),
    (("honeymoon", "romantic"), "for a honeymoon, Bali, the Maldives or Udaipur"),
    (("history", "culture", "heritage"), "for history and culture, Jaipur, Udaipur or Varanasi"),
    (("nature", "backwaters", "greenery"), "for nature, Kerala, Coorg or Munnar"),
    (("spiritual", "temple", "yoga"), "for a spiritual trip, Rishikesh or Varanasi"),
    (("adventure", "rafting"), "for adventure, Rishikesh, Manali or Leh Ladakh"),
    (("shopping", "nightlife", "party", "parties"), "for shopping and nightlife, Dubai, Bangkok or Goa"),
]


def destination_ideas(request: TravelRequest, said: str = "") -> str:
    words = {*(request.preferences or []), str(request.trip_type or "")}
    words |= {item.strip(".,!?") for item in said.lower().split()}
    for keys, text in _IDEAS:
        if words & set(keys):
            return text
    return "for example Goa, Jaipur, Kerala, Manali or Dubai"


def _llm_fields_within_limit(text: str) -> dict | None:
    """The AI reading of a message, but never longer than PARSER_LLM_WAIT_SECONDS."""
    pool = ThreadPoolExecutor(max_workers=1)
    future = pool.submit(grounded_llm_fields, text)
    try:
        return future.result(timeout=get_settings().parser_llm_wait_seconds)
    except Exception:
        return None
    finally:
        pool.shutdown(wait=False, cancel_futures=True)


def _check_feasibility(session: dict, history: list[dict], changes: list[str], round_number: int) -> dict:
    issues = blocking_issues(session["request"])
    if issues and round_number < MAX_ROUNDS:
        session.update(stage="feasibility", feasibility_round=round_number)
        return _reply(session, history, feasibility_message(issues), changes=changes)
    if issues:
        session["request"] = accept_remaining(session["request"])
    session.update(stage="ready", feasibility_round=0)
    if changes:
        lead = "Updating the plan: " + "; ".join(changes) + "."
    else:
        request = session["request"]
        lead = f"Great, I have everything I need: {understood(request)}."
        assumed = []
        if not request.get("start_date"):
            start, _ = trip_start(request)
            assumed.append(f"your dates are flexible, so I've planned from {start.strftime('%d %b %Y')} — tap \"Change dates\" to pick yours")
        if not request.get("preferences") and not request.get("pace"):
            assumed.append("you'll get a balanced mix of the top sights")
        if assumed:
            note = "; ".join(assumed)
            lead += " " + note[0].upper() + note[1:] + "."
    return _reply(session, history, lead + " Planning your trip now…", ready=True, changes=changes)


def _reply(session: dict, history: list[dict], text: str, ready: bool = False, changes: list[str] | None = None) -> dict:
    history.append({"role": "assistant", "content": text})
    session["history"] = history[-40:]
    request = session.get("request")
    return {
        "session": session,
        "reply": text,
        "ready": ready,
        "changes": changes or [],
        "summary": summary(request) if request else None,
    }


def summary(request: dict) -> dict:
    """What the chat has understood so far, for the summary card in the UI."""
    return {
        "origin": request.get("origin"),
        "destination": request.get("destination"),
        "cities": request.get("cities") or [],
        "cities_are_suggestions": request.get("cities_are_suggestions", False),
        "start_date": request.get("start_date"),
        "end_date": request.get("end_date"),
        "duration_days": request.get("duration_days"),
        "budget": request.get("budget"),
        "currency": request.get("currency"),
        "budget_scope": request.get("budget_scope"),
        "travelers": request.get("travelers"),
        "pace": request.get("pace"),
        "preferences": request.get("preferences") or [],
        "transport_preferences": request.get("transport_preferences") or [],
        "display_currency": display_currency(request),
        "notes": request.get("parser_notes") or [],
    }
