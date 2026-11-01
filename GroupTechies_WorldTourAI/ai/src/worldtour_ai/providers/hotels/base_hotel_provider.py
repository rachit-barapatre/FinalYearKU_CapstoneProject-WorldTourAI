"""Hotel provider interface."""

from __future__ import annotations


class BaseHotelProvider:
    name = "base_hotel_provider"
    data_source = "unknown"

    def search_hotels(
        self, city: str, lat: float | None, lon: float | None, nights: int, preferences: list[str], **context
    ) -> dict:
        raise NotImplementedError
