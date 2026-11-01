"""Is the itinerary true? Provider data stays provider data, estimates are labelled, and impossible plans are caught.

Everything runs offline with fake providers that carry real coordinates for Goa, Jaipur and Udaipur.
"""

import copy
import json
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

import accuracy_support as A
from worldtour_ai.config.settings import reset_settings_cache
from worldtour_ai.providers.flights import aviationstack_flight_provider as avs
from worldtour_ai.providers.hotels.openrouter_hotel_provider import OpenRouterHotelProvider
from worldtour_ai.services.constraint_validator import validate_itinerary
from worldtour_ai.services.itinerary_composer import (
    apply_llm_details,
    catalog_from_places,
    plan_days,
    unsupported_claim,
)
from worldtour_ai.tools.toolkit import _fill_missing_fares
from worldtour_ai.web.app import app

client = TestClient(app)
NOT_SIGHTS = {"travel", "transfer", "meal", "stay"}
GOA = "Plan a 4 day trip from Ahmedabad to Goa for 2 people, starting 2026-12-10, budget 90000 INR, we like beaches and history"
RAJASTHAN = "Plan a 3 day trip from Jaipur to Udaipur for 2 people, starting 2026-12-12, budget 60000 INR, we like culture and history"


def run_plan(message, monkeypatch, routing=True):
    A.install(monkeypatch, routing)
    reset_settings_cache()
    chat = client.post("/api/chat", json={"message": message, "currency": "INR"}).json()
    assert chat["ready"] is True, chat["reply"]
    plan = None
    with client.stream("POST", "/api/plan", json={"session": chat["session"]}) as response:
        for line in response.iter_lines():
            if line and json.loads(line)["type"] == "plan":
                plan = json.loads(line)["plan"]
    assert plan, "no plan was produced"
    return plan


@pytest.fixture(params=[("Goa", GOA, "Goa", 4), ("Udaipur", RAJASTHAN, "Udaipur", 3)], ids=["ahmedabad-goa", "jaipur-udaipur"])
def trip(request, monkeypatch):
    city, message, destination, days = request.param
    return run_plan(message, monkeypatch), city, destination, days


def sights(plan):
    return [a for d in plan["daily_itinerary"] for a in d["activities"] if a["category"] not in NOT_SIGHTS | {"food"}]


# -------------------------------------------------------------------- 1. locations


def test_every_scheduled_place_is_a_real_provider_record_in_the_right_city(trip):
    plan, city, _dest, _days = trip
    known = {name: (lat, lon) for name, _c, lat, lon in A.PLACES[city]}
    assert len(sights(plan)) >= 6
    for a in sights(plan):
        assert a["name"] in known, f"{a['name']} did not come from the provider"
        assert a["source"] == "provider"
        assert A.km(A.CITIES[city], known[a["name"]]) <= 35, f"{a['name']} is not in {city}"


def test_places_from_other_cities_or_far_away_are_never_scheduled(monkeypatch):
    goa = {a["name"] for a in sights(run_plan(GOA, monkeypatch))}
    assert "Hawa Mahal" not in goa and "Dudhsagar Falls" not in goa  # a Jaipur landmark and a place 52 km inland
    udaipur = {a["name"] for a in sights(run_plan(RAJASTHAN, monkeypatch))}
    assert "Kumbhalgarh Fort" not in udaipur  # 70 km away: would need its own day trip


def test_the_planner_itself_refuses_a_top_scored_place_in_another_city_or_far_outside_the_city():
    rows = [("Hawa Mahal", "history", 26.9239, 75.8267), ("Dudhsagar Falls", "nature", 15.3144, 74.3143),
            ("Fort Aguada", "history", 15.4925, 73.7737), ("Reis Magos Fort", "history", 15.4930, 73.8010),
            ("Baga Beach", "beach", 15.5553, 73.7517)]
    catalog = catalog_from_places([{"place_id": f"p{i}", "name": n, "category": c, "lat": la, "lon": lo, "score": 100 - i}
                                   for i, (n, c, la, lo) in enumerate(rows)])
    plans = plan_days(catalog, ["Goa", "Goa"], [(540, 1290)] * 2, "packed")
    chosen = {s["name"] for p in plans for s in p["sights"]}
    assert chosen == {"Fort Aguada", "Reis Magos Fort", "Baga Beach"}


