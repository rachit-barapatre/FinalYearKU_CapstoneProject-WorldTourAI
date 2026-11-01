"""Assemble the final plan from agent results. The text reports only algorithms that ran."""

from __future__ import annotations

from datetime import date, timedelta
from urllib.parse import quote, urlencode

from worldtour_ai.data.places import lookup_place
from worldtour_ai.services.request_parser import trip_start
from worldtour_ai.services.scoring_service import DEFAULT_WEIGHTS, optimization_sentence
from worldtour_ai.services.transport import AIRPORT_KM, STATION_KM, local_rates
from worldtour_ai.utils.events import REPLAN_TRIGGERED

_ORDER = [
    "Priority Queue",
    "Sorting",
    "Heap",
    "Top-K",
    "0/1 Knapsack",
    "Dynamic Programming",
    "Dijkstra",
    "A*",
    "Nearest Neighbour",
    "Greedy",
    "Interval Scheduling",
    "BFS",
    "DFS",
    "Constraint Checking",
]


def build_final_plan(state: dict) -> dict:
    request = state.get("parsed_request") or {}
    flight = state.get("flight_result") or {}
    hotel = state.get("hotel_result") or {}
    budget = state.get("budget_result") or {}
    route = state.get("route_result") or {}
    itinerary = state.get("itinerary_result") or {}
    weather = state.get("weather_result") or {}
    recommendations = state.get("recommendation_result") or {}
    algorithms = []
    for result in (flight, hotel, budget, route, itinerary, weather, recommendations):
        for name in result.get("algorithms_executed") or []:
            if name not in algorithms:
                algorithms.append(name)
    if state.get("weather_checked") and "Constraint Checking" not in algorithms:
        algorithms.append("Constraint Checking")
    algorithms = [name for name in _ORDER if name in algorithms]
    transport_result = state.get("transport_result") or {}
    for name in transport_result.get("algorithms_executed") or []:
        if name not in algorithms:
            algorithms.insert(0, name)

    packages = [dict(package) for package in budget.get("packages") or []]
    recommended = next((p for p in packages if p["name"] == budget.get("recommended_package")), None)
    local_actual = itinerary.get("local_transport_usd")
    if recommended and isinstance(local_actual, (int, float)) and local_actual > 0:
        # The timetable prices every cab ride, so the recommended package uses that instead of the daily rate.
        recommended["total"] = round(recommended["total"] - recommended["local_cost"] + local_actual, 2)
        recommended["local_cost"] = local_actual
        budget = {**budget, "local_cost": local_actual, "local_from_timetable": True}
    paid_actual = itinerary.get("paid_activities_usd")
    if recommended and isinstance(paid_actual, (int, float)) and itinerary.get("days"):
        # Only the paid places that made it into the timetable cost money.
        recommended["total"] = round(recommended["total"] - recommended.get("activities_cost", 0) + paid_actual, 2)
        recommended["activities_cost"] = paid_actual
        budget = {**budget, "total_cost": paid_actual, "paid_count": itinerary.get("paid_activities_count", 0)}
    if recommended:
        recommended["fits_budget"] = budget.get("planning_budget") is None or recommended["total"] <= budget["planning_budget"]
    breakdown = _breakdown(budget, live_fares=flight.get("provider_used") == "serpapi_google_flights")
    estimated = round(sum(row["cost"] for row in breakdown), 2)
    planning_budget = budget.get("planning_budget")
    remaining = None if planning_budget is None else round(float(planning_budget) - estimated, 2)
    providers = [
        {"agent_id": label, "provider_used": result.get("provider_used"), "data_source": result.get("data_source")}
        for label, result in (
            ("FLIGHT_AGENT", flight),
            ("TRANSPORT_AGENT", transport_result),
            ("HOTEL_AGENT", hotel),
            ("WEATHER_AGENT", weather),
            ("RECOMMENDATION_AGENT", recommendations),
            ("ROUTE_AGENT", route),
        )
        if result
    ]
    destination = request.get("destination")
    summary = f"Plan for {destination or 'your trip'}"
    if request.get("duration_days"):
        summary += f", {request['duration_days']} days"
    days = itinerary.get("days") or []
    return {
        "trip_summary": summary,
        "origin": request.get("origin"),
        "destination": destination,
        "dates": {
            "start_date": request.get("start_date"),
            "end_date": request.get("end_date"),
            "travel_month": request.get("travel_month"),
            # The first day the plan was built for, also when the traveler gave no dates (flights,
            # hotels and weather use it): the calendar export needs a real day to put events on.
            "planned_start": trip_start(request)[0].isoformat(),
        },
        "duration": {"days": request.get("duration_days"), "nights": budget.get("nights_used") or request.get("duration_nights")},
        "travelers": request.get("travelers"),
        "pace": request.get("pace"),
        "preferences": request.get("preferences") or [],
        "budget": {
            "amount": request.get("budget"),
            "currency": request.get("currency"),
            "scope": request.get("budget_scope"),
            "user_stated": request.get("budget_is_user_stated", False),
            "planning_budget": planning_budget,
            "planning_budget_is_assumption": budget.get("planning_budget_is_assumption", False),
        },
        "packages": packages,
        "recommended_package": budget.get("recommended_package"),
        "display_currency": budget.get("display_currency") or "USD",
        "usd_to_display": budget.get("usd_to_display") or 1.0,
        "transport_choice": budget.get("transport"),
        "ground_options": transport_result.get("options") or [],
        "road_km": transport_result.get("road_km"),
        "selected_flights": flight.get("options") or [],
        "return_flights": flight.get("return_options") or [],
        "selected_hotels": hotel.get("options") or [],
        "recommended_hotel_id": budget.get("recommended_hotel_id"),
        "recommended_hotel_ids": budget.get("recommended_hotel_ids") or [],
        "recommended_outbound_id": budget.get("recommended_outbound_id"),
        "recommended_return_id": budget.get("recommended_return_id"),
        "budget_breakdown": breakdown,
        "cities": request.get("cities") or [],
        "routes": {
            "dijkstra": route.get("dijkstra"),
            "a_star": route.get("a_star"),
            "provider_used": route.get("provider_used"),
            "data_source": route.get("data_source"),
            "note": route.get("note"),
        },
        "daily_itinerary": days,
        "daily_spend": itinerary.get("daily_spend"),
        "attractions": recommendations.get("places") or [],
        "weather_information": {
            "data_source": weather.get("data_source"),
            "summary": weather.get("summary"),
            "days": weather.get("days") or [],
            "dates_assumed": weather.get("dates_assumed", False),
        },
        "packing_tips": _packing_tips(weather.get("days") or [], days),
        "links": _links(request, flight, budget, days),
        "estimated_cost": estimated,
        "remaining_budget": remaining,
        "warnings": _clean_warnings(state.get("warnings") or []),
        "constraint_violations": (state.get("constraints") or {}).get("violations") or [],
        "optimization_explanation": optimization_sentence() + " Weights: " + ", ".join(f"{k}={v}" for k, v in DEFAULT_WEIGHTS.items()) + ".",
        "algorithms_actually_used": algorithms,
        "provider_information": providers,
        "replanning_history": [event for event in state.get("agent_execution_history") or [] if event.get("event") == REPLAN_TRIGGERED],
        "optimization_metrics": {
            "weights": DEFAULT_WEIGHTS,
            "knapsack_value": budget.get("total_value"),
            "knapsack_cost": budget.get("total_cost"),
            "dijkstra_cost_km": (route.get("dijkstra") or {}).get("total_cost_km") if isinstance(route.get("dijkstra"), dict) else None,
            "astar_cost_km": (route.get("a_star") or {}).get("total_cost_km") if isinstance(route.get("a_star"), dict) else None,
        },
        "parser_notes": request.get("parser_notes") or [],
        # What the browser needs to re-cost the trip when the traveler picks another flight, train or hotel.
        "pricing": _pricing(request, budget),
        "cities_are_suggestions": request.get("cities_are_suggestions", False),
        "data_notes": _data_notes(flight, hotel, transport_result),
    }


