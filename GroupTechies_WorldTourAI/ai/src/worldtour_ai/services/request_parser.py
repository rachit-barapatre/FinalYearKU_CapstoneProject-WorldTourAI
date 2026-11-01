"""Natural-language travel parser.

OpenRouter is used when a free-model key is configured. A grounded heuristic
covers the same fields when the model is unavailable. Numbers and place names
that do not appear in the user's text are discarded.
"""

from __future__ import annotations

import json
import re
import difflib
from datetime import date, timedelta

from worldtour_ai.config.settings import get_settings
from worldtour_ai.data.places import find_mentions, lookup_place, normalize, place_aliases
from worldtour_ai.prompts.parser_prompt import PARSER_SYSTEM_PROMPT
from worldtour_ai.providers.llm.openrouter_provider import OpenRouterProvider
from worldtour_ai.schemas.models import TravelRequest

_WORDS = {
    "a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12,
}
_MONTHS = {
    "january": 1, "jan": 1, "february": 2, "feb": 2, "march": 3, "mar": 3,
    "april": 4, "apr": 4, "may": 5, "june": 6, "jun": 6, "july": 7, "jul": 7,
    "august": 8, "aug": 8, "september": 9, "sep": 9, "sept": 9, "october": 10,
    "oct": 10, "november": 11, "nov": 11, "december": 12, "dec": 12,
}
_MONTH_ALT = "|".join(sorted(_MONTHS, key=len, reverse=True))
_COUNT = r"\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve"
# Numbers followed by these are dates, durations, or head counts, not money.
_NOT_MONEY_AFTER = re.compile(
    rf"\s*(?:st|nd|rd|th)?\s*(?:(?:-|–|to)\s*\d+\s*(?:st|nd|rd|th)?\s*)?"
    rf"(?:{_MONTH_ALT}|days?|nights?|weeks?|people|persons?|adults?|pax|travell?ers?|friends?|kids?|children|child)\b"
    rf"|-\d{{1,2}}-\d{{1,2}}"
)
_PACES = {
    "relaxed": ("relaxed", "relax", "slow", "laid back", "laid-back", "leisurely", "easy pace", "chill"),
    "packed": ("packed", "busy", "as much as possible", "fast paced", "fast-paced", "intense", "action packed"),
    "balanced": ("balanced", "moderate pace", "normal pace", "medium pace"),
}
_PREFERENCES = {
    "history": ("history", "historical", "heritage", "museum"),
    "food": ("food", "cuisine", "restaurant", "culinary"),
    "nature": ("nature", "mountain", "wildlife", "park"),
    "beach": ("beach", "beaches", "coast"),
    "adventure": ("adventure", "trek", "hiking"),
    "culture": ("culture", "cultural", "art", "temple"),
    "shopping": ("shopping", "market"),
    "nightlife": ("nightlife",),
    "warm": ("warm", "tropical", "sunny"),
}
_CURRENCY = {
    "usd": "USD", "dollar": "USD", "dollars": "USD", "$": "USD",
    "eur": "EUR", "euro": "EUR", "euros": "EUR", "€": "EUR",
    "inr": "INR", "rupee": "INR", "rupees": "INR", "₹": "INR", "rs": "INR", "rs.": "INR",
    "gbp": "GBP", "pound": "GBP", "pounds": "GBP", "£": "GBP",
    "thb": "THB", "baht": "THB",
    "sgd": "SGD", "jpy": "JPY", "yen": "JPY", "aed": "AED", "dirham": "AED", "dirhams": "AED",
}
_MULTIPLIER = {"k": 1_000, "lakh": 100_000, "lakhs": 100_000, "lac": 100_000, "lacs": 100_000,
               "crore": 10_000_000, "crores": 10_000_000, "cr": 10_000_000}
_BUDGET_PATTERN = re.compile(
    r"(?:(?:budget|spend|under|around|about|than|upto|up to|max)\D{0,16}?)?"
    r"([\$€£₹]|\brs\.?|\binr\b|\busd\b)?\s*"
    r"(\d[\d,]*(?:\.\d+)?)\s*"
    r"(k\b|lakhs?\b|lacs?\b|crores?\b|cr\b)?\s*"
    r"(usd|dollars?|eur|euros?|inr|rupees?|rs\.?|gbp|pounds?|thb|baht|sgd|jpy|yen|aed|dirhams?)?"
)
_TRANSPORT_WORDS = {
    "train": r"\b(?:by )?(?:train|rail|railway)\b",
    "bus": r"\b(?:by )?bus\b",
    "cab": r"\b(?:cab|taxi|by car|private car)\b",
    "flight": r"\b(?:fly|flying|flight|flights|by air)\b",
}


