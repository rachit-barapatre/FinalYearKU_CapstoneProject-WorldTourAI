"""Tool layer between agents and providers/algorithms."""

from __future__ import annotations

import json

from langchain_core.tools import StructuredTool

from worldtour_ai.algorithms.dynamic_programming.knapsack import knapsack_01
from worldtour_ai.algorithms.graphs.a_star import a_star, haversine_heuristic
from worldtour_ai.algorithms.graphs.dijkstra import dijkstra
from worldtour_ai.algorithms.graphs.graph import Graph
from worldtour_ai.algorithms.greedy.interval_scheduling import schedule_intervals
from worldtour_ai.algorithms.heaps.top_k import priority_queue_rank, top_k
from worldtour_ai.algorithms.sorting.ranking import sort_by_key
from worldtour_ai.algorithms.traversal.bfs_dfs import bfs, dfs
from worldtour_ai.providers.factory import (
    CurrencyGateway,
    FlightGateway,
    HotelGateway,
    PlacesGateway,
    RoutingGateway,
    WeatherGateway,
)
from worldtour_ai.services.scoring_service import weighted_score


def _fill_missing_fares(options: list[dict], origin_iata: str | None, destination_iata: str | None) -> None:
    """Aviationstack often has no fare. Fill a labeled estimate so ranking and the budget can use it."""
    from worldtour_ai.algorithms.graphs.geo import haversine_km
    from worldtour_ai.data.places import PLACES

    def by_iata(code: str | None):
        for place in PLACES:
            if place.iata and code and place.iata.upper() == code.upper():
                return place
        return None

    origin = by_iata(origin_iata)
    dest = by_iata(destination_iata)
    distance = 800.0
    if origin and dest and origin.lat is not None and dest.lat is not None:
        distance = haversine_km(origin.lat, origin.lon, dest.lat, dest.lon)
    domestic = bool(origin and dest and origin.country and origin.country == dest.country)
    base = max(55.0, distance * (0.055 if domestic else 0.07))
    for option in options:
        if option.get("duration_minutes") in (None, 0):
            stops = option.get("stops") or 0
            option["duration_minutes"] = int(distance / 12) + stops * 70 + 35
        if option.get("price") is None and not option.get("price_included"):
            stops = option.get("stops") or 0
            # Same route, same estimate: only stops change it. No invented spread between flights.
            factor = 0.82 if stops else 1.0
            option["price"] = round(base * factor, 2)
            option["currency"] = option.get("currency") or "USD"
            option["price_is_estimate"] = True
            option["note"] = "Schedule is from the flight provider. The fare is a planning estimate, not a live ticket price."


def _unique_flights(options: list[dict]) -> list[dict]:
    """Aviationstack returns one record per operating day; keep one per flight number."""
    unique, seen = [], set()
    for option in options:
        key = (option.get("airline"), option.get("flight_number"), option.get("via"))
        if key in seen:
            continue
        seen.add(key)
        unique.append(option)
    return unique


def _dump(payload: dict) -> str:
    return json.dumps(payload)


def _load(payload_json: str) -> dict:
    return json.loads(payload_json)


def _flight(payload_json: str) -> str:
    data = _load(payload_json)
    result = FlightGateway().search_flights(
        data.get("origin_iata"), data.get("destination_iata"), data.get("travel_date"), return_date=data.get("return_date")
    )
    options = _unique_flights(result.get("options") or [])
    _fill_missing_fares(options, data.get("origin_iata"), data.get("destination_iata"))
    returns = _unique_flights(result.get("return_options") or [])
    _fill_missing_fares(returns, data.get("destination_iata"), data.get("origin_iata"))

    def score(option: dict) -> float:
        price = option.get("price") or 400
        duration = option.get("duration_minutes") or 300
        stops = option.get("stops") or 0
        return weighted_score(
            {
                "cost": max(0.0, 1 - price / 1500),
                "duration": max(0.0, 1 - duration / 1200),
                "convenience": max(0.0, 1 - stops / 3),
            }
        )

    ranked_queue = priority_queue_rank(options, score)
    for option in ranked_queue + returns:
        option["score"] = score(option)
    pinned = result.get("pinned_outbound")
    if pinned:
        # Return flights were fetched for this outbound, so it stays the recommended one.
        ranked_queue.sort(key=lambda option: option.get("option_id") != pinned)
    result["options"] = ranked_queue
    if "return_options" in result:
        result["return_options"] = sort_by_key(returns, score)
    result["algorithms_executed"] = ["Priority Queue", "Sorting"] if options else []
    return _dump(result)