def _breakdown(budget: dict, live_fares: bool = False) -> list[dict]:
    if not budget:
        return []
    travelers = budget.get("travelers_used") or 1
    days = budget.get("days_used") or 1
    rates = budget.get("daily_rates") or {}
    intercity = budget.get("intercity") or {}
    selected = budget.get("selected_items") or []
    package = next((p for p in budget.get("packages") or [] if p["name"] == budget.get("recommended_package")), {})
    hotel_names = ", ".join(h["name"] for h in package.get("hotels") or []) or "recommended hotel"
    transport = budget.get("transport") or {}
    if transport.get("kind") == "flight":
        travel_detail = f"{transport.get('label')}, {travelers} traveler(s), " + ("live round-trip fare" if live_fares else "estimated fares")
    elif transport:
        travel_detail = f"{transport.get('label')}, both ways, {travelers} traveler(s), estimated fare"
    else:
        travel_detail = "not included (no option found)"
    food_level = {"budget": 0.8, "balanced": 1.0, "premium": 1.8}.get(package.get("name"), 1.0) * float(rates.get("food") or 0)
    local_detail = (
        "every cab ride in the timetable, incl. airport/station transfers"
        if budget.get("local_from_timetable")
        else f"cabs/metro, about {{money:{float(rates.get('local') or 0):.2f}}} per person per day"
    )
    rows = [
        {"category": "Getting there & back", "cost": round(float(budget.get("baseline_flight_cost") or 0), 2), "detail": travel_detail},
        {"category": "Accommodation", "cost": round(float(budget.get("baseline_hotel_cost") or 0), 2),
         "detail": f"{hotel_names}; {budget.get('nights_used')} night(s), {budget.get('rooms_used')} room(s)"},
        {"category": "Food", "cost": round(float(budget.get("food_cost") or 0), 2),
         "detail": f"about {{money:{food_level:.2f}}} per person per day x {days} day(s), {package.get('label', '')} level"},
        {"category": "Local transport", "cost": round(float(budget.get("local_cost") or 0), 2), "detail": local_detail},
        {"category": "Paid activities", "cost": round(float(budget.get("total_cost") or 0), 2),
         "detail": f"{budget.get('paid_count', sum(1 for item in selected if (item.get('cost') or 0) > 0))} "
                   "ticketed place(s) in the timetable, estimated entry fees"},
    ]
    if float(intercity.get("total") or 0) > 0:
        rows.insert(1, {"category": "Travel between cities", "cost": round(float(intercity["total"]), 2),
                        "detail": intercity.get("detail"), "legs": intercity.get("legs") or []})
    return rows