def parse_travel_text(
    text: str, pending_fields: list[str] | None = None, previous: dict | None = None, use_llm: bool = True
) -> TravelRequest:
    pending = pending_fields or []
    heuristic = _heuristic(text, pending)
    if previous and pending:
        allowed = set(pending) | {
            "budget_is_user_stated", "budget_scope", "currency", "currency_assumed", "parser_notes",
            "duration_nights", "travelers", "travel_month", "special_requirements", "transport_preferences",
        }
        if "start_date" in pending:
            allowed |= {"end_date"}
        if "preferences" in pending:
            allowed |= {"pace", "trip_type"}
        heuristic = _merge(previous, {key: value for key, value in heuristic.items() if key in allowed})
    elif previous:
        heuristic = _merge(previous, heuristic)
    llm_request = _try_llm(text) if use_llm else None
    if llm_request is not None:
        grounded = _ground_llm(llm_request, text)
        merged = _merge(heuristic, grounded)
        merged["parser_mode"] = "openrouter+heuristic"
    else:
        merged = heuristic
        merged["parser_mode"] = "heuristic"
    complete_dates(merged)
    resolve_currency(merged)
    return TravelRequest.model_validate(merged)


def resolve_currency(data: dict) -> None:
    """An amount without a currency is read in the currency of the country the trip starts from."""
    from worldtour_ai.utils.money import COUNTRY_CURRENCY

    if not data.get("currency_assumed"):
        return
    origin = lookup_place(data.get("origin"))
    currency = COUNTRY_CURRENCY.get(origin.country if origin else "")
    if not currency:
        return
    data["currency"] = currency
    note = f"Currency was not stated; read the amount as {currency} because the trip starts in {origin.name}."
    notes = [n for n in data.get("parser_notes") or [] if not n.startswith("Currency was not stated")]
    data["parser_notes"] = notes + [note]


def complete_dates(data: dict) -> None:
    """Derive end_date or duration_days from the other two date fields. Explicit dates win."""
    start, end = _iso(data.get("start_date")), _iso(data.get("end_date"))
    days = data.get("duration_days")
    if start and end and end >= start:
        span = (end - start).days + 1
        if days != span:
            data["duration_days"] = span
    elif start and days:
        data["end_date"] = (start + timedelta(days=int(days) - 1)).isoformat()
    if start:
        data["travel_month"] = start.month


def trip_start(request: dict) -> tuple[date, bool]:
    """The trip's first day and whether it was assumed (no date given).

    Without dates: the 10th of the travel month, else two weeks from today (inside the
    weather forecast window). Flights, hotels and weather all use this same date.
    """
    stated = _iso(request.get("start_date"))
    if stated:
        return stated, False
    today = date.today()
    month = request.get("travel_month")
    if month:
        year = today.year + (1 if int(month) < today.month else 0)
        candidate = date(year, int(month), 10)
        return (candidate if candidate > today else today + timedelta(days=14)), True
    return today + timedelta(days=14), True


def _iso(value) -> date | None:
    try:
        return date.fromisoformat(str(value)) if value else None
    except ValueError:
        return None


def missing_essential(request: TravelRequest) -> list[str]:
    missing = []
    if not request.destination and not request.cities:
        missing.append("destination")
    if not request.origin:
        missing.append("origin")
    if not request.duration_days and not (request.start_date and request.end_date):
        missing.append("duration_days")
    if request.budget is None:
        missing.append("budget")
    if request.budget_scope == "per_person" and not request.travelers:
        missing.append("travelers")
    return missing


def clarification_message(missing: list[str]) -> str:
    prompts = {
        "destination": "Where do you want to go?",
        "origin": "Where will you be traveling from?",
        "duration_days": "Approximately how many days do you have?",
        "budget": "Do you have a preferred budget? Include the amount and currency if you can.",
        "travelers": "How many people are traveling?",
        "cities": "Which cities should be included?",
        "start_date": "When do you want to travel? (for example 12 Dec, or say flexible)",
        "preferences": (
            "What do you enjoy, and what pace do you like? "
            "(for example culture, food, beaches, shopping, adventure; relaxed, balanced or packed)"
        ),
    }
    if len(missing) == 1:
        return f"I can plan that. {prompts[missing[0]]}\n\nYou can answer naturally."
    lines = ["I can plan this trip, but I need a few details.", ""]
    for index, field in enumerate(missing, start=1):
        lines.append(f"{index}. {prompts[field]}")
    lines.extend(["", "You can answer naturally."])
    return "\n".join(lines)


