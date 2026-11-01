"""Optional hotel search through Geoapify accommodation places."""

from __future__ import annotations

from worldtour_ai.config.settings import get_settings
from worldtour_ai.providers.hotels.base_hotel_provider import BaseHotelProvider
from worldtour_ai.utils.exceptions import EmptyResultError, ProviderError
from worldtour_ai.utils.http import HttpClient


class GeoapifyHotelProvider(BaseHotelProvider):
    name = "geoapify_hotels"
    data_source = "live"

    def __init__(self, http: HttpClient | None = None) -> None:
        self.http = http or HttpClient()

    def search_hotels(
        self, city: str, lat: float | None, lon: float | None, nights: int, preferences: list[str], **context
    ) -> dict:
        key = get_settings().geoapify_api_key
        if not key or lat is None or lon is None:
            raise ProviderError("Geoapify hotel search needs an API key and coordinates")
        payload = self.http.get_json(
            "https://api.geoapify.com/v2/places",
            params={
                "categories": "accommodation.hotel",
                "filter": f"circle:{lon},{lat},4000",
                "bias": f"proximity:{lon},{lat}",
                "limit": 8,
                "apiKey": key,
            },
            cache_ttl=12 * 3600,
        )
        features = payload.get("features") or []
        options = []
        for index, feature in enumerate(features, start=1):
            props = feature.get("properties") or {}
            coords = (feature.get("geometry") or {}).get("coordinates") or [None, None]
            options.append(
                {
                    "option_id": props.get("place_id") or f"geo-hotel-{index}",
                    "name": props.get("name") or f"Hotel in {city}",
                    "city": city,
                    "price_per_night": None,
                    "currency": None,
                    "rating": None,
                    "location": props.get("address_line1") or props.get("formatted"),
                    "distance_to_center_km": round((props.get("distance") or 0) / 1000, 2),
                    "lat": coords[1],
                    "lon": coords[0],
                    "nights": nights,
                    "data_source": "live",
                    "note": "Geoapify place record. Nightly rate was not provided.",
                }
            )
        if not options:
            raise EmptyResultError("Geoapify returned no hotels")
        return {"provider_used": self.name, "data_source": "live", "options": options}
