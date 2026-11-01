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