def user_skipped(text: str) -> bool:
    lowered = normalize(text)
    return lowered in {
        "skip", "no", "none", "any", "no preference", "you decide", "you choose", "whatever",
        "flexible", "not sure", "dont know", "don't know", "anything", "doesn't matter", "doesnt matter",
    }


def grounded_llm_fields(text: str) -> dict | None:
    """OpenRouter extraction of the request, keeping only grounded fields. None when unavailable."""
    payload = _try_llm(text)
    return _ground_llm(payload, text) if payload else None


def _try_llm(text: str) -> dict | None:
    settings = get_settings()
    if not settings.openrouter_api_key or settings.disable_network:
        return None
    if not settings.free_model_allowed():
        return None
    try:
        raw = OpenRouterProvider().complete(PARSER_SYSTEM_PROMPT, text)
    except Exception:
        return None
    return _parse_json_object(raw)


def _parse_json_object(raw: str) -> dict | None:
    cleaned = raw.strip()
    cleaned = re.sub(r"^```(?:json)?", "", cleaned).strip()
    cleaned = re.sub(r"```$", "", cleaned).strip()
    start, end = cleaned.find("{"), cleaned.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        payload = json.loads(cleaned[start : end + 1])
    except json.JSONDecodeError:
        return None
    return payload if isinstance(payload, dict) else None


def _ground_llm(payload: dict, text: str) -> dict:
    lowered = text.lower()
    result = {}
    if _mentioned(payload.get("origin"), lowered):
        result["origin"] = _canonical(payload.get("origin"))
    if _mentioned(payload.get("destination"), lowered):
        result["destination"] = _canonical(payload.get("destination"))
    cities = []
    for city in payload.get("cities") or []:
        if not _mentioned(city, lowered):
            continue
        place = lookup_place(city)
        if place is None or place.kind != "city":
            continue
        if normalize(place.name) in {normalize(str(payload.get("origin") or "")), normalize(str(payload.get("destination") or ""))}:
            continue
        cities.append(place.name)
    if cities:
        result["cities"] = cities
        result["cities_are_suggestions"] = False
    if _number_in_text(payload.get("budget"), lowered):
        result["budget"] = payload.get("budget")
        result["budget_is_user_stated"] = True
    if _number_in_text(payload.get("duration_days"), lowered) or _has_week(lowered):
        result["duration_days"] = payload.get("duration_days")
    if _number_in_text(payload.get("travelers"), lowered) or "friend" in lowered or "solo" in lowered:
        result["travelers"] = payload.get("travelers")
    for key in ("start_date", "end_date"):
        if _date_in_text(payload.get(key), lowered):
            result[key] = payload[key]
    for key in (
        "currency", "budget_scope", "preferences", "trip_type", "travel_month",
        "hotel_preferences", "transport_preferences", "must_visit", "constraints",
    ):
        if payload.get(key) not in (None, [], ""):
            result[key] = payload[key]
    return result


def _canonical(value: str) -> str:
    place = lookup_place(value)
    return place.name if place else value


def _mentioned(value, lowered: str) -> bool:
    if not isinstance(value, str) or not value.strip():
        return False
    return normalize(value) in lowered


def _number_in_text(value, lowered: str) -> bool:
    if not isinstance(value, (int, float)):
        return False
    as_int = str(int(value))
    return as_int in re.sub(r"[,$]", "", lowered)


def _has_week(lowered: str) -> bool:
    return bool(re.search(r"\bweeks?\b", lowered))


def _date_in_text(value, lowered: str) -> bool:
    """An LLM date counts only if its day number and month appear in the user's text."""
    parsed = _iso(value)
    if parsed is None:
        return False
    if parsed.isoformat() in lowered:
        return True
    month_named = any(_MONTHS[name] == parsed.month and re.search(rf"\b{name}\b", lowered) for name in _MONTHS)
    return month_named and bool(re.search(rf"\b0?{parsed.day}(?:st|nd|rd|th)?\b", lowered))


