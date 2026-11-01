"""Routing provider interface.

Concrete providers supply route, table, and trip data.
WorldTour does not treat that data as its own shortest-path algorithm.
"""

from __future__ import annotations


class BaseRoutingProvider:
    name = "base_routing_provider"
    data_source = "unknown"

    def route(self, points: list[dict]) -> dict:
        raise NotImplementedError

    def table(self, points: list[dict]) -> dict:
        raise NotImplementedError

    def trip(self, points: list[dict]) -> dict:
        raise NotImplementedError
