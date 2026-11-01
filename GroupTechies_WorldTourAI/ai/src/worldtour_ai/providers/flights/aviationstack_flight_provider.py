"""Aviationstack client.

Aviationstack supplies current aviation records. It is not a booking API and the
free plan does not provide future fare search. Prices are left empty.

When no direct records exist, one-stop options are built from two real records:
origin -> hub and hub -> destination. The legs are separate schedule records, so
the connection time is not guaranteed.
"""

from __future__ import annotations

from collections import Counter

from worldtour_ai.config.settings import get_settings
from worldtour_ai.providers.flights.base_flight_provider import BaseFlightProvider
from worldtour_ai.utils.exceptions import EmptyResultError, ProviderError, QuotaExceededError
from worldtour_ai.utils.http import HttpClient

LONG_HAUL_HUBS = [
    "DXB", "DOH", "AUH", "IST", "LHR", "FRA", "CDG", "AMS", "MUC", "ZRH",
    "SIN", "HKG", "NRT", "HND", "ICN", "BKK", "KUL", "DEL", "BOM", "JFK",
    "SFO", "ORD", "LAX", "YYZ", "SYD",
]
MAX_HUBS = 3
MAX_TWO_STOP_HUBS = 2


class AviationStackFlightProvider(BaseFlightProvider):
    name = "aviationstack"
    data_source = "live"

    def __init__(self, api_key: str | None = None, http: HttpClient | None = None) -> None:
        self.api_key = api_key if api_key is not None else get_settings().aviationstack_api_key
        self.http = http or HttpClient()

    def search_flights(self, origin_iata: str, destination_iata: str, travel_date: str | None = None, **_) -> dict:
        if not self.api_key:
            raise ProviderError("AVIATIONSTACK_API_KEY is not set")
        if not origin_iata or not destination_iata:
            raise ProviderError("Airport codes are required")
        direct = self._query({"dep_iata": origin_iata, "arr_iata": destination_iata, "limit": 8})
        options = [_direct_option(row, index, origin_iata, destination_iata) for index, row in enumerate(direct)]
        search = "direct"
        if not options:
            options = self._one_stop(origin_iata, destination_iata)
            search = "connections_from_records"
        if not options:
            raise EmptyResultError(
                f"No current Aviationstack flights for {origin_iata} to {destination_iata}, direct or via a hub"
            )
        return {
            "provider_used": self.name,
            "data_source": "live",
            "options": options,
            "search": search,
            "travel_date_requested": travel_date,
            "limitation": "Real-time aviation data, not a future booking search.",
        }

    def _one_stop(self, origin: str, destination: str) -> list[dict]:
        departures = self._query({"dep_iata": origin, "limit": 100})
        served = Counter(
            (row.get("arrival") or {}).get("iata")
            for row in departures
            if (row.get("arrival") or {}).get("iata") not in (None, origin, destination)
        )
        hubs = [hub for hub in LONG_HAUL_HUBS if hub in served]
        hubs += [hub for hub, _ in served.most_common() if hub not in hubs]
        options = []
        for hub in hubs[:MAX_HUBS]:
            second_legs = self._query({"dep_iata": hub, "arr_iata": destination, "limit": 5})
            if not second_legs:
                continue
            first_legs = [row for row in departures if (row.get("arrival") or {}).get("iata") == hub]
            for first, second in zip(first_legs[:2], second_legs[:2]):
                options.append(_connection_option([first, second], len(options), origin, destination))
        if options:
            return options
        return self._two_stop(origin, destination, departures, hubs[:MAX_HUBS])

    def _two_stop(self, origin: str, destination: str, departures: list[dict], first_hubs: list[str]) -> list[dict]:
        """origin -> first hub -> long-haul hub -> destination, using only recorded legs."""
        long_haul = []
        for hub in LONG_HAUL_HUBS[:6]:
            if hub in (origin, destination) or hub in first_hubs:
                continue
            legs = self._query({"dep_iata": hub, "arr_iata": destination, "limit": 3})
            if legs:
                long_haul.append((hub, legs))
            if len(long_haul) == MAX_TWO_STOP_HUBS:
                break
        options = []
        for first_hub in [h for h in first_hubs if h in LONG_HAUL_HUBS][:MAX_TWO_STOP_HUBS]:
            first = next((r for r in departures if (r.get("arrival") or {}).get("iata") == first_hub), None)
            if first is None:
                continue
            for hub, last_legs in long_haul:
                middle = self._query({"dep_iata": first_hub, "arr_iata": hub, "limit": 3})
                if middle:
                    options.append(_connection_option([first, middle[0], last_legs[0]], len(options), origin, destination))
        return options

    def _query(self, params: dict) -> list[dict]:
        payload = self.http.get_json(
            "http://api.aviationstack.com/v1/flights",
            params={"access_key": self.api_key, **params},
            cache_ttl=6 * 3600,
            attempts=get_settings().max_retry_attempts,
        )
        if payload.get("error"):
            info = payload["error"]
            code = str(info.get("code", "")).lower()
            message = str(info.get("message", "Aviationstack error"))
            if "limit" in code or "quota" in message.lower() or "usage" in code:
                raise QuotaExceededError(message)
            raise ProviderError(message)
        return [row for row in payload.get("data") or [] if isinstance(row, dict)]


def _direct_option(row: dict, index: int, origin_iata: str, destination_iata: str) -> dict:
    departure = row.get("departure") or {}
    arrival = row.get("arrival") or {}
    airline = row.get("airline") or {}
    flight = row.get("flight") or {}
    dep_time = departure.get("scheduled") or departure.get("estimated")
    arr_time = arrival.get("scheduled") or arrival.get("estimated")
    return {
        "option_id": f"avs-{index + 1}",
        "airline": airline.get("name"),
        "flight_number": flight.get("iata") or flight.get("number"),
        "origin": departure.get("iata") or origin_iata,
        "destination": arrival.get("iata") or destination_iata,
        "departure_airport": departure.get("airport"),
        "arrival_airport": arrival.get("airport"),
        "departure_time": dep_time,
        "arrival_time": arr_time,
        "duration_minutes": None,
        "stops": 0,
        "price": None,
        "currency": None,
        "price_is_estimate": False,
        "data_source": "live",
        "note": "Current Aviationstack record. Not a booking quote. Fare was not provided.",
    }


def _connection_option(rows: list[dict], index: int, origin: str, destination: str) -> dict:
    legs = [_direct_option(row, 0, "", "") for row in rows]
    hubs = [leg["destination"] for leg in legs[:-1]]
    airlines = list(dict.fromkeys(leg["airline"] for leg in legs if leg["airline"]))
    via = " -> ".join(hubs)
    return {
        "option_id": f"avs-via-{'-'.join(h.lower() for h in hubs)}-{index + 1}",
        "airline": " + ".join(airlines) or None,
        "flight_number": " / ".join(str(leg["flight_number"]) for leg in legs),
        "origin": origin,
        "destination": destination,
        "via": via,
        "departure_airport": legs[0]["departure_airport"],
        "arrival_airport": legs[-1]["arrival_airport"],
        "departure_time": legs[0]["departure_time"],
        "arrival_time": legs[-1]["arrival_time"],
        "duration_minutes": None,
        "legs": legs,
        "stops": len(hubs),
        "price": None,
        "currency": None,
        "price_is_estimate": False,
        "data_source": "live",
        "note": f"{len(legs)} current Aviationstack records joined at {via}. Connection times are not guaranteed. Fare was not provided.",
    }