_SHORTHAND = [
    (r"\b(?:frm|fom|frome)\b", "from"),
    (r"\b(?:frnds?|frndz|frnz|frens)\b", "friends"),
    (r"\bwe\s+r\b", "we are"),
    (r"\blong\s+weekend\b", "3 days"),
    # Other ways of naming where the trip starts.
    (r"\b(?:flying out of|flying from|departing from|leaving from|starting from|out of|based in|i live in|we live in|we are in|i am in|i'm in|living in)\b", "from"),
    (r"\b(?:budgt|budjet|bujet|bdgt)\b", "budget"),
    (r"\b(\d+)\s*(?:d|dy|dys|dayz|din|dino)\b", r"\1 days"),
    (r"\b(\d+)\s*(?:n|nt|nts|nite|nites|raat|raatein)\b", r"\1 nights"),
    (r"\b(\d+)\s*(?:ppl|pple|peeps|log|logo|jan|members?|heads?)\b", r"\1 people"),
    (r"\b(\d+(?:\.\d+)?)\s*(?:l|lk|lac|lacs|lakhs?)\b", r"\1 lakh"),
    (r"\b(\d+)\s*-\s*(\d+)\s+days\b", r"\2 days"),
]
_THOUSAND = re.compile(r"\b(\d+(?:\.\d+)?)\s*(?:thousand|thousands|hazaar|hazar|hajar)\b")
_SE = re.compile(r"\b([a-z]+(?:\s[a-z]+)?)\s+se\b")
# Ordinary words that look like place names to a fuzzy matcher.
_NOT_PLACES = {"budget", "beaches", "people", "trip", "friends", "family", "shopping", "within", "around", "mumbai", "nights", "rupees"}


def normalize_request_text(text: str) -> str:
    """Rewrite chat shorthand into words the parser reads: "goa frm mumbai 4day 2ppl 1.5L" →
    "goa from mumbai 4 days 2 people 1.5 lakh"; Hindi "delhi se" → "from delhi"; misspelt places are corrected."""
    out = " ".join(text.split())
    for pattern, repl in _SHORTHAND:
        out = re.sub(pattern, repl, out, flags=re.IGNORECASE)
    out = _THOUSAND.sub(lambda m: f"{float(m.group(1)) * 1000:g}", out)

    def from_place(match: re.Match) -> str:
        words = match.group(1)
        last = words.split()[-1]
        place = lookup_place(words) or lookup_place(last)
        if not place:
            return match.group(0)
        prefix = words[: -len(last)] if not lookup_place(words) else ""
        # "mumbai se goa" is "from mumbai to goa" when a place follows.
        following = match.string[match.end():].split()[:1]
        joiner = " to" if following and lookup_place(following[0].strip(" ,.")) else ""
        return f"{prefix}from {words[len(prefix):]}{joiner}"

    out = _SE.sub(from_place, out)
    return _fix_place_typos(out)


def _fix_place_typos(text: str) -> str:
    known = set(place_aliases())
    fixed = []
    for token in re.split(r"(\W+)", text):
        word = token.lower()
        if len(word) >= 5 and word.isalpha() and word not in known and word not in _NOT_PLACES:
            close = difflib.get_close_matches(word, known, n=1, cutoff=0.8)
            # Same first letter and nearly the same length: "manaali" → manali, but "parties" is not "paris".
            if close and close[0][0] == word[0] and " " not in close[0] and abs(len(close[0]) - len(word)) <= 1:
                token = close[0]
        fixed.append(token)
    return "".join(fixed)


def _heuristic(text: str, pending: list[str]) -> dict:
    raw = normalize_request_text(text)
    lowered = raw.lower()
    mentions = find_mentions(raw)
    data: dict = {
        "cities": [],
        "preferences": [],
        "must_visit": [],
        "transport_preferences": [],
        "hotel_preferences": [],
        "food_preferences": [],
        "activity_preferences": [],
        "constraints": [],
        "special_requirements": [],
        "parser_notes": [],
    }
    _extract_route_phrase(raw, mentions, data)
    _extract_cities(lowered, mentions, data)
    _extract_duration(lowered, data)
    _extract_budget(lowered, data)
    _extract_travelers(lowered, data)
    _extract_month(lowered, data)
    _extract_dates(lowered, data)
    _extract_styles(lowered, data)
    _extract_pace(lowered, data)
    _apply_pending(raw, pending, data)
    if not data.get("destination") and len(data["cities"]) == 1:
        data["destination"] = data["cities"][0]
    if not data.get("destination") and len(data["cities"]) > 1:
        data["destination"] = "Multi-city"
    return data


