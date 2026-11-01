"""Check that a collected request can become a sensible trip before any agent runs.

Each issue explains the problem with numbers, suggests a concrete fix, and says whether
planning should wait for the user's decision (blocking) or just carry a note.
"""

from __future__ import annotations

import math
from datetime import date

from worldtour_ai.data.cost_levels import BUDGET_NIGHT, DAILY_ESTIMATE, DEFAULT_BUDGET_NIGHT, DEFAULT_DAILY
from worldtour_ai.data.places import lookup_place
from worldtour_ai.services.transport import fastest_one_way_hours, flight_fare_estimate, ground_options, straight_km
from worldtour_ai.utils.money import display_currency, format_money

TRAVEL_SHARE_LIMIT = 0.3  # at most 30% of the trip spent getting there and back
DAYS_PER_CITY = 1.5
MAX_DAYS = 60


def check_feasibility(request: dict, usd_per_unit: float | None, usd_to_display: float) -> list[dict]:
    """Issues for this request. usd_per_unit converts the user's budget currency to USD (None if unknown)."""
    issues: list[dict] = []
    accepted = set(request.get("accepted_risks") or [])
    currency = display_currency(request)

    def money(amount_usd: float) -> str:
        return format_money(amount_usd, currency, usd_to_display)

    origin = lookup_place(request.get("origin"))
    cities = [c for c in request.get("cities") or [] if c]
    destination = lookup_place(cities[0] if cities else request.get("destination")) or lookup_place(request.get("destination"))
    days = int(request.get("duration_days") or 0)
    travelers = max(int(request.get("travelers") or 1), 1)

    if origin and destination and origin.name == destination.name:
        issues.append(_issue("same_place", True,
                             f"You are starting and ending in {origin.name}. Where would you like to go?",
                             None, "Tell me the destination."))
    start = request.get("start_date")
    if start and date.fromisoformat(start) < date.today():
        issues.append(_issue("past_dates", True, f"The start date {start} is in the past.", None,
                             "When do you want to travel? (for example 12 Dec)"))
    if days > MAX_DAYS:
        issues.append(_issue("too_long", True, f"{days} days is longer than I can plan (up to {MAX_DAYS} days).",
                             {"duration_days": MAX_DAYS}, f"Plan {MAX_DAYS} days instead?"))
    travelers_raw = request.get("travelers")
    if isinstance(travelers_raw, int) and not 1 <= travelers_raw <= 30:
        issues.append(_issue("travelers", True, f"{travelers_raw} travelers is outside what I can plan (1–30).", None,
                             "How many people are traveling?"))

    trip = fastest_one_way_hours(origin, destination) if origin and destination and origin.name != destination.name else None
    if trip and days:
        hours, mode = trip
        share = 2 * hours / (days * 24)
        if share > TRAVEL_SHARE_LIMIT:
            need = max(days + 1, math.ceil(2 * hours / (24 * TRAVEL_SHARE_LIMIT)))
            left = max(days * 24 - 2 * hours, 0)
            issues.append(_issue(
                "too_far_for_days", True,
                f"{origin.name} to {destination.name} takes about {hours:.0f} hours each way by {mode} (door to door). "
                f"In {days} day(s) that leaves only about {left:.0f} hours there.",
                {"duration_days": need},
                f"Make it {need} days? Or name a closer destination, or say 'continue' to keep {days} day(s).",
            ))

    if days and len(cities) > 1 and len(cities) > max(1, math.floor(days / DAYS_PER_CITY)):
        keep = max(1, math.floor(days / DAYS_PER_CITY))
        need = math.ceil(len(cities) * DAYS_PER_CITY)
        issues.append(_issue(
            "too_many_cities", True,
            f"{len(cities)} cities in {days} days means about {days / len(cities):.1f} days per city, mostly spent travelling.",
            {"duration_days": need},
            f"Make it {need} days? Or say 'keep {keep}' to visit only {', '.join(cities[:keep])}.",
            alternative={"cities": cities[:keep]},
        ))

    prefs = set(request.get("transport_preferences") or [])
    km = straight_km(origin, destination) if origin and destination else None
    if km and prefs & {"road", "cab", "bus"} and not prefs & {"flight"} and days:
        road_hours = km * 1.3 / 55
        if road_hours > 14 or 2 * road_hours > days * 24 * 0.4:
            issues.append(_issue(
                "road_too_far", True,
                f"By road, {origin.name} to {destination.name} is about {km * 1.3:.0f} km, roughly {road_hours:.0f} hours each way.",
                {"transport_preferences": [p for p in prefs if p not in {"road", "cab", "bus"}] + ["flight"]},
                "Allow flights instead? Or say 'continue' to keep road travel.",
            ))

    budget = request.get("budget")
    if budget is not None and usd_per_unit and days and destination:
        total = float(budget) * (travelers if request.get("budget_scope") == "per_person" else 1) * usd_per_unit
        minimum = _minimum_cost_usd(origin, destination, days, travelers)
        if minimum:
            # Round the suggestion to a natural figure in the traveler's currency (₹76,000 rather than ₹76,092).
            step = 1000 if usd_to_display >= 20 else 10
            minimum = math.ceil(minimum * usd_to_display / step) * step / usd_to_display
        if minimum and total < minimum * 0.9:
            issues.append(_issue(
                "budget_too_low", True,
                f"Your budget is about {money(total)}, but the cheapest realistic version of this trip costs about "
                f"{money(minimum)} (cheapest travel, basic hotel, simple meals for {travelers} traveler(s), {days} days).",
                {"budget": round(minimum / usd_per_unit, -2), "budget_is_user_stated": True},
                f"Raise the budget to about {money(minimum)}? Or shorten the trip, or say 'continue' to see the cheapest plan anyway.",
            ))
    return [issue for issue in issues if issue["code"] not in accepted]


def _minimum_cost_usd(origin, destination, days: int, travelers: int) -> float | None:
    """Cheapest realistic total: travel there and back, a basic room, simple food. USD."""
    if not destination:
        return None
    nights = max(days - 1, 0)
    rooms = math.ceil(travelers / 2)
    night = BUDGET_NIGHT.get(destination.country or "", DEFAULT_BUDGET_NIGHT)
    food = DAILY_ESTIMATE.get(destination.country or "", DEFAULT_DAILY)["food"] * 0.8
    travel = 0.0
    if origin and origin.name != destination.name:
        options = ground_options(origin, destination, travelers)
        fares = [2 * option["price_total_one_way"] for option in options]
        km = straight_km(origin, destination)
        if km and origin.iata and destination.iata and km > 250:
            fares.append(2 * flight_fare_estimate(km, origin.country == destination.country) * travelers * 0.8)
        travel = min(fares) if fares else 0.0
    return travel + night * nights * rooms + food * days * travelers


def _issue(code: str, blocking: bool, message: str, fix: dict | None, question: str, alternative: dict | None = None) -> dict:
    return {"code": code, "blocking": blocking, "message": message, "fix": fix, "question": question, "alternative": alternative}
