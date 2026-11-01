"""Greedy interval scheduling: sort by finish time and take the next compatible interval."""

from __future__ import annotations


def schedule_intervals(intervals: list[dict], unique_key: str | None = None) -> dict:
    """Select a non-overlapping subset by earliest finish time.

    When unique_key is set, at most one interval with each key is kept.
    Intervals whose end is not after start raise ValueError.
    """
    if intervals is None:
        raise ValueError("intervals are required")

    prepared: list[dict] = []
    for interval in intervals:
        try:
            start = int(interval["start"])
            end = int(interval["end"])
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError("each interval needs integer start and end") from exc
        if end < start:
            raise ValueError("interval end cannot be before start")
        if end == start:
            raise ValueError("interval must have positive length")
        prepared.append({**interval, "start": start, "end": end})

    ordered = sorted(prepared, key=lambda item: (item["end"], item["start"]))
    chosen: list[dict] = []
    seen_keys: set[object] = set()
    current_end = None
    for interval in ordered:
        if unique_key is not None:
            identity = interval.get(unique_key)
            if identity in seen_keys:
                continue
        if current_end is not None and interval["start"] < current_end:
            continue
        chosen.append(interval)
        current_end = interval["end"]
        if unique_key is not None:
            seen_keys.add(interval.get(unique_key))

    return {
        "selected": chosen,
        "count": len(chosen),
        "algorithm": "Interval Scheduling",
    }
