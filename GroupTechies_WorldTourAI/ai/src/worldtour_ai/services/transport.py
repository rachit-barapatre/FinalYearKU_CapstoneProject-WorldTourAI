"""Travel options between cities and within a city.

There is no free live API for train, bus or cab fares, so fares here are per-country
planning estimates from distance. Road distance and drive time come from OSRM when
available. Every option is labeled as an estimate.
"""

from __future__ import annotations

import math
from urllib.parse import quote

from worldtour_ai.algorithms.graphs.geo import haversine_km

EUROPE = {
    "France", "Netherlands", "Italy", "Spain", "Portugal", "Germany", "Austria",
    "Czech Republic", "Hungary", "Greece", "Switzerland", "United Kingdom",
}
# No road link from the mainland, so no train/bus/cab options.
ISLANDS = {"Port Blair", "Malé", "Bali", "Phuket"}

# Per person USD per km (per_km) or per vehicle (vehicle_per_km); speed in km/h, or None to use road time.
_GROUND = {
    "India": [
        {"mode": "bus", "label": "AC sleeper/seater bus", "per_km": 0.022, "speed": None, "factor": 1.25, "min": 4},
        {"mode": "train", "label": "Train (Sleeper class)", "per_km": 0.007, "speed": 55, "min": 2},
        {"mode": "train", "label": "Train (3AC)", "per_km": 0.018, "speed": 55, "min": 5},
        {"mode": "train", "label": "Train (2AC / Chair Car)", "per_km": 0.027, "speed": 60, "min": 8},
        {"mode": "cab", "label": "Private cab (sedan, one way)", "vehicle_per_km": 0.16, "speed": None, "factor": 1.05, "min": 20, "seats": 4},
    ],
    "Europe": [
        {"mode": "bus", "label": "Long-distance bus (FlixBus etc.)", "per_km": 0.06, "speed": None, "factor": 1.2, "min": 10},
        {"mode": "train", "label": "Train (2nd class)", "per_km": 0.14, "speed": 110, "min": 15},
        {"mode": "cab", "label": "Rental car (fuel + tolls)", "vehicle_per_km": 0.25, "speed": None, "factor": 1.0, "min": 60, "seats": 4},
    ],
    "United States": [
        {"mode": "bus", "label": "Greyhound/FlixBus", "per_km": 0.08, "speed": None, "factor": 1.3, "min": 15},
        {"mode": "train", "label": "Amtrak train", "per_km": 0.13, "speed": 80, "min": 25},
        {"mode": "cab", "label": "Rental car (fuel included)", "vehicle_per_km": 0.22, "speed": None, "factor": 1.0, "min": 60, "seats": 4},
    ],
    "default": [
        {"mode": "bus", "label": "Intercity bus", "per_km": 0.05, "speed": None, "factor": 1.25, "min": 5},
        {"mode": "train", "label": "Train", "per_km": 0.10, "speed": 70, "min": 8},
        {"mode": "cab", "label": "Private car with driver", "vehicle_per_km": 0.5, "speed": None, "factor": 1.05, "min": 40, "seats": 4},
    ],
}

# Within a city: vehicle base fare + per km in USD; walking under 1 km.
_LOCAL = {
    "India": {"name": "auto-rickshaw or app cab (Uber/Ola)", "base": 0.6, "per_km": 0.18},
    "United Arab Emirates": {"name": "taxi or Careem/Uber", "base": 3.5, "per_km": 0.6},
    "United States": {"name": "Uber/Lyft", "base": 3.0, "per_km": 1.6},
    "Japan": {"name": "taxi (trains are cheaper)", "base": 5.0, "per_km": 3.0},
    "Thailand": {"name": "Grab or taxi", "base": 1.2, "per_km": 0.4},
    "Singapore": {"name": "Grab or taxi (MRT is cheaper)", "base": 3.0, "per_km": 0.7},
    "Indonesia": {"name": "Grab or Gojek", "base": 0.8, "per_km": 0.3},
    "Malaysia": {"name": "Grab", "base": 1.0, "per_km": 0.4},
    "Nepal": {"name": "taxi", "base": 1.0, "per_km": 0.5},
    "Sri Lanka": {"name": "tuk-tuk or PickMe", "base": 0.8, "per_km": 0.35},
    "Turkey": {"name": "taxi or BiTaksi", "base": 1.5, "per_km": 0.8},
    "Europe": {"name": "taxi/Uber (metro or bus is cheaper)", "base": 4.0, "per_km": 2.0},
    "default": {"name": "taxi or rideshare", "base": 3.0, "per_km": 1.2},
}
CITY_CAB_KMH = 22
WALK_KMH = 4.5
AIRPORT_KM = 20
STATION_KM = 8
FLIGHT_OVERHEAD_MIN = 210  # getting to the airport, check-in, security, exit


