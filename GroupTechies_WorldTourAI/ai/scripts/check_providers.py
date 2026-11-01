"""Call every provider gateway once with live settings and report which provider answered.

Usage: python scripts/check_providers.py [origin_iata destination_iata city]
"""

from __future__ import annotations

import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from worldtour_ai.data.places import lookup_place  # noqa: E402
from worldtour_ai.providers.factory import (  # noqa: E402
    CurrencyGateway,
    FlightGateway,
    HotelGateway,
    PlacesGateway,
    RoutingGateway,
    WeatherGateway,
)
from worldtour_ai.providers.llm.openrouter_provider import OpenRouterProvider  # noqa: E402


def main() -> None:
    origin, destination, city_name = (sys.argv[1:4] + [None] * 3)[:3]
    origin = origin or "BOM"
    destination = destination or "SIN"
    city = lookup_place(city_name or "Singapore")
    start = date.today() + timedelta(days=10)
    days = [{"date": (start + timedelta(days=i)).isoformat()} for i in range(3)]

    checks = [
        ("LLM (OpenRouter)", lambda: {"provider_used": "openrouter", "data_source": "live",
                                      "sample": OpenRouterProvider().complete("Reply with one word.", "Say ok", timeout=60)}),
        ("Flights", lambda: FlightGateway().search_flights(
            origin, destination, start.isoformat(), return_date=(start + timedelta(days=4)).isoformat())),
        ("Hotels", lambda: HotelGateway().search_hotels(
            city.name, city.lat, city.lon, 3, ["culture"], travelers=2, check_in=start.isoformat(), adults_per_room=2)),
        ("Weather", lambda: WeatherGateway().forecast(city.name, city.lat, city.lon, days)),
        ("Places", lambda: PlacesGateway().search_places(city.name, city.lat, city.lon, ["culture"])),
        ("Routing", lambda: RoutingGateway().table([
            {"id": "a", "lat": city.lat, "lon": city.lon},
            {"id": "b", "lat": city.lat + 0.02, "lon": city.lon + 0.02},
        ])),
        ("Currency", lambda: CurrencyGateway().convert(100, "USD", "INR")),
    ]
    print(f"{'Check':<18} {'Provider':<24} {'Source':<8} Detail")
    print("-" * 90)
    for label, call in checks:
        try:
            result = call()
        except Exception as exc:
            print(f"{label:<18} {'-':<24} {'ERROR':<8} {exc}")
            continue
        count = len(result.get("options") or result.get("places") or result.get("days") or [])
        detail = result.get("fallback_reason") or (f"{count} rows" if count else str(result.get("sample") or result.get("amount") or "ok"))
        print(f"{label:<18} {str(result.get('provider_used')):<24} {str(result.get('data_source')):<8} {detail[:60]}")


if __name__ == "__main__":
    main()
