"""Builds Budget / Balanced / Premium packages and selects paid activities with a real 0/1 knapsack."""

from __future__ import annotations

import math

from worldtour_ai.agents.base_agent import BaseAgent
from worldtour_ai.data.cost_levels import DAILY_ESTIMATE, DEFAULT_DAILY
from worldtour_ai.data.places import lookup_place
from worldtour_ai.services.transport import FLIGHT_OVERHEAD_MIN
from worldtour_ai.tools.toolkit import currency_tool, intercity_cost_tool, knapsack_tool
from worldtour_ai.utils.money import display_currency, format_money

COST_KEYS = ("transport_cost", "intercity_cost", "hotel_cost", "food_cost", "local_cost")
MAX_HOTEL_KM = 25  # packages prefer hotels within this distance of the city centre

# Daily food and local-transport multipliers per package (planning estimates).
PACKAGES = {
    "budget": {"label": "Budget", "food": 0.8, "local": 0.8},
    "balanced": {"label": "Balanced", "food": 1.0, "local": 1.0},
    "premium": {"label": "Premium", "food": 1.8, "local": 1.6},
}
_COMFORT_ORDER = ["premium", "balanced", "budget"]


class BudgetAgent(BaseAgent):
    agent_id = "BUDGET_AGENT"
    agent_name = "Budget Agent"
    responsibilities = [
        "Price flights, travel between cities, food and local transport",
        "Build Budget, Balanced and Premium packages from the hotel options",
        "Recommend the most comfortable package the budget allows",
        "Choose paid activities inside the remaining budget",
    ]
    algorithms = ["0/1 Knapsack", "Dynamic Programming"]
    tools = ["intercity_cost_tool", "knapsack_tool", "currency_tool"]
    provider = "Frankfurter for currency conversion"
    llm_role = "Does not solve the knapsack or choose the package."

    def execute(self, state: dict) -> dict:
        request = state.get("parsed_request") or {}
        events = [self.started("Building packages and running 0/1 Knapsack")]
        currency = request.get("currency") or "USD"
        travelers = int(request.get("travelers") or 1)
        rooms = max(1, math.ceil(travelers / 2))
        warnings = []
        if not request.get("travelers"):
            warnings.append("Traveler count was not stated. Costs use 1 traveler and 1 room.")
        user_budget = request.get("budget")
        assumption = not request.get("budget_is_user_stated")
        if user_budget is None:
            user_budget = 2000
            assumption = True
            warnings.append("No budget was stated. Costs are compared with a 2000 USD planning envelope.")
        if request.get("budget_scope") == "per_person":
            user_budget = float(user_budget) * travelers
        if currency != "USD":
            try:
                converted = self.invoke(currency_tool, {"amount": user_budget, "source": currency, "target": "USD"})
                user_budget = converted["amount"]
                if converted.get("data_source") != "live":
                    warnings.append("Currency conversion used approximate fallback rates, not a live quote.")
            except Exception as exc:
                warnings.append(f"Currency conversion failed ({exc}). The stated amount was used as USD.")
        planning_budget = float(user_budget)
        display = display_currency(request)
        usd_to_display = 1.0
        if display != "USD":
            try:
                usd_to_display = float(self.invoke(currency_tool, {"amount": 1.0, "source": "USD", "target": display})["rate"])
            except Exception as exc:
                warnings.append(f"Prices are shown in USD because {display} exchange rates were unavailable ({exc}).")
                display = "USD"

        flight_result = state.get("flight_result") or {}
        candidates = _transport_candidates(flight_result, state.get("transport_result") or {}, travelers)
        prefs = set(request.get("transport_preferences") or [])
        wanted = ({"cab", "bus"} if "road" in prefs else set()) | (prefs & {"train", "bus", "cab", "flight"})
        if wanted and any(c["kind"] in wanted for c in candidates):
            candidates = [c for c in candidates if c["kind"] in wanted]
        if not candidates and ({"FLIGHT_AGENT", "TRANSPORT_AGENT"} & set(state.get("required_agents") or [])):
            warnings.append("No way to get there could be priced, so the cost total does not include travel to the destination.")
        try:
            intercity = self.invoke(
                intercity_cost_tool,
                {
                    "destination": request.get("destination"),
                    "cities": request.get("cities") or [],
                    "travelers": travelers,
                    "city_legs": (state.get("route_result") or {}).get("city_legs") or [],
                },
            )
        except Exception as exc:
            intercity = {"total": 0.0, "legs": [], "detail": "not estimated"}
            warnings.append(f"Travel between cities could not be priced ({exc}).")
        intercity_cost = float(intercity.get("total") or 0)

        days = max(int(request.get("duration_days") or 1), 1)
        nights = int(request.get("duration_nights") or max(days - 1, 1))
        place = lookup_place((request.get("cities") or [None])[0]) or lookup_place(request.get("destination"))
        rates = DAILY_ESTIMATE.get(place.country if place else "", DEFAULT_DAILY)
        hotels = (state.get("hotel_result") or {}).get("options") or []
        city_nights = _nights_per_city(hotels, nights)

        packages = {}
        for key, spec in PACKAGES.items():
            food = rates["food"] * spec["food"] * travelers * days
            local = rates["local"] * spec["local"] * travelers * days
            # A travel hour is worth more on a short, well-funded trip: it is lost holiday time.
            hourly = max(3.0 if (place and place.country == "India") else 12.0, planning_budget / (days * travelers * 12))
            transport = _transport_for_package(key, candidates, travelers, hourly)
            transport_cost = transport["round_trip_total"] if transport else 0.0
            stay_budget = planning_budget - transport_cost - intercity_cost - food - local
            picks, hotel_cost = [], 0.0
            for city, count in city_nights.items():
                share = stay_budget * count / max(nights, 1)
                pick = _hotel_for_package(key, [h for h in hotels if (h.get("city") or "") == city], share, count, rooms)
                if pick:
                    cost = _money(pick, "price_per_night") * count * rooms
                    hotel_cost += cost
                    picks.append({**_hotel_brief(pick), "nights": count, "rooms": rooms, "cost": round(cost, 2)})
            packages[key] = {
                "name": key,
                "label": spec["label"],
                "hotels": picks,
                "transport": transport,
                "transport_cost": round(transport_cost, 2),
                "intercity_cost": round(intercity_cost, 2),
                "hotel_cost": round(hotel_cost, 2),
                "food_cost": round(food, 2),
                "local_cost": round(local, 2),
            }

        recommended = _choose_package(request, packages, planning_budget, assumption)
        chosen = packages[recommended]
        base_total = sum(chosen[k] for k in COST_KEYS)
        remaining = max(0, int(round(planning_budget - base_total)))
        if base_total > planning_budget:
            warnings.append(
                f"Even the {chosen['label']} package costs about "
                f"{format_money(base_total - planning_budget, display, usd_to_display)} more than the budget. "
                "Consider fewer days, a cheaper season, or a higher budget."
            )
        items = [
            {
                "id": place_row.get("place_id"),
                "name": place_row.get("name"),
                "category": place_row.get("category") or "activity",
                "cost": _activity_cost(place_row.get("category"), travelers, place.country if place else None),
                "value": int((place_row.get("score") or 0.5) * 100) + 10,
            }
            for place_row in (state.get("recommendation_result") or {}).get("places") or []
        ]
        try:
            solved = self.invoke(knapsack_tool, {"items": items, "capacity": remaining})
        except Exception as exc:
            events.append(self.failed(str(exc)))
            return {"budget_result": None, "errors": [str(exc)], "agent_execution_history": events}
        chosen_ids = set(solved.get("selected_ids") or [])
        solved["rejected_items"] = [item for item in items if item["cost"] > 0 and item["id"] not in chosen_ids]
        activities = float(solved.get("total_cost") or 0)
        for package in packages.values():
            package["activities_cost"] = round(activities, 2)
            package["total"] = round(sum(package[k] for k in COST_KEYS) + activities, 2)
            package["fits_budget"] = package["total"] <= planning_budget
        solved.update(
            {
                "currency": "USD",
                "display_currency": display,
                "usd_to_display": usd_to_display,
                "transport": chosen["transport"],
                "user_budget": request.get("budget"),
                "planning_budget": round(planning_budget, 2),
                "planning_budget_is_assumption": assumption,
                "packages": [packages[key] for key in ("budget", "balanced", "premium")],
                "recommended_package": recommended,
                "baseline_flight_cost": chosen["transport_cost"],
                "baseline_hotel_cost": chosen["hotel_cost"],
                "food_cost": chosen["food_cost"],
                "local_cost": chosen["local_cost"],
                "daily_rates": rates,
                "intercity": intercity,
                "intercity_cost": intercity_cost,
                "travelers_used": travelers,
                "rooms_used": rooms,
                "days_used": days,
                "nights_used": nights,
                "recommended_hotel_id": chosen["hotels"][0]["option_id"] if chosen["hotels"] else None,
                "recommended_hotel_ids": [hotel["option_id"] for hotel in chosen["hotels"]],
                "recommended_outbound_id": (chosen["transport"] or {}).get("outbound_id"),
                "recommended_return_id": (chosen["transport"] or {}).get("return_id"),
                "remaining_after_baseline": remaining,
            }
        )
        ticketed = sum(1 for item in solved.get("selected_items") or [] if (item.get("cost") or 0) > 0)
        events.append(self.completed(f"Recommended the {chosen['label']} package; {ticketed} ticketed activities fit the budget"))
        return {"budget_result": solved, "warnings": warnings, "agent_execution_history": events}


