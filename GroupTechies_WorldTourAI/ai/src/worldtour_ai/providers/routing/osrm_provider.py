"""OSRM HTTP client for route, table, and trip services.

OSRM provides external routing calculations from its road data.
It is not described here as a live-traffic service.
"""

from __future__ import annotations

from worldtour_ai.config.settings import get_settings
from worldtour_ai.providers.routing.base_routing_provider import BaseRoutingProvider
from worldtour_ai.utils.exceptions import EmptyResultError, ProviderError
from worldtour_ai.utils.http import HttpClient


class OSRMProvider(BaseRoutingProvider):
    name = "osrm"
    data_source = "live_route_calculation"

    def __init__(self, base_url: str | None = None, http: HttpClient | None = None) -> None:
        self.base_url = (base_url or get_settings().osrm_base_url).rstrip("/")
        self.http = http or HttpClient()

    def route(self, points: list[dict]) -> dict:
        payload = self._call("route", points, extra="overview=false")
        routes = payload.get("routes") or []
        if not routes:
            raise EmptyResultError("OSRM route returned no path")
        best = routes[0]
        return {
            "provider_used": self.name,
            "data_source": self.data_source,
            "distance_km": (best.get("distance") or 0) / 1000,
            "duration_minutes": (best.get("duration") or 0) / 60,
            "service": "route",
        }

    def table(self, points: list[dict]) -> dict:
        payload = self._call("table", points, extra="annotations=distance,duration")
        distances = payload.get("distances")
        durations = payload.get("durations")
        if not distances or not durations:
            raise EmptyResultError("OSRM table returned no matrix")
        return {
            "provider_used": self.name,
            "data_source": self.data_source,
            "distances_m": distances,
            "durations_s": durations,
            "service": "table",
        }

    def trip(self, points: list[dict]) -> dict:
        payload = self._call("trip", points, extra="overview=false")
        trips = payload.get("trips") or []
        if not trips:
            raise EmptyResultError("OSRM trip returned no tour")
        best = trips[0]
        return {
            "provider_used": self.name,
            "data_source": self.data_source,
            "distance_km": (best.get("distance") or 0) / 1000,
            "duration_minutes": (best.get("duration") or 0) / 60,
            "service": "trip",
            "note": "External OSRM trip reference. WorldTour optimization still uses Dijkstra and A*.",
        }

    def _call(self, service: str, points: list[dict], extra: str) -> dict:
        coords = _coord_string(points)
        if not coords:
            raise ProviderError("OSRM needs at least two coordinates")
        url = f"{self.base_url}/{service}/v1/driving/{coords}?{extra}"
        payload = self.http.get_json(url, cache_ttl=6 * 3600)
        if payload.get("code") not in (None, "Ok"):
            raise ProviderError(str(payload.get("message") or payload.get("code")))
        return payload


def _coord_string(points: list[dict]) -> str:
    parts = []
    for point in points:
        lat, lon = point.get("lat"), point.get("lon")
        if lat is None or lon is None:
            continue
        parts.append(f"{lon},{lat}")
    return ";".join(parts)
