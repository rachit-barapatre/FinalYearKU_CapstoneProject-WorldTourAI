"""Offline distances from Haversine. Used when OSRM cannot be reached."""

from __future__ import annotations

from worldtour_ai.algorithms.graphs.geo import haversine_km
from worldtour_ai.providers.routing.base_routing_provider import BaseRoutingProvider


class LocalGraphProvider(BaseRoutingProvider):
    name = "local_graph_provider"
    data_source = "local_graph_fallback"

    def route(self, points: list[dict]) -> dict:
        distance = _path_distance(points)
        return {
            "provider_used": self.name,
            "data_source": self.data_source,
            "distance_km": distance,
            "duration_minutes": distance / 40 * 60,
            "service": "route",
        }

    def table(self, points: list[dict]) -> dict:
        size = len(points)
        distances = []
        durations = []
        for row_index, row in enumerate(points):
            distance_row = []
            duration_row = []
            for col_index, col in enumerate(points):
                if row_index == col_index or row.get("lat") is None or col.get("lat") is None:
                    km = 0.0
                else:
                    km = haversine_km(row["lat"], row["lon"], col["lat"], col["lon"]) * 1.3
                distance_row.append(km * 1000)
                duration_row.append((km / 40) * 3600)
            distances.append(distance_row)
            durations.append(duration_row)
        return {
            "provider_used": self.name,
            "data_source": self.data_source,
            "distances_m": distances,
            "durations_s": durations,
            "service": "table",
        }

    def trip(self, points: list[dict]) -> dict:
        distance = _path_distance(points)
        return {
            "provider_used": self.name,
            "data_source": self.data_source,
            "distance_km": distance,
            "duration_minutes": distance / 40 * 60,
            "service": "trip",
            "note": "Local fallback tour estimate, not an OSRM trip.",
        }


def _path_distance(points: list[dict]) -> float:
    total = 0.0
    for left, right in zip(points, points[1:]):
        if left.get("lat") is None or right.get("lat") is None:
            continue
        total += haversine_km(left["lat"], left["lon"], right["lat"], right["lon"]) * 1.3
    return total