def _extract_route_phrase(raw: str, mentions, data: dict) -> None:
    match = re.search(
        r"\bfrom\s+(.+?)\s+to\s+(.+?)(?:\.|,| with| for| covering| and we| we|$)",
        raw,
        flags=re.IGNORECASE,
    )
    if match:
        origin = _place_in_span(match.group(1))
        destination = _place_in_span(match.group(2))
        if origin:
            data["origin"] = origin.name
        if destination:
            data["destination"] = destination.name
            if destination.kind == "region" and destination.suggested_cities and not data["cities"]:
                data["cities"] = list(destination.suggested_cities)
                data["cities_are_suggestions"] = True
                data["parser_notes"].append(
                    f"Cities {', '.join(destination.suggested_cities)} are suggestions for {destination.name}, not places you named."
                )
        return
    # "Mumbai to Goa": two known places joined only by "to".
    for (s1, e1, first), (s2, _e2, second) in zip(mentions, mentions[1:]):
        if raw[e1:s2].strip().lower() == "to" and first.name != second.name:
            data["origin"] = first.name
            data["destination"] = second.name
            if second.kind == "region" and second.suggested_cities and not data["cities"]:
                data["cities"] = list(second.suggested_cities)
                data["cities_are_suggestions"] = True
            return
    reverse = re.search(r"\bto\s+(.+?)\s+from\s+([A-Za-z][A-Za-z\s]+)", raw, flags=re.IGNORECASE)
    if reverse:
        destination = _place_in_span(reverse.group(1))
        origin = _place_in_span(reverse.group(2))
        if destination:
            data["destination"] = destination.name
        if origin:
            data["origin"] = origin.name
        return
    # "Goa from Mumbai", "Plan a Jaipur trip from Delhi": the place before "from" is where they are going.
    from_match = re.search(r"\bfrom\s+([A-Za-z][A-Za-z\s]+)", raw, flags=re.IGNORECASE)
    if from_match:
        origin = _place_in_span(from_match.group(1))
        before = [place for start, _end, place in mentions if start < from_match.start()]
        after = [place for start, _e, place in mentions if start > from_match.start() and place.name != (origin.name if origin else "")]
        if origin and not before and after:
            # "I live in Pune, want 3 days in Goa": the start comes first, the destination later.
            data["origin"] = origin.name
            data["destination"] = after[0].name
            if after[0].kind == "region" and after[0].suggested_cities and not data["cities"]:
                data["cities"] = list(after[0].suggested_cities)
                data["cities_are_suggestions"] = True
            return
        if origin and not before and len({place.name for _s, _e, place in mentions}) == 1:
            # "4 friends from Pune, beach, long weekend": the only place named is where they start.
            data["origin"] = origin.name
            return
        if origin and before and before[0].name != origin.name:
            destination = before[0]
            data["origin"] = origin.name
            data["destination"] = destination.name
            if destination.kind == "region" and destination.suggested_cities and not data["cities"]:
                data["cities"] = list(destination.suggested_cities)
                data["cities_are_suggestions"] = True
                data["parser_notes"].append(
                    f"Cities {', '.join(destination.suggested_cities)} are suggestions for {destination.name}, not places you named."
                )
            return
    to_match = re.search(r"\b(?:to|in|explore|visit|visiting)\s+([A-Za-z][A-Za-z\s]+)", raw)
    if to_match and not data.get("destination"):
        place = _place_in_span(to_match.group(1))
        if place:
            data["destination"] = place.name
            if place.kind == "region" and place.suggested_cities:
                data["cities"] = list(place.suggested_cities)
                data["cities_are_suggestions"] = True
                data["parser_notes"].append(
                    f"Cities {', '.join(place.suggested_cities)} are suggestions for {place.name}, not places you named."
                )


def _place_in_span(fragment: str):
    hits = find_mentions(fragment)
    return hits[0][2] if hits else lookup_place(fragment.strip(" .,"))


def _extract_cities(lowered: str, mentions, data: dict) -> None:
    cover = re.search(r"\b(?:covering|visit|visiting|including)\b(.+)", lowered)
    named = []
    pool = find_mentions(cover.group(1)) if cover else mentions
    origin_name = normalize(data.get("origin") or "")
    dest_name = normalize(data.get("destination") or "")
    for _s, _e, place in pool:
        if place.kind != "city":
            continue
        if normalize(place.name) in {origin_name, dest_name}:
            continue
        if place.name not in named:
            named.append(place.name)
    if named:
        data["cities"] = named
        data["cities_are_suggestions"] = False


