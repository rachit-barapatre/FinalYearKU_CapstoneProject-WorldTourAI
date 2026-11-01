"""Dijkstra's shortest path using heapq from the standard library."""

from __future__ import annotations

import heapq

from worldtour_ai.algorithms.graphs.graph import Graph


def _reconstruct(previous: dict[str, str | None], target: str) -> list[str]:
    path: list[str] = []
    cursor: str | None = target
    seen: set[str] = set()
    while cursor is not None:
        if cursor in seen:
            break
        seen.add(cursor)
        path.append(cursor)
        cursor = previous.get(cursor)
    path.reverse()
    return path


def dijkstra(graph: Graph, source: str, target: str | None = None) -> dict:
    """Shortest paths on a non-negative weighted graph, with path reconstruction."""
    if not graph.nodes and source == "":
        return {"distances": {}, "path": [], "total_cost": None, "algorithm": "Dijkstra"}
    if source not in graph.nodes:
        raise ValueError(f"Unknown source node: {source}")
    if target is not None and target not in graph.nodes:
        raise ValueError(f"Unknown target node: {target}")

    distances: dict[str, float] = {source: 0.0}
    previous: dict[str, str | None] = {source: None}
    heap: list[tuple[float, str]] = [(0.0, source)]
    visited: set[str] = set()

    while heap:
        distance, node = heapq.heappop(heap)
        if node in visited:
            continue
        visited.add(node)
        if target is not None and node == target:
            break
        for neighbor, weight in graph.neighbors(node):
            if weight < 0:
                raise ValueError("Dijkstra does not support negative weights")
            candidate = distance + weight
            if candidate < distances.get(neighbor, float("inf")):
                distances[neighbor] = candidate
                previous[neighbor] = node
                heapq.heappush(heap, (candidate, neighbor))

    path: list[str] = []
    total: float | None = None
    if target is not None and target in distances:
        path = _reconstruct(previous, target)
        total = distances[target]
    return {
        "distances": distances,
        "path": path,
        "total_cost": total,
        "algorithm": "Dijkstra",
        "visited_count": len(visited),
    }