def region(country: str | None) -> str:
    if country in EUROPE:
        return "Europe"
    return country if country in _GROUND or country in _LOCAL else "default"


def road_needed(origin, destination) -> bool:
    return bool(origin and destination and origin.name not in ISLANDS and destination.name not in ISLANDS)


def straight_km(origin, destination) -> float | None:
    if not origin or not destination or None in (origin.lat, destination.lat):
        return None
    return haversine_km(origin.lat, origin.lon, destination.lat, destination.lon)


def ground_options(origin, destination, travelers: int, road_km: float | None = None, road_minutes: float | None = None) -> list[dict]:
    """Train, bus and cab options for one direction. Empty when there is no road link."""
    if not road_needed(origin, destination):
        return []
    km = road_km or (straight_km(origin, destination) or 0) * 1.3
    if km < 40:
        return []
    minutes = road_minutes or km / 60 * 60
    travelers = max(int(travelers or 1), 1)
    country = origin.country if origin.country == destination.country else None
    specs = _GROUND.get(region(country) if country else "default", _GROUND["default"])
    if country is None and origin.country in EUROPE and destination.country in EUROPE:
        specs = _GROUND["Europe"]
    options = []
    for index, spec in enumerate(specs):
        duration = km / spec["speed"] * 60 if spec.get("speed") else minutes * spec.get("factor", 1.0)
        if spec["mode"] == "cab" and duration > 14 * 60:
            continue  # too long to drive in one go
        if spec.get("vehicle_per_km"):
            vehicles = math.ceil(travelers / spec.get("seats", 4))
            total = max(spec["min"], km * spec["vehicle_per_km"]) * vehicles
            per_person = total / travelers
        else:
            per_person = max(spec["min"], km * spec["per_km"])
            total = per_person * travelers
        options.append(
            {
                "option_id": f"ground-{spec['mode']}-{index + 1}",
                "kind": spec["mode"],
                "label": spec["label"],
                "origin": origin.name,
                "destination": destination.name,
                "distance_km": round(km),
                "duration_minutes": round(duration),
                "door_to_door_minutes": round(duration + (60 if spec["mode"] != "cab" else 0)),
                "price_pp": round(per_person, 2),
                "price_total_one_way": round(total, 2),
                "overnight": spec["mode"] != "cab" and duration > 9 * 60,
                "price_is_estimate": True,
                "booking_link": booking_link(spec["mode"], origin, destination),
                "data_source": "estimate",
                "note": "Planning estimate from distance; check the booking site for exact fares and timings.",
            }
        )
    return options


def booking_link(mode: str, origin, destination) -> str:
    if origin.country == "India" == destination.country:
        if mode == "train":
            return "https://www.irctc.co.in/nget/train-search"
        if mode == "bus":
            return f"https://www.redbus.in/bus-tickets/{_slug(origin.name)}-to-{_slug(destination.name)}"
    return f"https://www.rome2rio.com/s/{quote(origin.name)}/{quote(destination.name)}"


def flight_fare_estimate(km: float, domestic: bool) -> float:
    """Per person, one way, USD. Used only when a provider gives no fare."""
    return max(55.0, km * (0.055 if domestic else 0.07))


def fastest_one_way_hours(origin, destination) -> tuple[float, str] | None:
    """Door-to-door hours by the quickest sensible mode, from straight-line distance (no network)."""
    km = straight_km(origin, destination)
    if km is None:
        return None
    candidates = []
    if origin.iata and destination.iata and km > 250:
        candidates.append((km / 750 + FLIGHT_OVERHEAD_MIN / 60, "flight"))
    if road_needed(origin, destination):
        candidates.append((km * 1.3 / 55 + 0.5, "road or rail"))
    return min(candidates) if candidates else None


def local_rates(country: str | None) -> dict:
    return _LOCAL.get(country or "", _LOCAL.get(region(country), _LOCAL["default"]))


def local_leg(km: float, country: str | None, travelers: int) -> dict:
    """One hop inside a city: walk under 1 km, otherwise a cab. Cost is per group, in USD."""
    if km <= 1.0:
        return {"mode": "walk", "label": "Walk", "distance_km": round(km, 1),
                "minutes": max(5, math.ceil(km / WALK_KMH * 60)), "cost_usd": 0.0}
    rates = local_rates(country)
    road = km * 1.3
    vehicles = math.ceil(max(int(travelers or 1), 1) / 4)
    speed = CITY_CAB_KMH if road < 10 else 30 if road < 25 else 38  # longer rides use faster roads
    return {
        "mode": "cab",
        "label": rates["name"][0].upper() + rates["name"][1:],
        "distance_km": round(road, 1),
        "minutes": math.ceil(road / speed * 60 + 6),
        "cost_usd": round((rates["base"] + road * rates["per_km"]) * vehicles, 2),
    }


def _slug(text: str) -> str:
    return "-".join(part for part in "".join(ch.lower() if ch.isalnum() else " " for ch in text).split())