def _packing_tips(weather_days: list[dict], days: list[dict]) -> list[str]:
    tips = []
    highs = [row.get("temp_max_c") for row in weather_days if isinstance(row.get("temp_max_c"), (int, float))]
    lows = [row.get("temp_min_c") for row in weather_days if isinstance(row.get("temp_min_c"), (int, float))]
    if highs and max(highs) >= 32:
        tips.append("Hot weather: light, breathable clothes, sunscreen, sunglasses and a refillable water bottle. "
                    "Outdoor sights are scheduled for mornings or evenings where possible.")
    if lows and min(lows) <= 12:
        tips.append("Cool evenings: pack a warm layer.")
    if any((row.get("precipitation_probability") or 0) >= 50 for row in weather_days):
        tips.append("Rain is likely on some days: bring a compact umbrella or rain jacket.")
    categories = {a.get("category") for day in days for a in day.get("activities") or []}
    if categories & {"culture", "history"}:
        tips.append("Carry a light cover-up (shoulders and knees) for religious and heritage sites.")
    if "beach" in categories:
        tips.append("Swimwear, sandals and a beach towel.")
    tips.append("Comfortable walking shoes, a phone power bank, and copies of your passport and bookings.")
    return tips


def _links(request: dict, flight: dict, budget: dict, days: list[dict]) -> dict:
    start, end = request.get("start_date"), request.get("end_date")
    currency = budget.get("display_currency") or "USD"
    links: dict = {}
    outbound = (flight.get("options") or [None])[0]
    if outbound:
        query = f"Flights from {outbound.get('origin')} to {outbound.get('destination')}"
        if start:
            query += f" on {start}" + (f" returning {end}" if end else "")
        links["flights"] = "https://www.google.com/travel/flights?q=" + quote(query) + f"&curr={currency}"
    transport = budget.get("transport") or {}
    if transport.get("booking_link"):
        links["ground"] = {"label": transport.get("label"), "url": transport["booking_link"]}
    package = next((p for p in budget.get("packages") or [] if p["name"] == budget.get("recommended_package")), {})
    hotel_links = []
    checkin = start
    for stay in package.get("hotels") or []:
        params = {"ss": f"{stay['name']}, {stay.get('city') or ''}".strip(", "),
                  "group_adults": budget.get("travelers_used") or 1, "no_rooms": budget.get("rooms_used") or 1,
                  "selected_currency": currency}
        if checkin:
            checkout = (date.fromisoformat(checkin) + timedelta(days=int(stay.get("nights") or 1))).isoformat()
            params.update({"checkin": checkin, "checkout": checkout})
            checkin = checkout
        hotel_links.append({"name": stay["name"], "url": "https://www.booking.com/searchresults.html?" + urlencode(params)})
    links["hotels"] = hotel_links
    places = []
    for day in days:
        for activity in day.get("activities") or []:
            if activity.get("category") in {"travel", "stay", "transfer", "meal"}:
                continue
            name = str(activity.get("name") or "").removeprefix("Dinner at ")
            target = f"{name}, {day.get('city') or ''}".strip(", ")
            places.append({"day": day.get("day"), "name": name,
                           "url": "https://www.google.com/maps/search/?api=1&query=" + quote(target)})
    links["places"] = places
    return links