def _extract_duration(lowered: str, data: dict) -> None:
    word_alt = "|".join(_WORDS)
    patterns = [
        rf"\b(\d+)\s*-?\s*days?\b",
        rf"\b({word_alt})\s+days?\b",
        rf"\b(\d+)\s+nights?\b",
        rf"\b({word_alt})\s+nights?\b",
    ]
    day_match = re.search(patterns[0], lowered) or re.search(patterns[1], lowered)
    night_match = re.search(patterns[2], lowered) or re.search(patterns[3], lowered)
    if day_match:
        data["duration_days"] = _number_token(day_match.group(1))
    elif re.search(r"\b(a|one)\s+week\b|\babout a week\b", lowered):
        data["duration_days"] = 7
        data["parser_notes"].append("Interpreted 'a week' as 7 days.")
    elif "weekend" in lowered:
        data["duration_days"] = 2
        data["parser_notes"].append("Interpreted 'weekend' as 2 days.")
    if night_match:
        nights = _number_token(night_match.group(1))
        data["duration_nights"] = nights
        if "duration_days" not in data and nights is not None:
            data["duration_days"] = nights + 1
            data["parser_notes"].append("Derived duration_days as nights + 1.")


def _extract_budget(lowered: str, data: dict) -> None:
    each = bool(re.search(r"\b(each|per person|apiece|pp)\b", lowered))
    candidates = [item for item in _BUDGET_PATTERN.finditer(lowered) if _budget_context(lowered, item)]
    # An amount carrying its own currency or unit ("50000 rupees", "40k") beats a bare number near the word
    # "budget" ("family of 4, 50000 rupees" must not read as 4).
    match = next((item for item in candidates if item.group(1) or item.group(3) or item.group(4)), None) or (candidates[0] if candidates else None)
    if not match:
        match = _bare_amount(lowered)
    if match:
        multiplier = match.group(3) or ""
        amount = float(match.group(2).replace(",", "")) * _MULTIPLIER.get(multiplier, 1)
        prefix = (match.group(1) or "").strip()
        word = (match.group(4) or "").strip()
        currency = _CURRENCY.get(prefix) or _CURRENCY.get(word) or ("INR" if multiplier in _MULTIPLIER and multiplier != "k" else None)
        data["budget"] = amount
        data["budget_is_user_stated"] = True
        data["budget_scope"] = "per_person" if each else "total"
        if currency:
            data["currency"] = currency
            data["currency_assumed"] = False
        else:
            data["currency"] = "USD"
            data["currency_assumed"] = True
            data["parser_notes"].append("Currency was not stated.")
    # "a budget of 1500" is an amount, not a travel style; only explicit budget-travel phrases count.
    if re.search(r"\bcheap\b|\bbudget (?:trip|travel|holiday|vacation|stay|hotel)s?\b|\bon a (?:tight )?budget\b|\blow budget\b|\bbackpack", lowered):
        data["trip_type"] = data.get("trip_type") or "budget"
    if "moderate budget" in lowered or re.search(r"\bmoderate\b", lowered):
        data["parser_notes"].append("A moderate budget was mentioned without an amount.")
    if re.search(r"\bluxury\b", lowered):
        data["trip_type"] = "luxury"


def _bare_amount(lowered: str) -> re.Match | None:
    """A lone number of 1,000 or more is the budget ("jaipur 3 days 2 people 25000"), unless it is a year
    or carries a unit such as days, km or people."""
    for item in _BUDGET_PATTERN.finditer(lowered):
        digits = item.group(2).replace(",", "")
        if not digits.replace(".", "").isdigit() or float(digits) < 1000:
            continue
        if re.fullmatch(r"(19|20)\d\d", digits):
            continue
        if _NOT_MONEY_AFTER.match(lowered[item.end(2) : item.end(2) + 24]):
            continue
        return item
    return None


def _budget_context(lowered: str, match: re.Match) -> bool:
    if match.group(1) or match.group(3) or match.group(4):
        return True
    after = lowered[match.end(2) : match.end(2) + 24]
    before = lowered[max(0, match.start(2) - 12) : match.start(2)]
    if _NOT_MONEY_AFTER.match(after) or re.search(rf"\b(?:{_MONTH_ALT})\s*$", before):
        return False
    window = lowered[max(0, match.start(2) - 24) : match.end(2) + 12]
    return bool(re.search(r"\b(budget|spend|under|around|about|than|usd|dollar|euro|rupee|inr|gbp)\b", window))


