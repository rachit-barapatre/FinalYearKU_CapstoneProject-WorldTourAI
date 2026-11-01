"""Deterministic day planning and timetables on recommendation places, plus grounded LLM day descriptions."""

from __future__ import annotations

import json
import math
import re

from worldtour_ai.algorithms.graphs.geo import haversine_km
from worldtour_ai.services.transport import AIRPORT_KM, STATION_KM, local_leg

DETAIL_PROMPT = """Write traveler-facing text for each trip day from the timetable. Reply with ONLY this JSON:
{"days":[{"day":1,"title":"Day 1 – Arrival","morning":"...","midday":"...","evening":"..."}]}
Rules:
- One object per day given. Morning, midday, evening: 1-2 sentences each, addressed to "you".
- Keep every sight, transfer, meal, hotel and clock time exactly as listed; add or move nothing.
- Name no venue that is not listed (say "a café near <sight>"). Use only listed prices and the listed weather.
- Arrival day: nothing before arriving. Departure day: nothing after leaving for the airport or station.
- Title: short theme like "Day 2 – Old town"."""

_NOTE_CHARS = 70
_BANNED_NAMES = {
    "open time around your stay",
    "local meal",
    "neighborhood walk",
}
OUTDOOR = {"nature", "beach", "adventure", "park"}
NOT_SIGHTS = {"travel", "transfer", "meal", "stay"}
# Minutes spent at a place, by category.
_VISIT_MINUTES = {
    "history": 120, "culture": 105, "sightseeing": 75, "nature": 120, "beach": 150,
    "shopping": 120, "entertainment": 150, "adventure": 150, "food": 75,
}
_PACE = {
    "relaxed": {"start": 9 * 60 + 30, "cap": 2, "factor": 1.15},
    "balanced": {"start": 9 * 60, "cap": 3, "factor": 1.0},
    "packed": {"start": 8 * 60 + 30, "cap": 4, "factor": 0.85},
}
_DAY_END = 21 * 60 + 30
_DINNER = 19 * 60 + 30
_MIDDAY = (11 * 60, 16 * 60)
_AIRPORT_LEAD = 180
_STATION_LEAD = 60
MAX_HOP_MINUTES = 75  # farther places need a separate day trip, not a hop between sights
MAX_CITY_KM = 35


def city_per_day(cities: list, day_count: int) -> list:
    """Split the trip days across the cities in order, as evenly as possible."""
    count = max(1, min(len(cities), day_count))
    base, extra = divmod(day_count, count)
    days = []
    for index in range(count):
        days.extend([cities[index]] * (base + (1 if index < extra else 0)))
    return days


def catalog_from_places(places: list[dict], excluded: list[str] | None = None) -> list[dict]:
    """Real recommendation rows only. Rows without an id, placeholders, and excluded names are ignored."""
    banned = [name.strip().lower() for name in excluded or [] if name.strip()]
    catalog = []
    seen = set()
    for place in places or []:
        activity_id = place.get("place_id")
        name = place.get("name")
        if not activity_id or not name or activity_id in seen:
            continue
        if place.get("lat") is None or place.get("lon") is None:
            continue  # without coordinates a place cannot be checked against the city or routed to, so it is not scheduled
        lowered = str(name).strip().lower()
        if lowered in _BANNED_NAMES or any(word in lowered for word in banned):
            continue
        if any(_same_spot(place, lowered, kept) for kept in catalog):
            continue
        seen.add(activity_id)
        catalog.append(
            {
                "activity_id": activity_id,
                "name": name,
                "city": place.get("city"),
                "category": place.get("category") or "sightseeing",
                "score": place.get("score") or 0,
                "lat": place.get("lat"),
                "lon": place.get("lon"),
                "detail": place.get("address") or place.get("location") or "",
                "source": place.get("source") or place.get("provider") or place.get("data_source"),
            }
        )
    return catalog


def _same_spot(place: dict, lowered: str, kept: dict) -> bool:
    """"La Mer" and "La Mer Beach", or two records 150 m apart, are the same visit."""
    other = str(kept["name"]).strip().lower()
    if lowered in other or other in lowered:
        return True
    if None in (place.get("lat"), place.get("lon"), kept.get("lat"), kept.get("lon")):
        return False
    return haversine_km(place["lat"], place["lon"], kept["lat"], kept["lon"]) < 0.15