def _data_notes(flight: dict, hotel: dict, transport: dict) -> list[str]:
    notes = []
    if flight.get("provider_used") == "serpapi_google_flights":
        dates = flight.get("search_dates") or {}
        notes.append(f"Flight fares are live Google Flights prices for {dates.get('depart')} to {dates.get('return')} "
                     "(round trip, per person, via SerpApi). Fares change quickly; confirm before booking.")
    providers = str(hotel.get("provider_used") or "")
    if "serpapi_google_hotels" in providers:
        notes.append("Hotel rates are live Google Hotels prices for your dates (via SerpApi), per room per night.")
    elif hotel.get("data_source") == "llm":
        notes.append("Hotels were suggested by the AI and checked on Geoapify maps; nightly rates are estimates.")
    elif hotel.get("data_source") == "live":
        notes.append("Hotels are Geoapify map records without nightly rates.")
    if any(option.get("kind") in {"train", "bus", "cab"} for option in transport.get("options") or []):
        notes.append("Train, bus and cab fares are estimates from road distance (OSRM); there is no free live fare API "
                     "for them. Check the booking link for exact fares and timings.")
    notes.append("Prices are converted from USD at today's exchange rate and are planning estimates. "
                 "Confirm on the booking links before paying.")
    return notes


def _clean_warnings(warnings: list[str]) -> list[str]:
    """Drop duplicates and data-source notes that are already shown elsewhere."""
    seen, cleaned = set(), []
    for warning in warnings:
        if warning in seen or warning.startswith("Flight times come from current Aviationstack"):
            continue
        seen.add(warning)
        cleaned.append(warning)
    return cleaned


def _pricing(request: dict, budget: dict) -> dict:
    place = lookup_place((request.get("cities") or [None])[0]) or lookup_place(request.get("destination"))
    country = place.country if place else None
    return {
        "travelers": budget.get("travelers_used") or int(request.get("travelers") or 1),
        "rooms": budget.get("rooms_used") or 1,
        "nights": budget.get("nights_used"),
        "intercity_cost": round(float(budget.get("intercity_cost") or 0), 2),
        "country": country,
        "local_rates": local_rates(country),
        "airport_km": AIRPORT_KM,
        "station_km": STATION_KM,
    }