def test_geoapify_places_carry_a_source_and_no_invented_rating():
    from worldtour_ai.providers.places.geoapify_places_provider import GeoapifyPlacesProvider

    class Http:
        def get_json(self, url, params=None, **k):
            return {"features": [{"properties": {"place_id": "x1", "name": "Fort Aguada", "categories": ["tourism.sights.fort"],
                                                 "formatted": "Fort Aguada, Goa"}, "geometry": {"coordinates": [73.7737, 15.4925]}}]}

    import os
    os.environ["GEOAPIFY_API_KEY"] = "test-key"
    reset_settings_cache()
    try:
        place = GeoapifyPlacesProvider(http=Http()).search_places("Goa", 15.49, 73.82, [])["places"][0]
    finally:
        os.environ["GEOAPIFY_API_KEY"] = ""
        reset_settings_cache()
    assert place["rating"] is None and place["source"] == "Geoapify (OpenStreetMap)" and place["lat"] == 15.4925


def test_places_without_coordinates_cannot_be_verified_and_are_not_scheduled():
    catalog = catalog_from_places([
        {"place_id": "a", "name": "Real Fort", "category": "history", "lat": 15.5, "lon": 73.8},
        {"place_id": "b", "name": "Mystery Palace", "category": "history", "lat": None, "lon": None},
    ])
    assert [c["name"] for c in catalog] == ["Real Fort"]


def test_made_up_ratings_are_not_attached_to_places(trip):
    plan = trip[0]
    assert all(p.get("rating") is None for p in plan["attractions"])


# -------------------------------------------------------------------- 2. routes and time


def test_cab_legs_use_measured_road_distance_when_routing_is_available(trip):
    plan = trip[0]
    hops = [a for d in plan["daily_itinerary"] for a in d["activities"]
            if a["category"] == "transfer" and a["activity_id"].split(":")[1].isdigit()]
    assert hops and all(h["source"] == "road_routing" for h in hops)
    # The fake road network is 1.4 x straight line, so a 10 km straight hop must show about 14 km, not the guessed 13.
    for day in plan["daily_itinerary"]:
        acts = day["activities"]
        for before, hop, after in zip(acts, acts[1:], acts[2:]):
            if hop in hops and before.get("lat") is not None and after.get("lat") is not None and hop["mode"] == "cab":
                straight = A.km((before["lat"], before["lon"]), (after["lat"], after["lon"]))
                assert f"~{round(straight * 1.4, 1)} km" in hop["detail"] or straight < 0.2


def test_without_routing_legs_are_labelled_as_estimates(monkeypatch):
    plan = run_plan(RAJASTHAN, monkeypatch, routing=False)
    hops = [a for d in plan["daily_itinerary"] for a in d["activities"]
            if a["category"] == "transfer" and a["activity_id"].split(":")[1].isdigit()]
    assert hops and all(h["source"] == "estimate" and "estimated" in h["detail"] for h in hops)
    assert any("straight-line" in note for note in plan["data_notes"])


def test_the_local_fallback_graph_is_not_passed_off_as_road_routing(monkeypatch):
    class FallbackRouting:
        def table(self, points):
            return {"provider_used": "local_graph", "fallback_reason": "osrm down", "distances_m": [[0]], "durations_s": [[0]]}

    A.install(monkeypatch, routing=False)
    from worldtour_ai.agents import itinerary_agent
    monkeypatch.setattr(itinerary_agent, "RoutingGateway", FallbackRouting)
    reset_settings_cache()
    plan = run_plan(RAJASTHAN, monkeypatch, routing=False)
    assert plan["verification"]["local_transport"]["road_routing"] == 0


