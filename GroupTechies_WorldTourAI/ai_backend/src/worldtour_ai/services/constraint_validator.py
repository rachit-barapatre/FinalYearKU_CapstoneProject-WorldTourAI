"""Checks that a request can become a feasible plan, and records a recovery."""

from __future__ import annotations

from worldtour_ai.algorithms.graphs.geo import haversine_km
from worldtour_ai.data.places import lookup_place


def validate_request(request: dict) -> dict:
    violations = []
    suggestions = []
    updated = dict(request)
    days = updated.get("duration_days") or 0
    cities = list(updated.get("cities") or [])
    if days and cities:
        limit = max(1, int(days // 1.5))  # same rule as the chat's feasibility check (1.5 days per city)
        if len(cities) > limit:
            violations.append(
                {
                    "code": "too_many_cities",
                    "message": f"{len(cities)} cities do not fit in {days} days.",
                }
            )
            suggestions.append(f"Keep about {limit} cities, or add more days.")
            updated["cities"] = cities[:limit]
            updated["cities_are_suggestions"] = updated.get("cities_are_suggestions", False)
            notes = list(updated.get("parser_notes") or [])
            notes.append(
                f"Recovery kept {', '.join(updated['cities'])} and dropped the rest so the schedule can fit."
            )
            updated["parser_notes"] = notes
    budget = updated.get("budget")
    if isinstance(budget, (int, float)) and budget < 50 and _looks_international(updated):
        violations.append({"code": "budget_too_low", "message": "The stated budget is below a realistic international floor."})
        suggestions.append("Increase the budget or narrow the trip to one nearby city.")
    if updated.get("transport_preferences") and "road" in updated["transport_preferences"]:
        distance = _origin_destination_km(updated)
        if distance and distance > 1500:
            violations.append({"code": "road_trip_too_far", "message": "A driving route is not realistic at this distance."})
            suggestions.append("Allow flights for the long-distance portion.")
    travelers = updated.get("travelers")
    if isinstance(travelers, int) and travelers < 1:
        violations.append({"code": "travelers", "message": "Traveler count must be at least 1."})
    feasible = not any(item["code"] == "too_many_cities" for item in violations) or bool(updated.get("cities"))
    return {
        "feasible": len(violations) == 0,
        "recovered": bool(violations) and bool(updated.get("cities") or updated.get("destination")),
        "violations": violations,
        "suggestions": suggestions,
        "request": updated,
    }


def validate_schedule(days: list[dict]) -> dict:
    violations = []
    for day in days:
        activities = day.get("activities") or []
        last_end = -1
        for activity in activities:
            start = activity.get("start_minute", 0)
            end = activity.get("end_minute", 0)
            if end > 22 * 60 and activity.get("category") not in {"travel", "transfer", "meal", "stay"}:
                violations.append({"code": "opening_hours", "message": f"Day {day.get('day')}: {activity.get('name')} ends after 22:00."})
            if start < last_end:
                violations.append({"code": "overlap", "message": f"Overlap on day {day.get('day')}: {activity.get('name')}."})
            last_end = max(last_end, end)
    return {"feasible": not violations, "violations": violations, "suggestions": ["Drop the overlapping activity."] if violations else []}


_NOT_PLACES = {"travel", "transfer", "meal", "stay"}
MAX_SPEED_KMH = 90  # even a perfect road trip cannot beat this between two places in a city
MAX_CITY_KM = 35


def validate_itinerary(days: list[dict], request: dict | None = None) -> dict:
    """Structural facts the finished timetable must satisfy, checked against the data, not the AI text.

    Day count and dates match the request, no place is visited twice, every sight is in the day's city, and the gap
    between two consecutive sights is long enough to actually get from one to the other.
    """
    request = request or {}
    violations: list[dict] = []
    wanted = request.get("duration_days")
    if isinstance(wanted, int) and wanted and len(days) != wanted:
        violations.append({"code": "day_count", "message": f"The trip is {wanted} day(s) but the timetable has {len(days)}."})
    if [d.get("day") for d in days] != list(range(1, len(days) + 1)):
        violations.append({"code": "day_numbers", "message": "Day numbers are not 1, 2, 3 in order."})
    start = request.get("start_date")
    if start:
        from datetime import date, timedelta

        try:
            first = date.fromisoformat(start)
        except ValueError:
            first = None
        for day in days:
            expected = (first + timedelta(days=int(day.get("day") or 1) - 1)).isoformat() if first else None
            if expected and day.get("date") and day["date"] != expected:
                violations.append({"code": "date", "message": f"Day {day.get('day')} is dated {day['date']}, expected {expected}."})
    seen_ids: set = set()
    seen_names: set = set()
    for day in days:
        number = day.get("day")
        center = lookup_place(day.get("city"))
        previous = None
        for activity in day.get("activities") or []:
            if activity.get("category") in _NOT_PLACES:
                continue
            ident, name = activity.get("activity_id"), str(activity.get("name") or "").lower().removeprefix("dinner at ").strip()
            if (ident and ident in seen_ids) or (name and name in seen_names):
                violations.append({"code": "duplicate_place", "message": f"{activity.get('name')} appears more than once in the itinerary."})
            seen_ids.add(ident)
            seen_names.add(name)
            lat, lon = activity.get("lat"), activity.get("lon")
            if lat is not None and center and center.lat is not None and haversine_km(center.lat, center.lon, lat, lon) > MAX_CITY_KM:
                violations.append({"code": "out_of_area", "message": f"Day {number}: {activity.get('name')} is more than {MAX_CITY_KM} km from {day.get('city')}."})
            if previous and lat is not None and previous.get("lat") is not None:
                km = haversine_km(previous["lat"], previous["lon"], lat, lon)
                gap = (activity.get("start_minute") or 0) - (previous.get("end_minute") or 0)
                if km > 0.2 and gap < km / MAX_SPEED_KMH * 60:
                    violations.append({"code": "impossible_travel", "message": (
                        f"Day {number}: {km:.0f} km from {previous.get('name')} to {activity.get('name')} "
                        f"cannot be covered in {max(gap, 0)} minutes.")})
            if lat is not None:
                previous = activity
    return {"feasible": not violations, "violations": violations}


def _looks_international(request: dict) -> bool:
    origin = lookup_place(request.get("origin"))
    dest = lookup_place(request.get("destination"))
    if not origin or not dest or not origin.country or not dest.country:
        return False
    return origin.country != dest.country


def _origin_destination_km(request: dict) -> float | None:
    origin = lookup_place(request.get("origin"))
    dest = lookup_place(request.get("destination"))
    if not origin or not dest or origin.lat is None or dest.lat is None:
        return None
    return haversine_km(origin.lat, origin.lon, dest.lat, dest.lon)
