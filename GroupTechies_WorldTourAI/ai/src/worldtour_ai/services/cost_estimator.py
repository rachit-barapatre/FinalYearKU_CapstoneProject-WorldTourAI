"""Prices the city-to-city legs measured by the Route Agent."""

from __future__ import annotations

from worldtour_ai.data.cost_levels import DEFAULT_PER_KM, INTERCITY_PER_KM
from worldtour_ai.data.places import lookup_place


def estimate_intercity_costs(
    destination: str | None,
    cities: list[str],
    travelers: int,
    city_legs: list[dict] | None = None,
) -> dict:
    travelers = max(int(travelers or 1), 1)
    place = lookup_place((cities or [None])[0]) or lookup_place(destination)
    country = place.country if place else None
    per_km = INTERCITY_PER_KM.get(country or "", DEFAULT_PER_KM)

    legs = []
    total = 0.0
    for leg in city_legs or []:
        km = float(leg.get("distance_km") or 0)
        if km <= 0:
            continue
        mode = "bus or train" if km <= 700 else "domestic flight or long-distance train"
        rate = per_km if km <= 700 else max(per_km, 0.12)
        cost = round(km * rate * travelers, 2)
        total += cost
        legs.append({**leg, "mode": mode, "cost": cost})

    return {
        "country": country,
        "total": round(total, 2),
        "legs": legs,
        "detail": "No travel between cities" if not legs else f"{len(legs)} leg(s) between cities",
    }