def test_a_day_is_practical_consecutive_stops_leave_time_to_travel(trip):
    plan = trip[0]
    for day in plan["daily_itinerary"]:
        located = [a for a in day["activities"] if a["category"] not in NOT_SIGHTS and a.get("lat") is not None]
        for a, b in zip(located, located[1:]):
            gap = b["start_minute"] - a["end_minute"]
            assert gap >= A.km((a["lat"], a["lon"]), (b["lat"], b["lon"])) / 90 * 60, (a["name"], b["name"])
        ends = [x["end_minute"] for x in day["activities"]]
        assert max(ends) <= 24 * 60
        assert sorted(x["start_minute"] for x in day["activities"]) == [x["start_minute"] for x in day["activities"]]


def test_days_are_geographic_clusters_not_a_zigzag_across_town():
    catalog = catalog_from_places([
        {"place_id": f"p{i}", "name": n, "category": c, "lat": la, "lon": lo, "score": 10 - i * 0.1}
        for i, (n, c, la, lo) in enumerate(A.PLACES["Goa"][:12])
    ])
    windows = [(540, 1290)] * 4
    plans = plan_days(catalog, ["Goa"] * 4, windows, "balanced", anchors={"Goa": (15.4817, 73.8083)})

    def tour(day):
        pts = [(s["lat"], s["lon"]) for s in day["sights"]]
        return sum(A.km(a, b) for a, b in zip(pts, pts[1:]))

    names = [s["name"] for p in plans for s in p["sights"]]
    assert len(names) == len(set(names))
    # Basilica and Se Cathedral are 300 m apart: they must be on the same day.
    day_of = {s["name"]: i for i, p in enumerate(plans) for s in p["sights"]}
    if "Basilica of Bom Jesus" in day_of and "Se Cathedral" in day_of:
        assert day_of["Basilica of Bom Jesus"] == day_of["Se Cathedral"]
    assert max(tour(p) for p in plans if p["sights"]) < 25


# -------------------------------------------------------------------- 5. consistency


def test_trip_duration_dates_and_days_match_the_request(trip):
    plan, _city, _dest, days = trip
    itinerary = plan["daily_itinerary"]
    assert len(itinerary) == days and plan["duration"]["days"] == days
    start = date.fromisoformat(plan["dates"]["start_date"])
    assert [d["date"] for d in itinerary] == [(start + timedelta(days=i)).isoformat() for i in range(days)]
    assert all(d["city"] == trip[2] for d in itinerary)
    assert not [w for w in plan["warnings"] if w.startswith("Schedule check")]


def test_every_day_has_destination_activities_and_no_place_repeats(trip):
    plan = trip[0]
    for day in plan["daily_itinerary"]:
        assert any(a["category"] not in NOT_SIGHTS for a in day["activities"]) or day["day"] in (1, len(plan["daily_itinerary"]))
    names = [a["name"] for a in sights(plan)]
    assert len(names) == len(set(names))
    assert len({d["morning"] for d in plan["daily_itinerary"]}) == len(plan["daily_itinerary"]), "days read identically"


def test_validator_catches_duplicates_far_places_impossible_hops_and_bad_dates():
    def act(i, name, start, end, lat, lon, cat="history"):
        return {"activity_id": i, "name": name, "category": cat, "start_minute": start, "end_minute": end, "lat": lat, "lon": lon}

    days = [
        {"day": 1, "city": "Goa", "date": "2026-12-10", "activities": [
            act("a", "Fort Aguada", 540, 660, 15.4925, 73.7737),
            act("b", "Chapora Fort", 665, 780, 15.6060, 73.7360),            # 14 km in 5 minutes
            act("c", "Hawa Mahal", 900, 960, 26.9239, 75.8267),               # another city
        ]},
        {"day": 2, "city": "Goa", "date": "2026-12-15", "activities": [        # wrong date
            act("a2", "Fort Aguada", 540, 660, 15.4925, 73.7737),              # repeated place
        ]},
    ]
    codes = {v["code"] for v in validate_itinerary(days, {"duration_days": 3, "start_date": "2026-12-10"})["violations"]}
    assert {"impossible_travel", "out_of_area", "duplicate_place", "date", "day_count"} <= codes


