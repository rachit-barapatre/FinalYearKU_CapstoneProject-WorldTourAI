"""Comparison sort used to rank travel options."""

from __future__ import annotations

from collections.abc import Callable


def sort_by_key(items: list, key: Callable, reverse: bool = True) -> list:
    if items is None:
        raise ValueError("items are required")
    return sorted(items, key=key, reverse=reverse)
