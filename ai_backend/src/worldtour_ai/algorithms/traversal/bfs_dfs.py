"""Manual breadth-first and depth-first traversal on an adjacency dict."""

from __future__ import annotations

from collections import deque


def _validate(graph: dict[str, list[str]] | None, start: str | None, empty_ok: bool) -> bool:
    if not graph:
        if start in (None, "") and empty_ok:
            return False
        raise ValueError("start node not in graph")
    if start not in graph:
        raise ValueError("start node not in graph")
    return True


def bfs(graph: dict[str, list[str]] | None, start: str | None = None) -> list[str]:
    if not _validate(graph, start, empty_ok=True):
        return []
    assert graph is not None and start is not None
    seen = {start}
    queue: deque[str] = deque([start])
    order: list[str] = []
    while queue:
        node = queue.popleft()
        order.append(node)
        for neighbor in graph[node]:
            if neighbor not in graph:
                raise ValueError(f"missing node: {neighbor}")
            if neighbor not in seen:
                seen.add(neighbor)
                queue.append(neighbor)
    return order


def dfs(graph: dict[str, list[str]] | None, start: str | None = None) -> list[str]:
    if not _validate(graph, start, empty_ok=True):
        return []
    assert graph is not None and start is not None
    seen: set[str] = set()
    order: list[str] = []
    stack = [start]
    while stack:
        node = stack.pop()
        if node in seen:
            continue
        if node not in graph:
            raise ValueError(f"missing node: {node}")
        seen.add(node)
        order.append(node)
        for neighbor in reversed(graph[node]):
            if neighbor not in seen:
                stack.append(neighbor)
    return order
