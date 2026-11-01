"""Open-Meteo forecast, with seasonal archive data when dates are outside the forecast window."""

from __future__ import annotations

from datetime import date, timedelta

from worldtour_ai.providers.weather.base_weather_provider import BaseWeatherProvider
from worldtour_ai.utils.exceptions import EmptyResultError, ProviderError
from worldtour_ai.utils.http import HttpClient


class OpenMeteoProvider(BaseWeatherProvider):
    name = "open_meteo"
    data_source = "live"

    def __init__(self, http: HttpClient | None = None) -> None:
        self.http = http or HttpClient()

    def forecast(self, location: str, lat: float, lon: float, days: list[dict]) -> dict:
        if lat is None or lon is None:
            raise ProviderError("Weather lookup needs coordinates")
        requested = [day["date"] for day in days if day.get("date")]
        today = date.today()
        horizon = today + timedelta(days=15)
        in_window = [value for value in requested if today <= date.fromisoformat(value) <= horizon]
        outside = [value for value in requested if value not in in_window]
        if requested and not in_window:
            return self._archive(location, lat, lon, requested)
        if in_window and outside:
            # A trip that runs past the forecast horizon: forecast for the near days, typical weather for the rest.
            near = self.forecast(location, lat, lon, [{"date": value} for value in in_window])
            far = self._archive(location, lat, lon, outside)
            rows = sorted(near["days"] + far["days"], key=lambda row: row["date"])
            return {**near, "data_source": "mixed", "days": rows,
                    "summary": "Open-Meteo forecast for the first days, last year's weather for later dates."}
        start = requested[0] if requested else today.isoformat()
        end = requested[-1] if requested else (today + timedelta(days=max(len(days), 1) - 1)).isoformat()
        if date.fromisoformat(start) < today:
            start = today.isoformat()
        payload = self.http.get_json(
            "https://api.open-meteo.com/v1/forecast",
            params={
                "latitude": lat,
                "longitude": lon,
                "daily": "weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
                "timezone": "auto",
                "start_date": start,
                "end_date": end,
            },
            cache_ttl=3 * 3600,
        )
        return {
            "provider_used": self.name,
            "data_source": "live_forecast",
            "location": location,
            "days": _daily_rows(payload),
            "summary": "Open-Meteo forecast for the requested window.",
        }

    def _archive(self, location: str, lat: float, lon: float, requested: list[str]) -> dict:
        shifted = []
        for value in requested:
            current = date.fromisoformat(value)
            day = 28 if (current.month, current.day) == (2, 29) else current.day
            shifted.append(current.replace(year=current.year - 1, day=day).isoformat())
        payload = self.http.get_json(
            "https://archive-api.open-meteo.com/v1/archive",
            params={
                "latitude": lat,
                "longitude": lon,
                "start_date": shifted[0],
                "end_date": shifted[-1],
                "daily": "weathercode,temperature_2m_max,temperature_2m_min,precipitation_sum",
                "timezone": "auto",
            },
            cache_ttl=24 * 3600,
        )
        rows = _daily_rows(payload, precipitation_key="precipitation_sum")
        for row, trip_date in zip(rows, requested):
            row["observed_date"] = row["date"]
            row["date"] = trip_date
            row["source"] = "seasonal_historical"
        return {
            "provider_used": self.name,
            "data_source": "seasonal_historical",
            "location": location,
            "days": rows,
            "summary": "Seasonal historical weather from Open-Meteo archive. Not a live forecast for the travel dates.",
        }

    def geocode(self, name: str) -> dict | None:
        payload = self.http.get_json(
            "https://geocoding-api.open-meteo.com/v1/search",
            params={"name": name, "count": 1},
            cache_ttl=24 * 3600,
        )
        results = payload.get("results") or []
        if not results:
            return None
        row = results[0]
        return {"name": row.get("name"), "lat": row.get("latitude"), "lon": row.get("longitude"), "country": row.get("country")}


def describe_weather_code(code) -> str:
    """WMO weather interpretation codes used by Open-Meteo."""
    if not isinstance(code, (int, float)):
        return "unknown"
    code = int(code)
    if code == 0:
        return "clear"
    if code in (1, 2):
        return "partly cloudy"
    if code == 3:
        return "overcast"
    if code in (45, 48):
        return "fog"
    if 51 <= code <= 57:
        return "drizzle"
    if 61 <= code <= 67 or 80 <= code <= 82:
        return "rain"
    if 71 <= code <= 77 or code in (85, 86):
        return "snow"
    if code >= 95:
        return "thunderstorm"
    return "mixed"


def _daily_rows(payload: dict, precipitation_key: str = "precipitation_probability_max") -> list[dict]:
    daily = payload.get("daily") or {}
    dates = daily.get("time") or []
    if not dates:
        raise EmptyResultError("Open-Meteo returned no daily data")
    rows = []
    codes = daily.get("weathercode") or []
    highs = daily.get("temperature_2m_max") or []
    lows = daily.get("temperature_2m_min") or []
    precip = daily.get(precipitation_key) or []
    for index, day in enumerate(dates):
        probability = precip[index] if index < len(precip) else None
        if precipitation_key == "precipitation_sum" and isinstance(probability, (int, float)):
            probability = min(100, int(probability * 15))
        code = codes[index] if index < len(codes) else None
        rows.append(
            {
                "date": day,
                "condition": describe_weather_code(code),
                "weather_code": code,
                "temp_max_c": highs[index] if index < len(highs) else None,
                "temp_min_c": lows[index] if index < len(lows) else None,
                "precipitation_probability": probability,
            }
        )
    return rows