def test_validator_accepts_the_generated_itineraries(trip):
    plan, _c, _d, days = trip
    request = {"duration_days": days, "start_date": plan["dates"]["start_date"]}
    assert validate_itinerary(plan["daily_itinerary"], request)["violations"] == []


# -------------------------------------------------------------------- 6. budget


def test_budget_is_mathematically_consistent(trip):
    plan = trip[0]
    rows = plan["budget_breakdown"]
    assert round(sum(r["cost"] for r in rows), 2) == plan["estimated_cost"]
    recommended = next(p for p in plan["packages"] if p["name"] == plan["recommended_package"])
    assert abs(recommended["total"] - plan["estimated_cost"]) < 0.05
    parts = recommended["hotels"] and sum(h.get("cost", 0) for h in recommended["hotels"])
    planning = plan["budget"]["planning_budget"]
    assert plan["remaining_budget"] == round(planning - plan["estimated_cost"], 2)
    assert all(r["cost"] >= 0 for r in rows)
    assert recommended["fits_budget"] == (recommended["total"] <= planning)
    # Every cab leg in the timetable is what the local-transport line adds up (before currency rounding).
    cabs = sum(a["cost_usd"] or 0 for d in plan["daily_itinerary"] for a in d["activities"] if a["category"] == "transfer")
    local = next(r["cost"] for r in rows if r["category"] == "Local transport")
    assert abs(cabs - local) < 0.05


def test_estimated_prices_are_flagged_and_no_fare_is_passed_off_as_live(trip):
    plan = trip[0]
    assert plan["selected_flights"] and all(f["price_is_estimate"] for f in plan["selected_flights"])
    assert all(f.get("duration_is_estimate") for f in plan["selected_flights"])
    assert plan["verification"]["flights"]["level"] == "provider_schedule_estimated_fares"
    assert plan["verification"]["entry_fees"]["level"] == "estimate"
    assert not any(note.startswith("Flight fares are live") for note in plan["data_notes"])


# -------------------------------------------------------------------- 3. flights and hotels: no fabricated provider data


def test_flight_numbers_and_times_come_only_from_the_provider(trip):
    plan = trip[0]
    legs = [a for d in plan["daily_itinerary"] for a in d["activities"] if a["activity_id"].startswith("flight:")]
    provider = {f["flight_number"] for f in plan["selected_flights"] + plan["return_flights"]}
    assert legs and all(any(num in a["detail"] for num in provider) for a in legs)
    assert all(a["source"] == "provider" for a in legs)


def test_missing_fares_are_estimates_and_never_invent_a_flight_number():
    options = [{"option_id": "x", "flight_number": None, "airline": None, "stops": 0, "price": None, "duration_minutes": None}]
    _fill_missing_fares(options, "AMD", "GOI")
    assert options[0]["price_is_estimate"] and options[0]["duration_is_estimate"]
    assert options[0]["flight_number"] is None and "estimate" in options[0]["note"]


def test_a_connection_where_the_second_flight_leaves_before_the_first_lands_is_rejected():
    def row(dep, arr, dep_iata, arr_iata):
        return {"departure": {"iata": dep_iata, "scheduled": dep}, "arrival": {"iata": arr_iata, "scheduled": arr},
                "airline": {"name": "X"}, "flight": {"iata": "XX1"}}

    first = row("2026-12-10T08:00:00+00:00", "2026-12-10T10:00:00+00:00", "AMD", "BOM")
    assert not avs._layover_ok(first, row("2026-12-10T09:00:00+00:00", "2026-12-10T11:00:00+00:00", "BOM", "GOI"))  # before landing
    assert not avs._layover_ok(first, row("2026-12-10T10:20:00+00:00", "2026-12-10T12:00:00+00:00", "BOM", "GOI"))  # 20 min is too tight
    assert not avs._layover_ok(first, row("2026-12-11T10:00:00+00:00", "2026-12-11T12:00:00+00:00", "BOM", "GOI"))  # next day
    assert not avs._layover_ok(first, {"departure": {}, "arrival": {}})
    assert avs._layover_ok(first, row("2026-12-10T12:30:00+00:00", "2026-12-10T14:00:00+00:00", "BOM", "GOI"))


