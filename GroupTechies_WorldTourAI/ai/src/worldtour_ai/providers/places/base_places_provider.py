"""Places provider interface."""

from __future__ import annotations


class BasePlacesProvider:
    name = "base_places_provider"
    data_source = "unknown"

    def search_places(self, city: str, lat: float | None, lon: float | None, preferences: list[str]) -> dict:
        raise NotImplementedError
