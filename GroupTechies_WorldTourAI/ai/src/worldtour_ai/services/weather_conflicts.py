"""Rule-based weather conflict checks. This is not dynamic programming."""

from __future__ import annotations

from worldtour_ai.services.itinerary_composer import OUTDOOR

_BAD_CODES = {65, 81, 82, 95, 96, 99}


def is_bad_weather(row: dict) -> bool:
    """Heavy rain or storms: precipitation chance of 70% or more, or a storm/heavy-rain code."""
    probability = row.get("precipitation_probability") or 0
    return (isinstance(probability, (int, float)) and probability >= 70) or row.get("weather_code") in _BAD_CODES


def detect_weather_conflicts(itinerary: list[dict], forecast_days: list[dict]) -> list[dict]:
    by_day = {row.get("day"): row for row in forecast_days if row.get("day")}
    conflicts = []
    for index, day in enumerate(itinerary):
        weather = by_day.get(day.get("day")) or _by_index(forecast_days, day.get("day") or index + 1)
        if not weather or not is_bad_weather(weather):
            continue
        for activity in day.get("activities") or []:
            if (activity.get("category") or "") in OUTDOOR:
                conflicts.append(
                    {
                        "day": day.get("day"),
                        "date": day.get("date"),
                        "activity": activity.get("name"),
                        "reason": "Outdoor activity falls on a wet or stormy day.",
                    }
                )
    return conflicts


def _by_index(forecast_days: list[dict], day_number: int | None) -> dict | None:
    if not day_number or day_number < 1 or day_number > len(forecast_days):
        return None
    return forecast_days[day_number - 1]
