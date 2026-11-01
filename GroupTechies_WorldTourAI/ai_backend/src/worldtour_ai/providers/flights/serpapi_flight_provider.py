"""Live Google Flights fares for future dates through SerpApi.

One request returns round-trip fares for the outbound options. A second request with the
chosen outbound's departure_token returns the matching return flights. Prices are per
person (adults=1) in USD; the round-trip fare is carried on the outbound option.
"""

from __future__ import annotations

from worldtour_ai.config.settings import get_settings
from worldtour_ai.providers.flights.base_flight_provider import BaseFlightProvider
from worldtour_ai.utils.exceptions import EmptyResultError, ProviderError, QuotaExceededError
from worldtour_ai.utils.http import HttpClient

SERPAPI_URL = "https://serpapi.com/search.json"
MAX_OPTIONS = 8


class SerpApiFlightProvider(BaseFlightProvider):
    name = "serpapi_google_flights"
    data_source = "live"

    def __init__(self, api_key: str | None = None, http: HttpClient | None = None) -> None:
        self.api_key = api_key if api_key is not None else get_settings().serpapi_api_key
        self.http = http or HttpClient(timeout=30)

    def search_flights(
        self, origin_iata: str, destination_iata: str, travel_date: str | None = None, return_date: str | None = None, **_
    ) -> dict:
        if not self.api_key:
            raise ProviderError("SERPAPI_API_KEY is not set")
        if not travel_date:
            raise ProviderError("Google Flights needs a travel date")
        params = {
            "engine": "google_flights",
            "departure_id": origin_iata,
            "arrival_id": destination_iata,
            "outbound_date": travel_date,
            "currency": "USD",
            "hl": "en",
            "adults": 1,
            "type": 1 if return_date else 2,
            "api_key": self.api_key,
        }
        if return_date:
            params["return_date"] = return_date
        payload = self._get(params)
        itineraries = _itineraries(payload)
        if not itineraries:
            raise EmptyResultError(f"Google Flights returned no flights for {origin_iata} to {destination_iata} on {travel_date}")
        scope = "round trip per person" if return_date else "one way per person"
        options = [_option(item, index, "outbound", scope) for index, item in enumerate(itineraries[:MAX_OPTIONS])]
        result = {
            "provider_used": self.name,
            "data_source": "live",
            "options": options,
            "price_insights": payload.get("price_insights"),
            "travel_date_requested": travel_date,
            "return_date_requested": return_date,
            "limitation": "Live Google Flights fares via SerpApi. Book on the airline or Google Flights.",
        }
        if return_date:
            result["return_options"] = []
            token = itineraries[0].get("departure_token")
            if token:
                try:
                    returning = _itineraries(self._get({**params, "departure_token": token}))
                except ProviderError as exc:
                    returning = []
                    result["return_error"] = str(exc)
                result["return_options"] = [
                    {**_option(item, index, "return", scope), "price": None, "price_included": True,
                     "note": "Included in the round-trip fare shown on the outbound flight."}
                    for index, item in enumerate(returning[:MAX_OPTIONS])
                ]
            # The return flights belong to Google's best outbound, so keep it first.
            result["pinned_outbound"] = options[0]["option_id"]
        return result

    def _get(self, params: dict) -> dict:
        payload = self.http.get_json(SERPAPI_URL, params=params, cache_ttl=6 * 3600, attempts=1)
        error = str(payload.get("error") or "")
        if error:
            if any(word in error.lower() for word in ("run out", "limit", "quota", "plan")):
                raise QuotaExceededError(f"SerpApi: {error}")
            raise ProviderError(f"SerpApi: {error}")
        return payload


def _itineraries(payload: dict) -> list[dict]:
    return [item for item in (payload.get("best_flights") or []) + (payload.get("other_flights") or []) if item.get("flights")]


def _option(item: dict, index: int, direction: str, scope: str) -> dict:
    legs = item.get("flights") or []
    first, last = legs[0], legs[-1]
    airlines = list(dict.fromkeys(leg.get("airline") for leg in legs if leg.get("airline")))
    via = [stop.get("id") or stop.get("name") for stop in item.get("layovers") or []]
    return {
        "option_id": f"gf-{direction}-{index + 1}",
        "airline": " + ".join(airlines) or None,
        "flight_number": " / ".join(str(leg.get("flight_number") or "") for leg in legs).strip(" /"),
        "origin": (first.get("departure_airport") or {}).get("id"),
        "destination": (last.get("arrival_airport") or {}).get("id"),
        "departure_airport": (first.get("departure_airport") or {}).get("name"),
        "arrival_airport": (last.get("arrival_airport") or {}).get("name"),
        "departure_time": _iso((first.get("departure_airport") or {}).get("time")),
        "arrival_time": _iso((last.get("arrival_airport") or {}).get("time")),
        "duration_minutes": item.get("total_duration"),
        "stops": len(legs) - 1,
        "via": " -> ".join(str(stop) for stop in via if stop) or None,
        "price": item.get("price") if isinstance(item.get("price"), (int, float)) else None,
        "currency": "USD",
        "price_is_estimate": False,
        "price_scope": scope,
        "travel_class": first.get("travel_class"),
        "data_source": "live",
        "note": f"Live Google Flights fare ({scope}).",
    }


def _iso(value: str | None) -> str | None:
    """SerpApi gives "2026-12-12 09:50"; the rest of the app reads ISO "2026-12-12T09:50"."""
    return value.replace(" ", "T", 1) if isinstance(value, str) else value
