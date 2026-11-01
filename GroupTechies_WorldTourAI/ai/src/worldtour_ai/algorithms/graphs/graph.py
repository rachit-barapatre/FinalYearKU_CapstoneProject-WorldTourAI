"""Weighted graph with optional coordinates. Built with dict, list, and set."""

from __future__ import annotations


class Graph:
    def __init__(self) -> None:
        self.nodes: dict[str, dict] = {}
        self._adj: dict[str, list[tuple[str, float, dict]]] = {}

    def add_node(self, node_id: str, lat: float | None = None, lon: float | None = None, **meta: object) -> None:
        if not node_id:
            raise ValueError("node_id is required")
        self.nodes[node_id] = {"lat": lat, "lon": lon, **meta}
        self._adj.setdefault(node_id, [])

    def add_edge(self, source: str, target: str, weight: float, bidirectional: bool = True, **meta: object) -> None:
        if source not in self.nodes or target not in self.nodes:
            raise ValueError("Both edge endpoints must exist")
        if weight < 0:
            raise ValueError("Edge weight must be non-negative")
        self._adj[source].append((target, float(weight), dict(meta)))
        if bidirectional and source != target:
            self._adj[target].append((source, float(weight), dict(meta)))

    def neighbors(self, node_id: str) -> list[tuple[str, float]]:
        if node_id not in self.nodes:
            raise ValueError(f"Unknown node: {node_id}")
        return [(target, weight) for target, weight, _meta in self._adj.get(node_id, [])]

    def coords(self, node_id: str) -> tuple[float | None, float | None]:
        node = self.nodes[node_id]
        return node.get("lat"), node.get("lon")

    def node_ids(self) -> list[str]:
        return list(self.nodes)
