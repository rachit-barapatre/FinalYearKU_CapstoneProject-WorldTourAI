"""Forecast retrieval for every trip city. Conflict checks are separate and are not dynamic programming."""

from __future__ import annotations

from datetime import timedelta

from worldtour_ai.agents.base_agent import BaseAgent
from worldtour_ai.data.places import lookup_place
from worldtour_ai.services.itinerary_composer import city_per_day
from worldtour_ai.services.request_parser import trip_start
from worldtour_ai.tools.toolkit import weather_tool


class WeatherAgent(BaseAgent):
    agent_id = "WEATHER_AGENT"
    agent_name = "Weather Agent"
    responsibilities = ["Retrieve the forecast for each trip city", "Expose bad-weather days for later conflict checks"]
    algorithms = ["Constraint Checking"]
    tools = ["weather_tool"]
    provider = "Open-Meteo"
    llm_role = "Does not decide the schedule."

    def execute(self, state: dict) -> dict:
        request = state.get("parsed_request") or {}
        events = [self.started("Checking weather")]
        dates = _planning_days(request)
        cities = [name for name in (request.get("cities") or []) if name] or [request.get("destination")]
        day_cities = city_per_day(cities, len(dates))
        rows, sources, warnings, errors = [], [], [], []
        for city in dict.fromkeys(day_cities):
            place = lookup_place(city)
            indexes = [index for index, name in enumerate(day_cities) if name == city]
            if not place or place.lat is None:
                warnings.append(f"Weather for {city} was skipped because the city could not be located.")
                continue
            try:
                result = self.invoke(
                    weather_tool,
                    {"location": place.name, "lat": place.lat, "lon": place.lon, "days": [dates[i] for i in indexes]},
                )
            except Exception as exc:
                errors.append(f"{city}: {exc}")
                continue
            sources.append(result.get("data_source"))
            for index, row in zip(indexes, result.get("days") or []):
                rows.append({**row, "day": index + 1, "city": place.name})
        if not rows:
            events.append(self.failed("; ".join(errors) or "No weather data"))
            return {"weather_result": None, "errors": errors, "warnings": warnings, "agent_execution_history": events}
        rows.sort(key=lambda row: row["day"])
        source = sources[0] if len(set(sources)) == 1 else "mixed"
        if any("seasonal" in str(item) for item in sources):
            warnings.append("Some travel dates are beyond the 16-day forecast, so last year's weather for those dates is shown.")
        result = {
            "provider_used": "open_meteo",
            "data_source": source,
            "days": rows,
            "summary": _summary(rows, source),
            "dates_assumed": not request.get("start_date"),
            "algorithms_executed": ["Constraint Checking"],
        }
        events.append(self.completed(f"Weather source: {source}"))
        return {"weather_result": result, "warnings": warnings, "errors": errors, "agent_execution_history": events}


def _summary(rows: list[dict], source: str) -> str:
    highs = [row["temp_max_c"] for row in rows if isinstance(row.get("temp_max_c"), (int, float))]
    lows = [row["temp_min_c"] for row in rows if isinstance(row.get("temp_min_c"), (int, float))]
    wet = sum(1 for row in rows if (row.get("precipitation_probability") or 0) >= 50)
    label = {"live_forecast": "Forecast", "seasonal_historical": "Typical weather (last year)"}.get(source, "Forecast and typical weather")
    if not highs:
        return f"{label}: no temperature data."
    text = f"{label}: {min(lows) if lows else '?'}–{max(highs)} °C"
    return text + (f", rain likely on {wet} day(s)." if wet else ", little rain expected.")


def _planning_days(request: dict) -> list[dict]:
    count = int(request.get("duration_days") or 3)
    start, _assumed = trip_start(request)
    return [{"date": (start + timedelta(days=offset)).isoformat()} for offset in range(count)]
