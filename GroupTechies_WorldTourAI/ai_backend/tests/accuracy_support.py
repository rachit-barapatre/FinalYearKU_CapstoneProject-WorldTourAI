"""Offline stand-ins for Geoapify, hotel, flight and routing providers, with real coordinates for three Indian cities."""

import json
import math

from worldtour_ai.agents import itinerary_agent, recommendation_agent
from worldtour_ai.tools import toolkit

CITIES = {
    "Goa": (15.4909, 73.8278),
    "Jaipur": (26.9124, 75.7873),
    "Udaipur": (24.5854, 73.7125),
    "Ahmedabad": (23.0225, 72.5714),
}

# (name, category, lat, lon)
PLACES = {
    "Goa": [
        ("Fort Aguada", "history", 15.4925, 73.7737), ("Basilica of Bom Jesus", "culture", 15.5009, 73.9116),
        ("Se Cathedral", "culture", 15.5030, 73.9115), ("Baga Beach", "beach", 15.5553, 73.7517),
        ("Calangute Beach", "beach", 15.5440, 73.7550), ("Chapora Fort", "history", 15.6060, 73.7360),
        ("Fontainhas Latin Quarter", "culture", 15.4963, 73.8319), ("Miramar Beach", "beach", 15.4817, 73.8083),
        ("Reis Magos Fort", "history", 15.4930, 73.8010), ("Museum of Goa", "culture", 15.5400, 73.8400),
        ("Mangueshi Temple", "culture", 15.4510, 73.9710), ("Sunset Cruise Mandovi", "entertainment", 15.4990, 73.8250),
        # Wrong places a map search can return: a falls 52 km inland, and a Jaipur landmark.
        ("Dudhsagar Falls", "nature", 15.3144, 74.3143), ("Hawa Mahal", "history", 26.9239, 75.8267),
    ],
    "Jaipur": [
        ("City Palace Jaipur", "history", 26.9258, 75.8237), ("Hawa Mahal", "history", 26.9239, 75.8267),
        ("Amber Fort", "history", 26.9855, 75.8513), ("Jantar Mantar", "culture", 26.9247, 75.8246),
        ("Nahargarh Fort", "history", 26.9373, 75.8155), ("Jal Mahal", "sightseeing", 26.9534, 75.8462),
        ("Albert Hall Museum", "culture", 26.9118, 75.8190), ("Birla Mandir", "culture", 26.8923, 75.8157),
        ("Govind Dev Ji Temple", "culture", 26.9296, 75.8240),
    ],
    "Udaipur": [
        ("City Palace Udaipur", "history", 24.5764, 73.6835), ("Jagdish Temple", "culture", 24.5802, 73.6837),
        ("Saheliyon ki Bari", "culture", 24.5997, 73.6850), ("Fateh Sagar Lake", "nature", 24.6006, 73.6773),
        ("Monsoon Palace Sajjangarh", "history", 24.5958, 73.6355), ("Bagore Ki Haveli", "culture", 24.5791, 73.6820),
        ("Vintage Car Museum", "culture", 24.5632, 73.6975), ("Eklingji Temple", "culture", 24.6667, 73.7167),
        ("Lake Pichola Boat Ride", "entertainment", 24.5724, 73.6800),
        ("Kumbhalgarh Fort", "history", 25.1528, 73.5871),  # about 70 km away: needs its own day trip
    ],
}

HOTELS = {
    "Goa": [("Goa Marriott Resort", 15.4780, 73.8110, 95.0), ("Fortune Miramar", 15.4830, 73.8140, 70.0), ("Hotel Panaji Residency", 15.4990, 73.8300, 35.0)],
    "Jaipur": [("Hotel Pearl Palace", 26.9140, 75.7940, 40.0), ("Fairmont Jaipur", 26.9510, 75.7610, 190.0), ("Hotel Arya Niwas", 26.9150, 75.8000, 55.0)],
    "Udaipur": [("Hotel Lake Pichola", 24.5740, 73.6810, 120.0), ("Jagat Niwas Palace", 24.5790, 73.6830, 75.0), ("Hotel Udai Kothi", 24.5760, 73.6870, 60.0)],
}


def km(a, b):
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    d = math.radians(b[1] - a[1])
    dp = p2 - p1
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(d / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))


class FakePlacesTool:
    def invoke(self, args):
        city = json.loads(args["payload_json"])["city"]
        items = [
            {"place_id": f"{city[:2]}{i}", "name": n, "category": c, "lat": la, "lon": lo, "rating": None,
             "score": 10 - i * 0.2, "address": city, "data_source": "live", "source": "Geoapify (OpenStreetMap)"}
            for i, (n, c, la, lo) in enumerate(PLACES[city])
        ]
        return json.dumps({"provider_used": "geoapify", "data_source": "live", "places": items, "algorithms_executed": ["Top-K"]})


class FakeHotels:
    def search_hotels(self, city, lat, lon, nights, preferences, **ctx):
        options = [
            {"option_id": f"h-{city}-{i}", "name": n, "city": city, "price_per_night": p, "currency": "USD",
             "rating": None, "lat": la, "lon": lo, "nights": nights, "data_source": "llm", "verified_on_map": True,
             "price_is_estimate": True, "distance_to_center_km": 1.0, "tier": "mid", "note": "map record; estimated rate"}
            for i, (n, la, lo, p) in enumerate(HOTELS[city])
        ]
        return {"provider_used": "openrouter_hotels", "data_source": "llm", "options": options}


class FakeFlights:
    """Aviationstack-style: a real schedule and no fare."""

    def search_flights(self, origin, destination, date, return_date=None):
        def flight(i, dep, arr, back=False):
            return {"option_id": f"avs-{i}", "airline": "IndiGo", "flight_number": f"6E{200 + i}",
                    "origin": destination if back else origin, "destination": origin if back else destination, "departure_time": f"{date}T{dep}:00+00:00", "arrival_time": f"{date}T{arr}:00+00:00",
                    "duration_minutes": None, "stops": 0, "price": None, "currency": None, "price_is_estimate": False,
                    "data_source": "live"}
        return {"provider_used": "aviationstack", "data_source": "live", "options": [flight(1, "08:00", "09:55"), flight(2, "13:00", "14:55")],
                "return_options": [flight(3, "18:00", "19:55", back=True)]}


class FakeRouting:
    """OSRM-shaped table: road distance is 1.4x straight line, speed 35 km/h."""

    calls = 0

    def table(self, points):
        FakeRouting.calls += 1
        coords = [(p["lat"], p["lon"]) for p in points]
        dist = [[km(a, b) * 1.4 * 1000 for b in coords] for a in coords]
        dur = [[d / 1000 / 35 * 3600 for d in row] for row in dist]
        return {"provider_used": "osrm", "data_source": "live_route_calculation", "distances_m": dist, "durations_s": dur}


def install(monkeypatch, routing=True):
    monkeypatch.setattr(recommendation_agent, "places_tool", FakePlacesTool())
    monkeypatch.setattr(toolkit, "HotelGateway", FakeHotels)
    monkeypatch.setattr(toolkit, "FlightGateway", FakeFlights)
    if routing:
        monkeypatch.setattr(itinerary_agent, "RoutingGateway", FakeRouting)