# --------------------------------------------------------------------------- getting there and back


def endpoint_blocks(
    transport: dict | None,
    flight_result: dict | None,
    day_count: int,
    origin: str | None,
    destination: str | None,
    country: str | None,
    travelers: int,
) -> tuple[dict[int, list[dict]], dict[int, list[dict]]]:
    """Arrival blocks for day 1 and departure blocks for the last day, by the chosen mode.

    Returns (start_blocks, end_blocks) keyed by day number. Start blocks end with arrival at the
    hotel; end blocks start when the traveler leaves the hotel.
    """
    start: dict[int, list[dict]] = {}
    end: dict[int, list[dict]] = {}
    kind = (transport or {}).get("kind")
    if kind is None and flight_result and flight_result.get("options"):
        kind = "flight"
    if kind is None:
        return start, end
    if kind == "flight":
        flights = flight_result or {}
        outbound = _by_id(flights.get("options"), (transport or {}).get("outbound_id"))
        inbound = _by_id(flights.get("return_options"), (transport or {}).get("return_id"))
        if outbound:
            arrive = _clock_from_iso(outbound.get("arrival_time")) or 11 * 60
            depart = _clock_from_iso(outbound.get("departure_time"))
            flight_start = depart if depart is not None and depart < arrive else max(arrive - int(outbound.get("duration_minutes") or 120), 0)
            start[1] = [
                _entry("flight:outbound", flight_start, arrive, "travel",
                       f"Flight {outbound.get('origin')} → {outbound.get('destination')}",
                       f"{outbound.get('airline') or ''} {outbound.get('flight_number') or ''}".strip(), mode="flight"),
            ]
            start[1] += _transfer_to_hotel(arrive + 30, AIRPORT_KM, "airport", country, travelers)
        if inbound and day_count >= 1:
            leave_flight = _clock_from_iso(inbound.get("departure_time")) or 18 * 60
            leave = max(leave_flight - _AIRPORT_LEAD, 0)
            leg = local_leg(AIRPORT_KM, country, travelers)
            end[day_count] = [
                _entry("transfer:airport", leave, leave + leg["minutes"], "transfer",
                       "Check out and take a cab to the airport",
                       f"{leg['label']} · ~{leg['distance_km']} km · {leg['minutes']} min · {{money:{leg['cost_usd']:.2f}}}. "
                       "Be at the airport 2–3 hours before departure.",
                       cost=leg["cost_usd"], mode=leg["mode"]),
                _entry("flight:return", leave_flight, min(leave_flight + int(inbound.get("duration_minutes") or 120), 24 * 60), "travel",
                       f"Flight {inbound.get('origin')} → {inbound.get('destination')}",
                       f"{inbound.get('airline') or ''} {inbound.get('flight_number') or ''}".strip(), mode="flight"),
            ]
        return start, end
    # Train, bus or cab.
    duration = int((transport or {}).get("duration_minutes") or 360)
    label = (transport or {}).get("label") or kind
    overnight = duration > 9 * 60 and kind != "cab"
    depart = 21 * 60 if overnight else (8 * 60 if kind == "cab" else 7 * 60)
    arrive = (depart + duration) % (24 * 60)
    title_out = f"{label}: {origin} → {destination}"
    if overnight:
        start[1] = [_entry("ground:outbound", 0, arrive, "travel", title_out,
                           f"Overnight; departs {origin} at {_hhmm(depart)} the evening before day 1.", mode=kind)]
    else:
        start[1] = [_entry("ground:outbound", depart, arrive, "travel", title_out,
                           f"About {duration // 60} h {duration % 60:02d} min.", mode=kind)]
    if kind != "cab":
        start[1] += _transfer_to_hotel(arrive + 15, STATION_KM, "station", country, travelers)
    else:
        start[1].append(_entry("stay:checkin", arrive, arrive + 30, "stay", "Check in at the hotel", "The cab drops you at the hotel."))
    back = 21 * 60 if overnight else max(6 * 60, min(16 * 60, 23 * 60 - duration))
    leave = back - (_STATION_LEAD if kind != "cab" else 0)
    blocks = []
    if kind != "cab":
        leg = local_leg(STATION_KM, country, travelers)
        blocks.append(_entry("transfer:station", leave, leave + leg["minutes"], "transfer",
                             "Check out and take a cab to the station/bus stand",
                             f"{leg['label']} · ~{leg['distance_km']} km · {leg['minutes']} min · {{money:{leg['cost_usd']:.2f}}}",
                             cost=leg["cost_usd"], mode="cab"))
    arrival_note = " the next day." if back + duration >= 24 * 60 else "."
    blocks.append(_entry("ground:return", back, min(back + duration, 24 * 60), "travel", f"{label}: {destination} → {origin}",
                         f"Arrives about {_hhmm((back + duration) % (24 * 60))}{arrival_note}", mode=kind))
    end[day_count] = blocks
    return start, end