def _extract_travelers(lowered: str, data: dict) -> None:
    kids = re.search(rf"\b({_COUNT})\s+(?:kids?|children|child)\b", lowered)
    if kids or re.search(r"\bwith (?:my |our )?(?:kids|children|child|son|daughter)\b", lowered):
        data.setdefault("special_requirements", []).append("traveling with children")
    adults = re.search(rf"\b({_COUNT})\s+(?:adults?)\b", lowered)
    if adults:
        data["travelers"] = _number_token(adults.group(1)) + (_number_token(kids.group(1)) if kids else 0)
        return
    people = re.search(rf"\b({_COUNT})\s+(?:people|persons?|pax|travell?ers?|of us|guests?)\b", lowered)
    group = re.search(rf"\b(?:we(?:'re| are)|family of|group of|party of)\s+({_COUNT})\b", lowered)
    found = people or group
    if found:
        data["travelers"] = _number_token(found.group(1))
        return
    # "for 3 friends" names the whole group; "me and 3 friends" adds the speaker (below).
    named = re.search(r"\bfor\s+(\d+|two|three|four|five|six)\s+(?:friends|buddies|colleagues)\b", lowered)
    if named:
        data["travelers"] = _number_token(named.group(1))
        return
    friends = re.search(r"\b(?:with|and)\s+(\d+|two|three|four|five)\s+friends?\b", lowered)
    if friends:
        data["travelers"] = _number_token(friends.group(1)) + 1
        data["parser_notes"].append("Traveler count includes you plus the friends you named.")
        return
    if re.search(r"\b(solo|alone|just me)\b", lowered):
        data["travelers"] = 1
    elif re.search(r"\b(my wife|my husband|my partner|my (?:gf|bf|girlfriend|boyfriend|fiancee?|fiancée?|spouse)|couple|honeymoon)\b", lowered):
        data["travelers"] = 2
        data["parser_notes"].append("Interpreted a couple as 2 travelers.")
    if "family" in lowered:
        data["trip_type"] = data.get("trip_type") or "family"


def _extract_month(lowered: str, data: dict) -> None:
    for name, number in _MONTHS.items():
        if name == "may":
            # "I may go" is not a month; require a date-like context.
            pattern = r"\b(?:in|during|of|early|late|mid|this|next)\s+may\b|\bmay\s+\d|\d(?:st|nd|rd|th)?\s+may\b"
        else:
            pattern = rf"\b{name}\b"
        if re.search(pattern, lowered):
            data["travel_month"] = number
            break


def _extract_dates(lowered: str, data: dict) -> None:
    """ISO dates, "12 Dec", "12-18 December 2026", "Dec 12 to 18", or "tomorrow"."""
    found: list[date] = []
    for match in re.finditer(r"\b(\d{4})-(\d{1,2})-(\d{1,2})\b", lowered):
        found.append(_safe_date(int(match[1]), int(match[2]), int(match[3])))
    suffix = r"(?:st|nd|rd|th)?"
    span = rf"(?:\s*(?:-|–|to|until|till)\s*(\d{{1,2}}){suffix})?"
    if not found:
        # Two full dates, e.g. "12 Dec 2026 to 18 Dec 2026"; a year on the second one applies to both.
        full = list(re.finditer(rf"\b(\d{{1,2}}){suffix}\s+(?:of\s+)?({_MONTH_ALT})\b(?:,?\s+(\d{{4}}))?", lowered))
        if len(full) >= 2:
            year_end = full[1][3]
            year_start = full[0][3] or year_end
            start = _future_date(int(year_start) if year_start else None, _MONTHS[full[0][2]], int(full[0][1]))
            end = _future_date(int(year_end) if year_end else None, _MONTHS[full[1][2]], int(full[1][1]), after=start)
            found += [start, end]
    if not found:
        day_first = re.search(rf"\b(\d{{1,2}}){suffix}{span}\s+(?:of\s+)?({_MONTH_ALT})\b(?:,?\s+(\d{{4}}))?", lowered)
        month_first = re.search(rf"\b({_MONTH_ALT})\s+(\d{{1,2}}){suffix}{span}(?:,?\s+(\d{{4}}))?\b", lowered)
        if day_first:
            first, last, month, year = day_first[1], day_first[2], day_first[3], day_first[4]
        elif month_first:
            month, first, last, year = month_first[1], month_first[2], month_first[3], month_first[4]
        else:
            first = None
        if first:
            start = _future_date(int(year) if year else None, _MONTHS[month], int(first))
            found.append(start)
            if last and start:
                found.append(_future_date(int(year) if year else None, _MONTHS[month], int(last), after=start))
    if not found and re.search(r"\btomorrow\b", lowered):
        found.append(date.today() + timedelta(days=1))
    found = [item for item in found if item]
    if not found:
        return
    data["start_date"] = found[0].isoformat()
    if len(found) > 1 and found[1] >= found[0]:
        data["end_date"] = found[1].isoformat()


def _safe_date(year: int, month: int, day: int) -> date | None:
    try:
        return date(year, month, day)
    except ValueError:
        return None


