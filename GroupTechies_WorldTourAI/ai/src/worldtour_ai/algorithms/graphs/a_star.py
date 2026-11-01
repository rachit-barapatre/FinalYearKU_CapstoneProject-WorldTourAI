"""A* search. The heuristic is supplied by the caller; geography uses Haversine."""

from __future__ import annotations

import heapq
from collections.abc import Callable

from worldtour_ai.algorithms.graphs.dijkstra import _reconstruct
from worldtour_ai.algorithms.graphs.geo import haversine_km
from worldtour_ai.algorithms.graphs.graph import Graph


def haversine_heuristic(graph: Graph, target: str) -> Callable[[str], float]:
    """Admissible heuristic when edge weights are road kilometres."""
    target_lat, target_lon = graph.coords(target)

    def heuristic(node_id: str) -> float:
        lat, lon = graph.coords(node_id)
        if lat is None or lon is None or target_lat is None or target_lon is None:
            return 0.0
        return haversine_km(lat, lon, target_lat, target_lon)

    return heuristic


def a_star(
    graph: Graph,
    source: str,
    target: str,
    heuristic: Callable[[str], float] | None = None,
) -> dict:
    """A* shortest path with reconstruction. A zero heuristic reduces to Dijkstra."""
    if source not in graph.nodes:
        raise ValueError(f"Unknown source node: {source}")
    if target not in graph.nodes:
        raise ValueError(f"Unknown target node: {target}")
    estimate = heuristic or (lambda _node: 0.0)
    opening = estimate(source)
    if opening < 0:
        raise ValueError("Heuristic must be non-negative")

    open_heap: list[tuple[float, float, str]] = [(opening, 0.0, source)]
    g_score: dict[str, float] = {source: 0.0}
    previous: dict[str, str | None] = {source: None}
    closed: set[str] = set()

    while open_heap:
        _f_score, g_value, node = heapq.heappop(open_heap)
        if node in closed:
            continue
        closed.add(node)
        if node == target:
            break
        for neighbor, weight in graph.neighbors(node):
            if weight < 0:
                raise ValueError("A* does not support negative weights")
            tentative = g_score[node] + weight
            if tentative < g_score.get(neighbor, float("inf")):
                h_value = estimate(neighbor)
                if h_value < 0:
                    raise ValueError("Heuristic must be non-negative")
                g_score[neighbor] = tentative
                previous[neighbor] = node
                heapq.heappush(open_heap, (tentative + h_value, tentative, neighbor))

    path: list[str] = []
    total: float | None = None
    if target in g_score:
        path = _reconstruct(previous, target)
        total = g_score[target]
    return {
        "path": path,
        "total_cost": total,
        "algorithm": "A*",
        "expanded_count": len(closed),
    }
