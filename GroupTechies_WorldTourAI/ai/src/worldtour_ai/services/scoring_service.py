"""Weighted scoring. Higher is better after costs and durations are inverted."""

from __future__ import annotations

DEFAULT_WEIGHTS = {
    "cost": 0.25,
    "duration": 0.15,
    "distance": 0.10,
    "rating": 0.15,
    "preference_match": 0.20,
    "weather_suitability": 0.10,
    "convenience": 0.05,
}


def weighted_score(features: dict[str, float], weights: dict[str, float] | None = None) -> float:
    active = weights or DEFAULT_WEIGHTS
    total_weight = 0.0
    total = 0.0
    for name, weight in active.items():
        if name not in features:
            continue
        total += float(features[name]) * float(weight)
        total_weight += float(weight)
    if total_weight == 0:
        return 0.0
    return round(total / total_weight, 4)


def optimization_sentence() -> str:
    return "This itinerary was optimized according to the configured objective weights."