def city_change_blocks(leg: dict, start_minute: int, country: str | None, travelers: int) -> list[dict]:
    """Moving to the next city: check out, travel, cab to the new hotel, check in."""
    km = float(leg.get("distance_km") or 0)
    mode = leg.get("mode") or "bus or train"
    if "flight" in mode and km > 700:
        minutes = int(km / 750 * 60 + 180)
    else:
        minutes = int(leg.get("duration_minutes") or km / 55 * 60) + 30
    blocks = [
        _entry(f"move:{leg.get('to')}", start_minute, start_minute + minutes, "travel",
               f"Travel {leg.get('from')} → {leg.get('to')} by {mode}",
               f"~{km:.0f} km, about {minutes // 60} h {minutes % 60:02d} min including getting to the station.",
               cost=leg.get("cost"), mode=mode),
    ]
    blocks += _transfer_to_hotel(start_minute + minutes, STATION_KM, "station", country, travelers)
    return blocks


def _transfer_to_hotel(at: int, km: float, place: str, country: str | None, travelers: int) -> list[dict]:
    leg = local_leg(km, country, travelers)
    end = at + leg["minutes"]
    checkin = "Check in at the hotel" if end >= 14 * 60 else "Drop bags at the hotel (check-in is usually from 14:00)"
    return [
        _entry(f"transfer:{place}-hotel", at, end, "transfer", f"Cab from the {place} to the hotel",
               f"{leg['label']} · ~{leg['distance_km']} km · {leg['minutes']} min · {{money:{leg['cost_usd']:.2f}}}",
               cost=leg["cost_usd"], mode=leg["mode"]),
        _entry("stay:checkin", end, end + 30, "stay", checkin, ""),
    ]


def day_windows(start_blocks: dict, end_blocks: dict, day_count: int, pace: str | None) -> list[tuple[int, int]]:
    """Free time per day between arrival/check-in and leaving for the airport or station."""
    first = _PACE.get(pace or "balanced", _PACE["balanced"])["start"]
    windows = []
    for day in range(1, day_count + 1):
        start, end = first, _DAY_END
        if start_blocks.get(day):
            start = max(start, max(block["end"] for block in start_blocks[day]) + 15)
        if end_blocks.get(day):
            end = min(end, min(block["start"] for block in end_blocks[day]) - 15)
        windows.append((start, end))
    return windows


# --------------------------------------------------------------------------- choosing places