def _future_date(year: int | None, month: int, day: int, after: date | None = None) -> date | None:
    """A date without a year means the next time that day comes around."""
    today = date.today()
    candidate = _safe_date(year or today.year, month, day)
    if candidate and year is None and candidate < (after or today):
        candidate = _safe_date(candidate.year + 1, month, day)
    return candidate


def _extract_pace(lowered: str, data: dict) -> None:
    for pace, words in _PACES.items():
        if any(re.search(rf"\b{re.escape(word)}\b", lowered) for word in words):
            data["pace"] = pace
            return


def _extract_styles(lowered: str, data: dict) -> None:
    prefs = []
    for label, words in _PREFERENCES.items():
        if any(re.search(rf"\b{re.escape(word)}\b", lowered) for word in words):
            prefs.append(label)
    data["preferences"] = prefs
    if "romantic" in lowered:
        data["trip_type"] = "romantic"
    elif "business" in lowered or "conference" in lowered:
        data["trip_type"] = "business"
    elif "adventure" in lowered and not data.get("trip_type"):
        data["trip_type"] = "adventure"
    if "road trip" in lowered or re.search(r"\bdrive\b|\bdriving\b", lowered):
        data["transport_preferences"].append("road")
    for mode, pattern in _TRANSPORT_WORDS.items():
        if re.search(pattern, lowered) and mode not in data["transport_preferences"]:
            data["transport_preferences"].append(mode)
    if "city center" in lowered or "city centre" in lowered:
        data["hotel_preferences"].append("near city center")
    if "good hotel" in lowered:
        data["hotel_preferences"].append("well rated")


def _apply_pending(raw: str, pending: list[str], data: dict) -> None:
    if not pending:
        return
    still = [field for field in pending if not data.get(field)]
    if not still:
        return
    if user_skipped(raw):
        data["parser_notes"].append(f"You skipped: {', '.join(still)}.")
        return
    if len(still) == 1:
        _coerce(still[0], raw, data)
        return
    parts = [part.strip() for part in re.split(r",| and ", raw) if part.strip()]
    for field, part in zip(still, parts):
        _coerce(field, part, data)


def _coerce(field: str, text: str, data: dict) -> None:
    if field in {"origin", "destination"}:
        place = _place_in_span(text)
        if not place:
            data["parser_notes"].append(f"'{text.strip()}' was not recognized as a {field}.")
            return
        data[field] = place.name
        if field == "destination":
            resolved = lookup_place(data[field])
            if resolved and resolved.kind == "region" and not data.get("cities"):
                data["cities"] = list(resolved.suggested_cities)
                data["cities_are_suggestions"] = True
    elif field == "duration_days":
        _extract_duration(text.lower(), data)
        # A bare number means days, unless it is part of a date ("12 Dec 2026 to 18 Dec 2026").
        has_date = re.search(rf"\b\d{{4}}-\d{{1,2}}-\d{{1,2}}\b|\b({_MONTH_ALT})\b", text.lower())
        if "duration_days" not in data and not has_date:
            token = re.search(r"\d+", text)
            if token:
                data["duration_days"] = int(token.group(0))
    elif field == "budget":
        _extract_budget(text.lower(), data)
        if "budget" not in data:
            # A bare amount answering the budget question, e.g. "1500" or "max 2,000".
            token = re.fullmatch(r"\s*(?:about|around|under|max|maximum|up to|upto)?\s*(\d[\d,]*(?:\.\d+)?)\s*", text.lower())
            if token:
                data["budget"] = float(token.group(1).replace(",", ""))
                data["budget_is_user_stated"] = True
                data["budget_scope"] = "total"
                data["currency"] = "USD"
                data["currency_assumed"] = True
                data["parser_notes"].append("Currency was not stated.")
    elif field == "travelers":
        _extract_travelers(text.lower(), data)
        if "travelers" not in data:
            # A bare count answering the travelers question, e.g. "2" or "three".
            token = re.fullmatch(rf"\s*(?:just\s+)?({_COUNT})\s*(?:of us)?\s*", text.lower())
            if token and 0 < _number_token(token.group(1)) <= 50:
                data["travelers"] = _number_token(token.group(1))
    elif field == "start_date":
        _extract_dates(text.lower(), data)


def _number_token(token: str) -> int:
    if token.isdigit():
        return int(token)
    return _WORDS[token]


def _merge(base: dict, update: dict) -> dict:
    merged = dict(base)
    for key, value in update.items():
        if value is None or value == [] or value == "":
            continue
        merged[key] = value
    return merged