def test_one_stop_search_only_builds_connections_that_can_happen(monkeypatch):
    provider = avs.AviationStackFlightProvider(api_key="test")

    def row(dep, arr, a, b):
        return {"departure": {"iata": a, "scheduled": dep}, "arrival": {"iata": b, "scheduled": arr},
                "airline": {"name": "X"}, "flight": {"iata": f"{a}{b}"}}

    def query(params):
        if params.get("dep_iata") == "AMD":
            return [row("2026-12-10T08:00:00+00:00", "2026-12-10T10:00:00+00:00", "AMD", "BOM")]
        if params.get("dep_iata") == "BOM":
            return [row("2026-12-10T09:00:00+00:00", "2026-12-10T10:30:00+00:00", "BOM", "GOI")]  # leaves before AMD-BOM lands
        return []

    monkeypatch.setattr(provider, "_query", query)
    assert provider._one_stop("AMD", "GOI") == []


class FakeLLM:
    def __init__(self, answer):
        self.answer = answer

    def complete(self, *a, **k):
        return self.answer


class FakeHttp:
    def __init__(self, names):
        self.names = names

    def get_json(self, url, params=None, cache_ttl=None, **k):
        if "geocode" in url:
            return {"results": []}  # the map has never heard of the hotel the AI named
        return {"features": [{"properties": {"name": n, "lat": 15.49 + i / 100, "lon": 73.82, "formatted": f"{n}, Goa"}} for i, n in enumerate(self.names)]}


@pytest.fixture
def mapped_env(monkeypatch):
    monkeypatch.setenv("GEOAPIFY_API_KEY", "test-key")
    monkeypatch.setenv("DISABLE_NETWORK", "false")
    reset_settings_cache()
    yield
    reset_settings_cache()


def test_ai_hotel_names_the_map_cannot_confirm_are_dropped_when_real_ones_exist(mapped_env, monkeypatch, tmp_path):
    monkeypatch.setenv("CACHE_DIR", str(tmp_path))
    real = ["Hotel Fidalgo", "Hotel Mandovi"]
    answer = json.dumps({"hotels": [
        {"name": "Hotel Fidalgo", "tier": "mid", "price_per_night_usd": 60, "rating": 4.1},
        {"name": "Grand Imaginary Palace Goa", "tier": "luxury", "price_per_night_usd": 400, "rating": 4.9},
    ]})
    provider = OpenRouterHotelProvider(llm=FakeLLM(answer), http=FakeHttp(real))  # fewer than 6 mapped: AI suggests from memory
    result = provider.search_hotels("Goa", 15.49, 73.82, 2, [], travelers=2)
    names = [o["name"] for o in result["options"]]
    assert names == ["Hotel Fidalgo"] and result["unverified_count"] == 0
    assert result["options"][0]["verified_on_map"] and result["options"][0]["price_is_estimate"]


def test_unconfirmed_ai_hotels_are_kept_only_when_nothing_is_confirmed_and_are_labelled(mapped_env, monkeypatch, tmp_path):
    monkeypatch.setenv("CACHE_DIR", str(tmp_path))
    answer = json.dumps({"hotels": [{"name": "Grand Imaginary Palace Goa", "tier": "luxury", "price_per_night_usd": 400, "rating": 4.9}]})
    result = OpenRouterHotelProvider(llm=FakeLLM(answer), http=FakeHttp([])).search_hotels("Goa", 15.49, 73.82, 2, [], travelers=2)
    option = result["options"][0]
    assert option["verified_on_map"] is False and "not confirmed" in option["source"]
    assert "check it before booking" in option["note"] and result["unverified_count"] == 1


