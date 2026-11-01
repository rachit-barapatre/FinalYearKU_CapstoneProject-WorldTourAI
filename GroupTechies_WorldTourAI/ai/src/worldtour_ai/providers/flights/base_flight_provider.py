"""Flight provider interface. Implementations return planning data, not bookings."""

from __future__ import annotations


class BaseFlightProvider:
    name = "base_flight_provider"
    data_source = "unknown"

    def search_flights(self, origin_iata: str, destination_iata: str, travel_date: str | None = None) -> dict:
        raise NotImplementedError
