"""Heap-based Top-K selection and priority-queue ranking."""

from __future__ import annotations

import heapq
from collections.abc import Callable


def top_k(items: list, k: int, key: Callable) -> list:
    """Return the k highest-scoring items using a bounded binary heap."""
    if k < 0:
        raise ValueError("k must be non-negative")
    if not items or k == 0:
        return []
    heap: list[tuple] = []
    for index, item in enumerate(items):
        score = key(item)
        entry = (score, index, item)
        if len(heap) < k:
            heapq.heappush(heap, entry)
        elif score > heap[0][0]:
            heapq.heapreplace(heap, entry)
    ranked = sorted(heap, key=lambda entry: (entry[0], entry[1]), reverse=True)
    return [item for _score, _index, item in ranked]


def priority_queue_rank(items: list, key: Callable) -> list:
    """Rank every item by draining a max-oriented priority queue."""
    if not items:
        return []
    heap: list[tuple] = []
    for index, item in enumerate(items):
        heapq.heappush(heap, (-key(item), index, item))
    ranked = []
    while heap:
        ranked.append(heapq.heappop(heap)[2])
    return ranked