def _hotel(payload_json: str) -> str:
    data = _load(payload_json)
    result = HotelGateway().search_hotels(
        data.get("city") or "",
        data.get("lat"),
        data.get("lon"),
        int(data.get("nights") or 1),
        data.get("preferences") or [],
        travelers=data.get("travelers"),
        trip_type=data.get("trip_type"),
        budget=data.get("budget"),
        currency=data.get("currency"),
        start_date=data.get("start_date"),
        check_in=data.get("check_in"),
        adults_per_room=data.get("adults_per_room"),
        hotel_preferences=data.get("hotel_preferences") or [],
        rooms=data.get("rooms"),
        nightly_target=data.get("nightly_target"),
    )
    options = result.get("options") or []
    prefer_center = "near city center" in (data.get("hotel_preferences") or [])

    def score(option: dict) -> float:
        price = option.get("price_per_night") or 120
        rating = (option.get("rating") or 3.5) / 5
        distance = option.get("distance_to_center_km") or 2
        return weighted_score(
            {
                "cost": max(0.0, 1 - price / 300),
                "rating": rating,
                "distance": max(0.0, 1 - distance / 5),
                "convenience": 1.0 if prefer_center and distance <= 1.2 else 0.4,
            }
        )

    # Top-K inside each price band (cheap, mid, upper) so Budget, Balanced and Premium all have real choices.
    by_price = sorted(options, key=lambda option: option.get("price_per_night") or 0)
    band = -(-len(by_price) // 3) if len(by_price) >= 6 else len(by_price)
    best = []
    for start in range(0, len(by_price), band or 1):
        members = by_price[start : start + band]
        best.extend(top_k(members, k=min(3 if band < len(by_price) else 6, len(members)), key=score))
    best = sort_by_key(best, score)
    ordered = sort_by_key(options, score)
    for option in best:
        option["score"] = score(option)
    result["options"] = best or ordered[:3]
    result["algorithms_executed"] = ["Heap", "Top-K", "Sorting"] if options else []
    return _dump(result)


def _weather(payload_json: str) -> str:
    data = _load(payload_json)
    result = WeatherGateway().forecast(data["location"], data["lat"], data["lon"], data.get("days") or [])
    result["algorithms_executed"] = ["Constraint Checking"]
    return _dump(result)


def _places(payload_json: str) -> str:
    data = _load(payload_json)
    result = PlacesGateway().search_places(data.get("city") or "", data.get("lat"), data.get("lon"), data.get("preferences") or [])
    places = result.get("places") or []
    graph: dict[str, list[str]] = {"city_center": []}
    categories: dict[str, list[str]] = {}
    for place in places:
        graph[place["place_id"]] = []
        categories.setdefault(place.get("category") or "sights", []).append(place["place_id"])
    for category, members in categories.items():
        node = f"category:{category}"
        graph[node] = members
        graph["city_center"].append(node)
    breadth = bfs(graph, "city_center") if graph else []
    depth = dfs(graph, "city_center") if graph else []
    discovered = [place for place in places if place["place_id"] in set(breadth) | set(depth)]

    prefs = set(data.get("preferences") or [])
    if "culture" in prefs:
        prefs |= {"history", "sightseeing"}
    if "history" in prefs:
        prefs |= {"sightseeing"}

    def score(place: dict) -> float:
        match = 1.0 if place.get("category") in prefs or not prefs else 0.35
        return weighted_score({"rating": (place.get("rating") or 4) / 5, "preference_match": match})

    pool = discovered or places
    limit = int(data.get("limit") or 12)
    by_category: dict[str, list[dict]] = {}
    for place in pool:
        by_category.setdefault(place.get("category") or "sights", []).append(place)
    share = max(2, -(-limit // max(len(by_category), 1)))
    picked: list[dict] = []
    for members in by_category.values():
        picked.extend(top_k(members, k=min(share, len(members)), key=score))
    ranked = sort_by_key(picked, score)[:limit]
    for place in ranked:
        place["score"] = score(place)
    result["places"] = ranked
    result["bfs_order"] = breadth
    result["dfs_order"] = depth
    result["algorithms_executed"] = ["BFS", "DFS", "Heap", "Top-K", "Sorting"] if places else []
    return _dump(result)


def _intercity_costs(payload_json: str) -> str:
    from worldtour_ai.services.cost_estimator import estimate_intercity_costs

    data = _load(payload_json)
    return _dump(
        estimate_intercity_costs(
            data.get("destination"),
            data.get("cities") or [],
            data.get("travelers") or 1,
            data.get("city_legs") or [],
        )
    )


def _knapsack(payload_json: str) -> str:
    data = _load(payload_json)
    solved = knapsack_01(data.get("items") or [], int(data.get("capacity") or 0))
    solved["algorithms_executed"] = ["0/1 Knapsack", "Dynamic Programming"]
    return _dump(solved)


def _route(payload_json: str) -> str:
    data = _load(payload_json)
    places = [place for place in data.get("places") or [] if place.get("lat") is not None]
    if len(places) < 2:
        return _dump(
            {
                "provider_used": "none",
                "data_source": "none",
                "algorithms_executed": [],
                "note": "Not enough located places to build a route graph.",
                "dijkstra": None,
                "a_star": None,
            }
        )
    gateway = RoutingGateway()
    table = gateway.table(places)
    graph = Graph()
    for place in places:
        graph.add_node(place["id"], lat=place["lat"], lon=place["lon"], name=place.get("name"))
    distances = table.get("distances_m") or []
    for i, source in enumerate(places):
        row = distances[i] if i < len(distances) else []
        nearest = sorted(
            ((j, meters) for j, meters in enumerate(row) if j != i and meters is not None),
            key=lambda item: item[1],
        )[:4]
        for j, meters in nearest:
            if meters is None:
                continue
            graph.add_edge(source["id"], places[j]["id"], max(float(meters) / 1000, 0.01))
    city_nodes = [node for node in data.get("city_sequence") or [] if any(p["id"] == node for p in places)]
    if city_nodes:
        index = {place["id"]: i for i, place in enumerate(places)}

        def _km(i: int, j: int) -> float | None:
            row = distances[i] if i < len(distances) else []
            meters = row[j] if j < len(row) else None
            return None if meters is None else max(float(meters) / 1000, 0.01)

        for left, right in zip(city_nodes, city_nodes[1:]):
            weight = _km(index[left], index[right])
            if weight is not None:
                graph.add_edge(left, right, weight)
        for i, place in enumerate(places):
            if place["id"] in city_nodes:
                continue
            options = [(w, node) for node in city_nodes if (w := _km(i, index[node])) is not None]
            if options:
                weight, node = min(options)
                graph.add_edge(place["id"], node, weight)
    source_id = places[0]["id"]
    target = max(places[1:], key=lambda place: _safe_distance(distances, places, source_id, place["id"]))
    target_id = target["id"]
    dijkstra_result = dijkstra(graph, source_id, target_id)
    astar_result = a_star(graph, source_id, target_id, haversine_heuristic(graph, target_id))
    names = {place["id"]: place.get("name") or place["id"] for place in places}
    index_of = {place["id"]: i for i, place in enumerate(places)}
    durations = table.get("durations_s") or []
    city_legs = []
    sequence = [node for node in data.get("city_sequence") or [] if node in index_of]
    for left, right in zip(sequence, sequence[1:]):
        i, j = index_of[left], index_of[right]
        meters = distances[i][j] if i < len(distances) and j < len(distances[i]) else None
        seconds = durations[i][j] if i < len(durations) and j < len(durations[i]) else None
        if meters is None:
            a, b = places[i], places[j]
            from worldtour_ai.algorithms.graphs.geo import haversine_km

            km = haversine_km(a["lat"], a["lon"], b["lat"], b["lon"]) * 1.3
        else:
            km = float(meters) / 1000
        city_legs.append(
            {
                "from": names_lookup(places, left),
                "to": names_lookup(places, right),
                "distance_km": round(km, 1),
                "duration_minutes": None if seconds is None else round(float(seconds) / 60),
            }
        )
    provider_reference = None
    if data.get("include_trip") and len(places) >= 3:
        try:
            provider_reference = gateway.trip(places[:5])
        except Exception as exc:
            provider_reference = {"error": str(exc)}
    return _dump(
        {
            "provider_used": table.get("provider_used"),
            "data_source": table.get("data_source"),
            "algorithms_executed": ["Dijkstra", "A*"],
            "dijkstra": {
                "path": [names.get(node, node) for node in dijkstra_result["path"]],
                "total_cost_km": dijkstra_result["total_cost"],
            },
            "a_star": {
                "path": [names.get(node, node) for node in astar_result["path"]],
                "total_cost_km": astar_result["total_cost"],
            },
            "provider_reference": provider_reference,
            "city_legs": city_legs,
            "note": "External routing supplied edge weights. Dijkstra and A* ran inside WorldTour.",
        }
    )


def names_lookup(places: list[dict], node_id: str) -> str:
    for place in places:
        if place["id"] == node_id:
            return place.get("name") or node_id
    return node_id


def _safe_distance(distances, places, source_id, target_id) -> float:
    index = {place["id"]: i for i, place in enumerate(places)}
    try:
        return float(distances[index[source_id]][index[target_id]] or 0)
    except (KeyError, IndexError, TypeError):
        return 0.0


def _schedule(payload_json: str) -> str:
    data = _load(payload_json)
    selected = schedule_intervals(data.get("intervals") or [], unique_key="activity_id")
    selected["algorithms_executed"] = ["Greedy", "Interval Scheduling"]
    return _dump(selected)


def _ground(payload_json: str) -> str:
    """Train, bus and cab options between two places, ranked with a priority queue on cost and time."""
    from worldtour_ai.config.settings import get_settings
    from worldtour_ai.data.places import lookup_place
    from worldtour_ai.providers.routing.osrm_provider import OSRMProvider
    from worldtour_ai.services.transport import ground_options, road_needed
    from worldtour_ai.utils.exceptions import EmptyResultError

    data = _load(payload_json)
    origin, destination = lookup_place(data.get("origin")), lookup_place(data.get("destination"))
    result = {"options": [], "road_km": None, "road_minutes": None, "data_source": "estimate", "algorithms_executed": []}
    if not origin or not destination or not road_needed(origin, destination):
        result["note"] = "No road or rail connection for this trip."
        return _dump(result)
    road_km = road_minutes = None
    settings = get_settings()
    if settings.routing_provider == "osrm" and not settings.disable_network:
        try:
            route = OSRMProvider().route(
                [{"lat": origin.lat, "lon": origin.lon}, {"lat": destination.lat, "lon": destination.lon}]
            )
            road_km, road_minutes = route["distance_km"], route["duration_minutes"]
            result["data_source"] = "osrm_route+fare_estimates"
        except EmptyResultError:
            result["note"] = "OSRM found no road between these places."
            return _dump(result)
        except Exception as exc:
            if "noroute" in str(exc).lower().replace(" ", ""):
                result["note"] = "OSRM found no road between these places."
                return _dump(result)
            result["note"] = f"Road distance estimated from a straight line ({exc})."
    options = ground_options(origin, destination, int(data.get("travelers") or 1), road_km, road_minutes)

    def score(option: dict) -> float:
        return weighted_score(
            {
                "cost": max(0.0, 1 - option["price_pp"] / 150),
                "duration": max(0.0, 1 - option["duration_minutes"] / (24 * 60)),
            }
        )

    ranked = priority_queue_rank(options, score)
    for option in ranked:
        option["score"] = score(option)
    result.update({"options": ranked, "road_km": road_km, "road_minutes": road_minutes,
                   "algorithms_executed": ["Priority Queue"] if ranked else []})
    return _dump(result)


def _currency(payload_json: str) -> str:
    data = _load(payload_json)
    return _dump(CurrencyGateway().convert(float(data["amount"]), data["source"], data["target"]))


flight_search_tool = StructuredTool.from_function(
    func=_flight, name="flight_search_tool", description="Search flight data and rank it with a priority queue."
)
hotel_search_tool = StructuredTool.from_function(
    func=_hotel, name="hotel_search_tool", description="Search hotels and select Top-K with a heap."
)
weather_tool = StructuredTool.from_function(
    func=_weather, name="weather_tool", description="Retrieve a weather forecast for constraint checking."
)
places_tool = StructuredTool.from_function(
    func=_places, name="places_tool", description="Find places and explore them with BFS, DFS, and Top-K."
)
intercity_cost_tool = StructuredTool.from_function(
    func=_intercity_costs,
    name="intercity_cost_tool",
    description="Price the city-to-city legs measured by the Route Agent.",
)
knapsack_tool = StructuredTool.from_function(
    func=_knapsack, name="knapsack_tool", description="Solve 0/1 knapsack for budget selection."
)
route_optimization_tool = StructuredTool.from_function(
    func=_route, name="route_optimization_tool", description="Build a WorldTour graph and run Dijkstra and A*."
)
schedule_tool = StructuredTool.from_function(
    func=_schedule, name="schedule_tool", description="Schedule activities with greedy interval scheduling."
)
ground_transport_tool = StructuredTool.from_function(
    func=_ground, name="ground_transport_tool", description="Price train, bus and cab options between two cities."
)
currency_tool = StructuredTool.from_function(
    func=_currency, name="currency_tool", description="Convert currency using Frankfurter or a labeled fallback."
)
