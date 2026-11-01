"""0/1 Knapsack solved with dynamic programming."""

from __future__ import annotations

import math


def knapsack_01(items: list[dict], capacity: int) -> dict:
    """Maximize total value without exceeding an integer capacity.

    Each item may be chosen at most once. Values are treated as integers.
    Very large capacities are scaled and the result is marked inexact.
    """
    if capacity < 0:
        raise ValueError("capacity must be non-negative")
    if items is None:
        raise ValueError("items are required")

    normalized: list[dict] = []
    for item in items:
        cost = item.get("cost")
        value = item.get("value")
        if not isinstance(cost, (int, float)) or not isinstance(value, (int, float)):
            raise ValueError("each item needs numeric cost and value")
        if cost < 0 or value < 0:
            raise ValueError("cost and value must be non-negative")
        normalized.append({**item, "cost": int(cost), "value": int(value)})

    scale = 1
    working_capacity = capacity
    if working_capacity > 20000:
        scale = math.ceil(working_capacity / 20000)
        working_capacity = working_capacity // scale

    free = [item for item in normalized if item["cost"] == 0]
    paid = []
    for item in normalized:
        if item["cost"] == 0:
            continue
        scaled_cost = max(1, item["cost"] // scale) if scale > 1 else item["cost"]
        paid.append({**item, "scaled_cost": scaled_cost})

    count = len(paid)
    table = [0] * (working_capacity + 1)
    keep = [[False] * (working_capacity + 1) for _ in range(count)]

    for index, item in enumerate(paid):
        cost = item["scaled_cost"]
        value = item["value"]
        for weight in range(working_capacity, cost - 1, -1):
            candidate = table[weight - cost] + value
            if candidate > table[weight]:
                table[weight] = candidate
                keep[index][weight] = True

    weight = working_capacity
    chosen_paid: list[dict] = []
    for index in range(count - 1, -1, -1):
        if keep[index][weight]:
            chosen_paid.append(paid[index])
            weight -= paid[index]["scaled_cost"]
    chosen_paid.reverse()

    selected = free + chosen_paid
    selected_ids = [item.get("id") for item in selected]
    total_cost = sum(item["cost"] for item in selected)
    total_value = sum(item["value"] for item in selected)
    return {
        "selected_ids": selected_ids,
        "selected_items": selected,
        "total_cost": total_cost,
        "total_value": total_value,
        "capacity": capacity,
        "exact": scale == 1,
        "scale": scale,
        "algorithm": "0/1 Knapsack",
    }