def plan_days(
    catalog: list[dict],
    day_cities: list[str],
    windows: list[tuple[int, int]],
    pace: str | None = None,
    bad_weather_days: set[int] | None = None,
    hot_days: set[int] | None = None,
    indoor_only: bool = False,
    anchors: dict[str, tuple[float, float]] | None = None,
) -> list[dict]:
    """Choose the sights and an optional dinner place for each day.

    Highest-scoring places fill each day's capacity (by pace and free hours). Within a city
    they follow a nearest-neighbour walk from the hotel, so a day's stops are close together.
    Outdoor places skip bad-weather days (or every day when indoor_only); on hot days outdoor
    places go first so they land in the cooler morning.
    """
    spec = _PACE.get(pace or "balanced", _PACE["balanced"])
    bad = bad_weather_days or set()
    hot = hot_days or set()
    capacity = [max(0, min(spec["cap"], (end - start - 90) // 150)) for start, end in windows]
    days = [{"sights": [], "dinner": None} for _ in day_cities]
    single_city = len(dict.fromkeys(day_cities)) == 1
    for city in dict.fromkeys(day_cities):
        indexes = [i for i, name in enumerate(day_cities) if name == city]
        key = (city or "").strip().lower()
        pool = list(catalog) if single_city else [
            item for item in catalog if not item.get("city") or (item["city"] or "").strip().lower() == key
        ]
        if indoor_only:
            pool = [item for item in pool if item["category"] not in OUTDOOR]
        center = (anchors or {}).get(city) or _city_center(city)
        if center:
            # Places far outside the city need their own day trip; keep city days walkable or a short cab ride.
            pool = [item for item in pool if item.get("lat") is None
                    or haversine_km(center[0], center[1], item["lat"], item["lon"]) <= MAX_CITY_KM]
        pool.sort(key=lambda item: item.get("score") or 0, reverse=True)
        sights = [item for item in pool if item["category"] != "food"]
        meals = [item for item in pool if item["category"] == "food"]
        room = sum(capacity[i] for i in indexes)
        walk = _sweep_order(sights[:room], (anchors or {}).get(city) or center)
        # Short days (arrival, departure) get the places nearest the hotel; the far side of town goes to full days.
        fill_order = sorted(indexes, key=lambda i: windows[i][1] - windows[i][0])
        for item in walk + sights[room:]:
            for i in fill_order:
                if len(days[i]["sights"]) >= capacity[i]:
                    continue
                if item["category"] in OUTDOOR and (i + 1) in bad:
                    continue
                days[i]["sights"].append(dict(item))
                break
        for i in indexes:
            # Each day's stops form one tour from the hotel; the sweep above already put neighbours on the same day.
            days[i]["sights"] = _nearest_neighbour(days[i]["sights"], (anchors or {}).get(city) or center)
            if (i + 1) in hot:
                days[i]["sights"].sort(key=lambda item: item["category"] not in OUTDOOR)
            if meals and windows[i][1] >= _DINNER + 60:
                days[i]["dinner"] = dict(meals.pop(0))
    return days


def build_timetable(
    plan: dict,
    window: tuple[int, int],
    hotel: dict | None,
    country: str | None,
    travelers: int,
    pace: str | None,
    food_rate: float,
    full_day: bool,
    roads: RoadTimes | None = None,
) -> list[dict]:
    """Exact times for one day: breakfast, each transfer (walk or cab), each visit, lunch, dinner, return."""
    spec = _PACE.get(pace or "balanced", _PACE["balanced"])
    start, end = window
    if end - start < 60:
        return []
    base = (hotel.get("lat"), hotel.get("lon")) if hotel and hotel.get("lat") is not None else None
    hotel_name = (hotel or {}).get("name") or "the hotel"
    entries: list[dict] = []
    if full_day and start >= 8 * 60:
        entries.append(_entry("meal:breakfast", start - 60, start - 15, "meal", f"Breakfast at {hotel_name}", "Check whether breakfast is included in your room rate."))
    t, here, lunch_done = start, base, start >= 14 * 60
    # Sights finish in time for a 19:30 dinner when the day runs into the evening.
    sights_until = _DINNER - 15 if end >= _DINNER + 60 else end - 45
    for item in plan.get("sights") or []:
        leg = _leg(here, item, country, travelers, roads)
        visit = int(_VISIT_MINUTES.get(item["category"], 90) * spec["factor"])
        # Lunch before a visit that would run well past 13:30.
        if not lunch_done and t >= 11 * 60 + 30 and (t >= 12 * 60 or t + leg["minutes"] + visit > 13 * 60 + 30):
            lunch_at = max(t, 12 * 60)
            entries.append(_entry(f"meal:lunch:{t}", lunch_at, lunch_at + 60, "meal", "Lunch nearby",
                                  f"{{money:{food_rate * 0.35:.2f}}} per person (part of the food budget)."))
            t, lunch_done = lunch_at + 60, True
        if leg["minutes"] > MAX_HOP_MINUTES or t + leg["minutes"] + visit > sights_until:
            continue
        if leg["minutes"]:
            entries.append(_hop(t, leg, item["name"]))
        arrive = t + leg["minutes"]
        entries.append(_entry(item["activity_id"], arrive, arrive + visit, item["category"], item["name"], item.get("detail") or "",
                              lat=item.get("lat"), lon=item.get("lon")))
        entries[-1]["source"] = "provider"
        t, here = arrive + visit, (item.get("lat"), item.get("lon")) if item.get("lat") is not None else here
    if not lunch_done and start <= 13 * 60 and end >= 14 * 60 and t <= 14 * 60:
        lunch_at = max(t, 12 * 60 + 30)
        entries.append(_entry("meal:lunch", lunch_at, lunch_at + 60, "meal", "Lunch nearby",
                              f"{{money:{food_rate * 0.35:.2f}}} per person (part of the food budget)."))
        t = lunch_at + 60
    dinner = plan.get("dinner")
    if end >= _DINNER + 60:
        if dinner:
            leg = _leg(here, dinner, country, travelers, roads)
            at = max(t, _DINNER - leg["minutes"])
            if leg["minutes"]:
                entries.append(_hop(at, leg, dinner["name"]))
            entries.append(_entry(dinner["activity_id"], at + leg["minutes"], at + leg["minutes"] + 90, "food",
                                  f"Dinner at {dinner['name']}", dinner.get("detail") or "",
                                  lat=dinner.get("lat"), lon=dinner.get("lon")))
            entries[-1]["source"] = "provider"
            t = at + leg["minutes"] + 90
            here = (dinner.get("lat"), dinner.get("lon")) if dinner.get("lat") is not None else here
            back = _leg(here, {"lat": base[0], "lon": base[1]} if base else {}, country, travelers, roads)
            if back["minutes"]:
                entries.append(_hop(t, back, hotel_name))
        else:
            back = _leg(here, {"lat": base[0], "lon": base[1]} if base else {}, country, travelers, roads)
            if back["minutes"] and here != base:
                entries.append(_hop(t, back, hotel_name))
                t += back["minutes"]
            entries.append(_entry("meal:dinner", max(t, _DINNER), max(t, _DINNER) + 75, "meal", f"Dinner near {hotel_name}",
                                  f"{{money:{food_rate * 0.45:.2f}}} per person (part of the food budget)."))
    elif here != base and entries:
        back = _leg(here, {"lat": base[0], "lon": base[1]} if base else {}, country, travelers, roads)
        if back["minutes"]:
            entries.append(_hop(min(t, end - back["minutes"]), back, f"{hotel_name} to collect your bags"))
    return entries


def _city_center(city: str | None) -> tuple[float, float] | None:
    from worldtour_ai.data.places import lookup_place

    place = lookup_place(city)
    return (place.lat, place.lon) if place and place.lat is not None else None


class RoadTimes:
    """Road distance and drive time between located points, measured by the routing service (OSRM)."""

    def __init__(self, points: list[tuple[float, float]], distances_m: list, durations_s: list) -> None:
        self._index = {self._key(lat, lon): i for i, (lat, lon) in enumerate(points)}
        self._km, self._sec = distances_m, durations_s

    @staticmethod
    def _key(lat, lon) -> tuple[float, float]:
        return (round(float(lat), 5), round(float(lon), 5))

    def between(self, a, b) -> tuple[float, float] | None:
        """(km, minutes) by road from a to b, or None when either point was not measured."""
        try:
            i, j = self._index[self._key(*a)], self._index[self._key(*b)]
            km, sec = self._km[i][j], self._sec[i][j]
        except (KeyError, IndexError, TypeError, ValueError):
            return None
        if km is None or sec is None or km < 0 or sec < 0:
            return None
        return km / 1000, sec / 60


def _leg(here, item: dict, country: str | None, travelers: int, roads: RoadTimes | None = None) -> dict:
    if here is None or item.get("lat") is None or here[0] is None:
        if here is None and item.get("lat") is None:
            return {"minutes": 0, "cost_usd": 0.0, "mode": "none", "label": "", "distance_km": 0}
        return {**local_leg(5.0, country, travelers), "estimated": True}
    if (here[0], here[1]) == (item["lat"], item["lon"]):
        return {"minutes": 0, "cost_usd": 0.0, "mode": "none", "label": "", "distance_km": 0}
    road = roads.between(here, (item["lat"], item["lon"])) if roads else None
    return local_leg(haversine_km(here[0], here[1], item["lat"], item["lon"]), country, travelers, road)


def _hop(at: int, leg: dict, target: str) -> dict:
    verb = "Walk" if leg["mode"] == "walk" else leg["label"]
    detail = f"~{leg['distance_km']} km · {leg['minutes']} min"
    if leg["cost_usd"]:
        detail += f" · {{money:{leg['cost_usd']:.2f}}} (estimated fare)"
    detail += " · road distance from routing data" if leg.get("source") == "road_routing" else " · estimated from straight-line distance"
    entry = _entry(f"transfer:{at}:{target}", at, at + leg["minutes"], "transfer", f"{verb} to {target}", detail,
                   cost=leg["cost_usd"], mode=leg["mode"])
    entry["source"] = "road_routing" if leg.get("source") == "road_routing" else "estimate"
    return entry


def _entry(entry_id, start, end, category, title, detail, cost=None, mode=None, lat=None, lon=None) -> dict:
    return {"activity_id": str(entry_id), "start": int(start), "end": int(max(end, start + 5)), "category": category,
            "name": title, "detail": detail, "cost_usd": cost, "mode": mode, "lat": lat, "lon": lon,
            "slot": _slot_label(int(start))}


def _by_id(options, option_id):
    options = options or []
    return next((option for option in options if option.get("option_id") == option_id), options[0] if options else None)


def _sweep_order(items: list[dict], anchor: tuple[float, float] | None) -> list[dict]:
    """Order places along the direction in which they are most spread out, nearest end first.

    Handing consecutive chunks of this order to consecutive days puts neighbouring places on the same day, so a day
    is one area of the city instead of a zig-zag (a plain nearest-neighbour walk over the whole trip leaves two
    neighbouring sights on different days whenever a day's capacity ends between them).
    """
    located = [item for item in items if item.get("lat") is not None]
    unlocated = [item for item in items if item.get("lat") is None]
    if len(located) < 3:
        return _nearest_neighbour(items, anchor)
    mean_lat = sum(i["lat"] for i in located) / len(located)
    scale = math.cos(math.radians(mean_lat))
    xs = [(i["lon"] * scale, i["lat"]) for i in located]
    cx, cy = sum(x for x, _ in xs) / len(xs), sum(y for _, y in xs) / len(xs)
    sxx = sum((x - cx) ** 2 for x, _ in xs)
    syy = sum((y - cy) ** 2 for _, y in xs)
    sxy = sum((x - cx) * (y - cy) for x, y in xs)
    angle = 0.5 * math.atan2(2 * sxy, sxx - syy)
    ux, uy = math.cos(angle), math.sin(angle)
    keyed = [((x - cx) * ux + (y - cy) * uy, k, item) for k, ((x, y), item) in enumerate(zip(xs, located))]
    ordered = [item for _, _, item in sorted(keyed)]
    if anchor and anchor[0] is not None:
        first = haversine_km(anchor[0], anchor[1], ordered[0]["lat"], ordered[0]["lon"])
        last = haversine_km(anchor[0], anchor[1], ordered[-1]["lat"], ordered[-1]["lon"])
        if last < first:
            ordered.reverse()
    return ordered + unlocated


def _nearest_neighbour(items: list[dict], anchor: tuple[float, float] | None) -> list[dict]:
    """Greedy nearest-neighbour ordering so consecutive stops are close together."""
    remaining = [item for item in items if item.get("lat") is not None]
    unlocated = [item for item in items if item.get("lat") is None]
    if not remaining:
        return items
    current = anchor or (remaining[0]["lat"], remaining[0]["lon"])
    ordered = []
    while remaining:
        nearest = min(remaining, key=lambda item: haversine_km(current[0], current[1], item["lat"], item["lon"]))
        remaining.remove(nearest)
        ordered.append(nearest)
        current = (nearest["lat"], nearest["lon"])
    return ordered + unlocated


def _clock_from_iso(value: str | None) -> int | None:
    if not value or "T" not in str(value):
        return None
    return _clock(str(value).split("T", 1)[1][:5])


def _parse_json(raw: str | None) -> dict:
    cleaned = re.sub(r"^```(?:json)?|```$", "", (raw or "").strip()).strip()
    start, end = cleaned.find("{"), cleaned.rfind("}")
    if start < 0 or end <= start:
        return {}
    try:
        payload = json.loads(cleaned[start : end + 1])
    except json.JSONDecodeError:
        return {}
    return payload if isinstance(payload, dict) else {}


def _clock(value) -> int | None:
    if isinstance(value, int) and 0 <= value <= 24 * 60:
        return value
    if isinstance(value, str) and ":" in value:
        hour, minute, *_ = value.split(":")
        try:
            total = int(hour) * 60 + int(minute)
        except ValueError:
            return None
        if 0 <= total <= 24 * 60:
            return total
    return None


# --------------------------------------------------------------------------- text


def fill_money(text: str, money) -> str:
    """Replace {money:12.50} placeholders (USD) with the traveler's currency."""
    return re.sub(r"\{money:([0-9.]+)\}", lambda match: money(float(match.group(1))), text or "")


def present_days(days: list[dict], money) -> None:
    """Morning, midday and evening summary lines from the timetable, plus the stay name."""
    for day in days:
        buckets = {"morning": [], "midday": [], "evening": []}
        for activity in day.get("activities") or []:
            if activity.get("category") == "transfer":
                continue
            slot = activity.get("slot") if activity.get("slot") in buckets else "evening"
            buckets[slot].append(activity)
        stay = (day.get("stay") or {}).get("name") or "your hotel"
        city = day.get("city") or "the city"
        ids = {a.get("activity_id") for a in day.get("activities") or []}
        leaving = "flight:return" in ids or "ground:return" in ids
        day["title"] = f"Day {day.get('day')} – {_theme(day)}"
        day["text_source"] = "built_in"
        for part in ("morning", "midday", "evening"):
            text = _sentence(buckets[part], money)
            day[part] = text or (f"Free time in {city}." if not leaving else "On your way home.")
        day["stay_name"] = "—" if leaving else stay


def detail_prompt(days: list[dict], request: dict, weather_by_day: dict[int, str], money) -> str:
    """Compact timetable for the AI: only what it needs to describe the given days (no addresses, no long notes)."""
    travelers = request.get("travelers") or 1
    kids = "traveling with children" in (request.get("special_requirements") or [])
    lines = [
        f"{request.get('destination') or 'Trip'}; {travelers} traveler(s)" + (" with children" if kids else "")
        + f"; {request.get('trip_type') or 'general'}, {request.get('pace') or 'balanced'} pace"
    ]
    for day in days:
        header = f"Day {day.get('day')} {day.get('city') or ''}; stay {day.get('stay_name') or '-'}"
        if weather_by_day.get(day.get("day")):
            header += f"; weather {weather_by_day[day.get('day')]}"
        lines.append(header)
        for activity in day.get("activities") or []:
            note = fill_money(activity.get("detail") or "", money)
            note = f" - {note[:_NOTE_CHARS].rstrip()}" if note and activity.get("category") in ("transfer", "travel") else ""
            lines.append(
                f"{_hhmm(activity.get('start_minute'))}-{_hhmm(activity.get('end_minute'))} "
                f"{activity.get('name')} [{activity.get('category')}]{note}"
            )
    return "\n".join(lines)


def apply_llm_details(raw: str | None, days: list[dict]) -> int:
    """Replace day lines with model text when it passes checks. Returns how many days were updated.

    A day's model text is rejected if it drops a scheduled sight or, on the departure day,
    mentions a clock time after the traveler leaves for the airport or station.
    """
    updated = 0
    by_day = {}
    for item in _parse_json(raw).get("days") or []:
        if isinstance(item, dict) and isinstance(item.get("day"), int):
            by_day[item["day"]] = item
    for day in days:
        item = by_day.get(day.get("day"))
        if not item:
            continue
        parts = {key: item.get(key) for key in ("title", "morning", "midday", "evening")}
        if not all(isinstance(text, str) and text.strip() for text in parts.values()):
            continue
        text = " ".join(parts.values()).lower()
        if unsupported_claim(" ".join(parts.values()), day):
            continue
        sights = [a for a in day.get("activities") or [] if a.get("category") not in NOT_SIGHTS]
        if any(str(a.get("name") or "").lower().replace("dinner at ", "")[:18] not in text for a in sights):
            continue
        leave = next((a for a in day.get("activities") or []
                      if a.get("activity_id") in {"transfer:airport", "transfer:station", "ground:return"}), None)
        if leave and any(minute > leave["start_minute"] + 240 for minute in _clock_mentions(text)):
            continue
        for key, value in parts.items():
            day[key] = value.strip()
        day["text_source"] = "ai_generated"
        if isinstance(item.get("stay"), str) and item["stay"].strip():
            day["stay_name"] = item["stay"].strip()
        updated += 1
    return updated


# Facts a model can only recall from memory. The timetable has none of them, so text that states them is not used.
_CLAIM_WORDS = re.compile(
    r"\b(opens?|opening|opened|closes?|closing|closed on|open (?:daily|until|from|every|all)|admission|entry fee|entrance fee|"
    r"tickets? (?:costs?|price|is|are|cost)|free (?:entry|admission)|unesco|world heritage|built in|constructed|"
    r"rated|star(?:red)? (?:hotel|rating)|\d(?:\.\d)? stars?|award|michelin)\b",
    re.I,
)
_YEAR = re.compile(r"\b(?:1[0-9]{3}|20[0-9]{2})\b")
_AMOUNT = re.compile(r"(?:₹|rs\.?|inr|usd|us\$|\$|€|eur|£|gbp|aed)\s?([0-9][0-9,]*(?:\.[0-9]+)?)|([0-9][0-9,]*(?:\.[0-9]+)?)\s?(?:rupees|dollars|euros|inr|usd|eur)", re.I)
CLOCK_TOLERANCE_MIN = 10


def _amounts(text: str) -> set[float]:
    found = set()
    for match in _AMOUNT.finditer(text or ""):
        raw = (match.group(1) or match.group(2)).replace(",", "")
        try:
            found.add(round(float(raw)))
        except ValueError:
            pass
    return found


def unsupported_claim(text: str, day: dict) -> str | None:
    """Why this AI text cannot be trusted for the day, or None. It may only restate the timetable.

    Rejected: opening hours, ticket prices, ratings, awards, heritage status and years (not in any provider data we
    hold); money amounts that the built-in text for the day does not contain; clock times that match nothing in the day.
    """
    if _CLAIM_WORDS.search(text):
        return "states a fact that is not in the timetable data"
    if _YEAR.search(text) and not _YEAR.search(str(day.get("date") or "")):
        return "mentions a year"
    builtin = " ".join(str(day.get(k) or "") for k in ("morning", "midday", "evening"))
    if _amounts(text) - _amounts(builtin):
        return "mentions a price that is not in the timetable"
    times = [a.get("start_minute") for a in day.get("activities") or []] + [a.get("end_minute") for a in day.get("activities") or []]
    times = [t for t in times if isinstance(t, int)]
    for minute in _clock_mentions(text):
        if times and min(abs(minute - t) for t in times) > CLOCK_TOLERANCE_MIN:
            return "mentions a time that is not in the timetable"
    return None


def _clock_mentions(text: str) -> list[int]:
    return [int(h) * 60 + int(m) for h, m in re.findall(r"\b([01]?\d|2[0-3]):([0-5]\d)\b", text)]


def _theme(day: dict) -> str:
    ids = {activity.get("activity_id") for activity in day.get("activities") or []}
    if ids & {"flight:outbound", "ground:outbound"}:
        return "Arrival"
    if ids & {"flight:return", "ground:return"}:
        return "Departure"
    if any(str(i).startswith("move:") for i in ids):
        return "Travel day"
    categories = [a.get("category") for a in day.get("activities") or [] if a.get("category") not in NOT_SIGHTS | {"food"}]
    if not categories:
        return "Free day"
    label = max(set(categories), key=categories.count)
    return {
        "history": "Culture & sights", "culture": "Culture & sights", "nature": "Outdoors",
        "beach": "Beach", "entertainment": "Fun & entertainment",
    }.get(label, str(label).replace("_", " ").title())


def _sentence(activities: list[dict], money) -> str:
    parts = []
    for activity in activities:
        start = _hhmm(activity.get("start_minute"))
        end = _hhmm(activity.get("end_minute"))
        when = f"{start}–{end}. " if start and end else ""
        detail = fill_money(activity.get("detail") or "", money)
        parts.append(f"{when}{activity.get('name')}." + (f" {detail}" if detail else ""))
    return " ".join(parts)


def _hhmm(minute) -> str:
    if not isinstance(minute, int):
        return ""
    hour, mins = divmod(minute % (24 * 60), 60)
    return f"{hour:02d}:{mins:02d}"


def _slot_label(start: int) -> str:
    if start < 12 * 60:
        return "morning"
    if start < 17 * 60:
        return "midday"
    return "evening"