def _choose_package(request: dict, packages: dict, budget: float, assumption: bool) -> str:
    choice = request.get("package_choice")
    if choice in packages:
        return choice
    if request.get("trip_type") == "budget":
        return "budget"

    def base(key: str) -> float:
        return sum(packages[key][k] for k in COST_KEYS)

    if request.get("trip_type") == "luxury" and base("premium") <= budget:
        return "premium"
    if assumption:
        return "balanced" if base("balanced") <= budget else "budget"
    # Most comfortable package that still leaves about 10% of the budget as a buffer.
    for key in _COMFORT_ORDER:
        if base(key) <= budget * 0.9:
            return key
    return "budget"


def _transport_candidates(flight_result: dict, transport_result: dict, travelers: int) -> list[dict]:
    """Every priced way there and back: the recommended flight pair plus each train, bus and cab option."""
    candidates = []
    outbound = _first(flight_result.get("options"))
    inbound = _first(flight_result.get("return_options"))
    if outbound and isinstance(outbound.get("price"), (int, float)):
        legs = [f"{outbound.get('airline') or 'Flight'} {outbound.get('flight_number') or ''}".strip()]
        if inbound:
            legs.append(f"{inbound.get('airline') or ''} {inbound.get('flight_number') or ''}".strip())
        candidates.append(
            {
                "kind": "flight",
                "label": "Flight (" + " / ".join(legs) + ")",
                "outbound_id": outbound.get("option_id"),
                "return_id": None if inbound is None else inbound.get("option_id"),
                "round_trip_total": round((_money(outbound, "price") + _money(inbound, "price")) * travelers, 2),
                "door_to_door_minutes": int(outbound.get("duration_minutes") or 0) + FLIGHT_OVERHEAD_MIN,
                "duration_minutes": outbound.get("duration_minutes"),
                "price_is_estimate": bool(outbound.get("price_is_estimate")),
                "booking_link": None,
            }
        )
    for option in transport_result.get("options") or []:
        candidates.append(
            {
                "kind": option["kind"],
                "label": option["label"],
                "option_id": option["option_id"],
                "round_trip_total": round(2 * option["price_total_one_way"], 2),
                "door_to_door_minutes": option["door_to_door_minutes"],
                "duration_minutes": option["duration_minutes"],
                "distance_km": option.get("distance_km"),
                "overnight": option.get("overnight"),
                "price_is_estimate": True,
                "booking_link": option.get("booking_link"),
            }
        )
    return candidates