def test_hotels_from_the_map_list_keep_the_real_name_and_location(mapped_env, monkeypatch, tmp_path):
    monkeypatch.setenv("CACHE_DIR", str(tmp_path))
    names = [f"Real Hotel {c}" for c in "ABCDEFGH"]
    rates = json.dumps({"hotels": [{"n": i, "tier": "mid", "price_per_night_usd": 40 + i * 10, "rating": 4.0} for i in range(1, 9)]})
    result = OpenRouterHotelProvider(llm=FakeLLM(rates), http=FakeHttp(names)).search_hotels("Goa", 15.49, 73.82, 2, [], travelers=2)
    assert {o["name"] for o in result["options"]} <= set(names)
    assert all(o["verified_on_map"] and o["lat"] is not None for o in result["options"])


# -------------------------------------------------------------------- 4 & 7. AI text may only restate the timetable


DAY = {
    "day": 2, "date": "2026-12-11", "morning": "09:00–11:00. Fort Aguada. Rs 120", "midday": "", "evening": "",
    "activities": [
        {"activity_id": "a", "name": "Fort Aguada", "category": "history", "start_minute": 540, "end_minute": 660},
        {"activity_id": "b", "name": "Lunch nearby", "category": "meal", "start_minute": 720, "end_minute": 780},
    ],
}


def reply(text):
    return json.dumps({"days": [{"day": 2, "title": "Day 2 – Forts", "morning": text, "midday": "Lunch nearby at 12:00.", "evening": "Back at the hotel."}]})


@pytest.mark.parametrize("claim", [
    "Fort Aguada opens at 9:00 and closes at 18:00.",
    "Fort Aguada is open daily until sunset.",
    "Fort Aguada was built in 1612 by the Portuguese.",
    "Fort Aguada is a UNESCO World Heritage site.",
    "Entry fee is Rs 500 per person at Fort Aguada.",
    "Fort Aguada is rated 4.8 stars by visitors.",
    "At 15:45 you reach Fort Aguada.",
    "You pay $35 for Fort Aguada.",
])
def test_ai_text_with_unverifiable_facts_is_rejected(claim):
    assert unsupported_claim(claim, DAY), claim
    days = [copy.deepcopy(DAY)]
    assert apply_llm_details(reply(claim), days) == 0
    assert days[0]["morning"] == DAY["morning"] and days[0].get("text_source") != "ai_generated"


def test_ai_text_that_restates_the_timetable_is_accepted_and_marked_as_ai():
    days = [copy.deepcopy(DAY)]
    assert apply_llm_details(reply("At 09:00 you reach Fort Aguada and spend about two hours there."), days) == 1
    assert days[0]["text_source"] == "ai_generated"
    assert "Fort Aguada" in days[0]["morning"]


def test_ai_text_may_reuse_a_price_the_timetable_already_states():
    assert unsupported_claim("The cab costs Rs 120.", DAY) is None


def test_ai_text_that_drops_a_scheduled_sight_is_rejected():
    days = [copy.deepcopy(DAY)]
    assert apply_llm_details(reply("You relax at the hotel all morning."), days) == 0


# -------------------------------------------------------------------- 7. transparency in the plan


def test_plan_labels_what_is_provider_data_what_is_estimated_and_what_is_ai(trip):
    plan = trip[0]
    v = plan["verification"]
    assert v["attractions"]["level"] == "provider" and v["opening_hours"]["level"] == "not_verified"
    assert v["hotels"]["level"] == "real_hotels_estimated_rates" and v["hotels"]["unconfirmed"] == 0
    assert v["ground_transport"]["level"] in {"estimate", "none"}
    assert v["day_text"] == {"ai_generated_days": 0, "built_in_days": len(plan["daily_itinerary"])}
    assert all(d["text_source"] == "built_in" for d in plan["daily_itinerary"])
    notes = " ".join(plan["data_notes"])
    assert "Opening hours" in notes and "not verified" in notes
    assert all(a.get("source") in {"provider", "road_routing", "estimate"} for d in plan["daily_itinerary"] for a in d["activities"])
    assert all(hotel["price_is_estimate"] for hotel in plan["selected_hotels"])
