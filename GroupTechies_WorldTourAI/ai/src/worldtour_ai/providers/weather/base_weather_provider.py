"""Weather provider interface."""

from __future__ import annotations


class BaseWeatherProvider:
    name = "base_weather_provider"
    data_source = "unknown"

    def forecast(self, location: str, lat: float, lon: float, days: list[dict]) -> dict:
        raise NotImplementedError