def _transport_for_package(package: str, candidates: list[dict], travelers: int, hourly: float) -> dict | None:
    """Budget: cheapest. Premium: fastest door to door. Balanced: lowest cost once travel time is valued.

    hourly is USD per traveler per hour spent travelling.
    """
    if not candidates:
        return None
    if package == "budget":
        return min(candidates, key=lambda c: (c["round_trip_total"], c["door_to_door_minutes"]))
    if package == "premium":
        return min(candidates, key=lambda c: (c["door_to_door_minutes"], -c["round_trip_total"]))
    return min(candidates, key=lambda c: c["round_trip_total"] + 2 * c["door_to_door_minutes"] / 60 * hourly * travelers)


def _hotel_for_package(package: str, hotels: list[dict], share: float, nights: int, rooms: int) -> dict | None:
    """Budget: cheapest. Balanced: best-rated mid-priced hotel that fits. Premium: best-rated that fits."""
    if not hotels:
        return None
    priced = [h for h in hotels if isinstance(h.get("price_per_night"), (int, float))] or hotels
    verified = [h for h in priced if h.get("verified_on_map") is not False] or priced
    # A hotel far from the centre (e.g. 60 km away in a large region like Goa) leaves no sights within reach.
    central = [h for h in verified if not isinstance(h.get("distance_to_center_km"), (int, float)) or h["distance_to_center_km"] <= MAX_HOTEL_KM]
    verified = central or verified

    def cost(hotel: dict) -> float:
        return _money(hotel, "price_per_night") * max(nights, 1) * rooms

    cheapest = min(verified, key=lambda hotel: _money(hotel, "price_per_night"))
    if package == "budget":
        return cheapest
    affordable = [h for h in verified if cost(h) <= max(share, 0)]
    if not affordable:
        return cheapest
    # Premium means a better class of hotel first (stars or tier), then guest rating — a 4.8-rated hostel is not premium.
    top = max(affordable, key=lambda h: (_class(h), h.get("rating") or 0, _money(h, "price_per_night")))
    if package == "premium":
        return top
    # Balanced sits between the two: the best-rated hotel priced above the cheapest and below the top pick.
    top_price = _money(top, "price_per_night")
    middle = [h for h in affordable if h is not cheapest and h is not top and _money(h, "price_per_night") < top_price]
    if middle:
        return max(middle, key=lambda h: (h.get("rating") or 0, -_money(h, "price_per_night")))
    by_price = sorted((h for h in affordable if _money(h, "price_per_night") <= top_price), key=lambda h: _money(h, "price_per_night"))
    return by_price[len(by_price) // 2] if by_price else cheapest


def _class(hotel: dict) -> int:
    """Hotel class 1-5 from stars, else from the tier label."""
    stars = hotel.get("stars")
    if isinstance(stars, (int, float)) and stars > 0:
        return int(stars)
    return {"budget": 2, "mid": 3, "comfort": 4, "luxury": 5}.get(hotel.get("tier") or "", 3)


def _hotel_brief(hotel: dict) -> dict:
    return {
        "option_id": hotel.get("option_id"),
        "name": hotel.get("name"),
        "city": hotel.get("city"),
        "tier": hotel.get("tier"),
        "rating": hotel.get("rating"),
        "price_per_night": hotel.get("price_per_night"),
    }


def _activity_cost(category: str | None, travelers: int, country: str | None = None) -> int:
    """Typical entry fee per person in USD, scaled to the local price level."""
    # Food places are meals, already in the food budget, so they carry no ticket price here.
    per_person = {"history": 20, "culture": 15, "food": 0, "adventure": 30, "shopping": 0, "entertainment": 35}
    level = {"India": 0.3, "Nepal": 0.3, "Sri Lanka": 0.4, "Indonesia": 0.4, "Thailand": 0.5, "Malaysia": 0.5, "Turkey": 0.6}
    return round(per_person.get(category or "", 0) * level.get(country or "", 1.0) * max(travelers, 1))


def _nights_per_city(hotels: list[dict], nights: int) -> dict[str, int]:
    cities = list(dict.fromkeys(h.get("city") or "" for h in hotels))
    if not cities:
        return {}
    nights = max(int(nights), 1)
    base, extra = divmod(nights, len(cities))
    return {city: base + (1 if index < extra else 0) for index, city in enumerate(cities) if base or index < extra}


def _first(options):
    return options[0] if options else None


def _money(option: dict | None, key: str) -> float:
    if not option:
        return 0.0
    value = option.get(key)
    return float(value) if isinstance(value, (int, float)) else 0.0
