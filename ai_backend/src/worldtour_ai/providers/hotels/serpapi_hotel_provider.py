"""Live Google Hotels rates for the travel dates through SerpApi."""

from __future__ import annotations

import re
from datetime import date, timedelta

from worldtour_ai.algorithms.graphs.geo import haversine_km
from worldtour_ai.config.settings import get_settings
from worldtour_ai.providers.hotels.base_hotel_provider import BaseHotelProvider
from worldtour_ai.utils.exceptions import EmptyResultError, ProviderError, QuotaExceededError
from worldtour_ai.utils.http import HttpClient

SERPAPI_URL = "https://serpapi.com/search.json"


class SerpApiHotelProvider(BaseHotelProvider):
    name = "serpapi_google_hotels"
    data_source = "live"

    def __init__(self, api_key: str | None = None, http: HttpClient | None = None) -> None:
        self.api_key = api_key if api_key is not None else get_settings().serpapi_api_key
        self.http = http or HttpClient(timeout=30)

    def search_hotels(
        self, city: str, lat: float | None, lon: float | None, nights: int, preferences: list[str], **context
    ) -> dict:
        if not self.api_key:
            raise ProviderError("SERPAPI_API_KEY is not set")
        check_in = context.get("check_in") or context.get("start_date")
        if not city or not check_in:
            raise ProviderError("Google Hotels needs a city and a check-in date")
        check_out = (date.fromisoformat(check_in) + timedelta(days=max(int(nights or 1), 1))).isoformat()
        payload = self.http.get_json(
            SERPAPI_URL,
            params={
                "engine": "google_hotels",
                "q": f"hotels in {city}",
                "check_in_date": check_in,
                "check_out_date": check_out,
                "adults": int(context.get("adults_per_room") or 2),
                "currency": "USD",
                "hl": "en",
                "api_key": self.api_key,
            },
            cache_ttl=12 * 3600,
            attempts=1,
        )
        error = str(payload.get("error") or "")
        if error:
            if any(word in error.lower() for word in ("run out", "limit", "quota", "plan")):
                raise QuotaExceededError(f"SerpApi: {error}")
            raise ProviderError(f"SerpApi: {error}")
        options = []
        for prop in payload.get("properties") or []:
            if prop.get("type") not in (None, "hotel"):
                continue  # skip vacation rentals
            price = (prop.get("rate_per_night") or {}).get("extracted_lowest")
            gps = prop.get("gps_coordinates") or {}
            if not prop.get("name") or not isinstance(price, (int, float)):
                continue
            hotel_lat, hotel_lon = gps.get("latitude"), gps.get("longitude")
            distance = None
            if None not in (lat, lon, hotel_lat, hotel_lon):
                distance = round(haversine_km(lat, lon, hotel_lat, hotel_lon), 2)
            stars = prop.get("extracted_hotel_class")
            options.append(
                {
                    "option_id": f"gh-{_slug(city)}-{len(options) + 1}",
                    "name": prop["name"],
                    "city": city,
                    "tier": _tier(stars, price),
                    "stars": stars,
                    "price_per_night": float(price),
                    "total_stay_price": (prop.get("total_rate") or {}).get("extracted_lowest"),
                    "currency": "USD",
                    "rating": prop.get("overall_rating"),
                    "reviews": prop.get("reviews"),
                    "location": f"{distance} km from the centre" if distance is not None else city,
                    "distance_to_center_km": distance,
                    "lat": hotel_lat,
                    "lon": hotel_lon,
                    "amenities": (prop.get("amenities") or [])[:6],
                    "check_in_time": prop.get("check_in_time"),
                    "link": prop.get("link"),
                    "why": _why(prop),
                    "nights": nights,
                    "verified_on_map": hotel_lat is not None,
                    "data_source": "live",
                    "note": f"Live Google Hotels rate for {check_in} to {check_out}.",
                }
            )
        if not options:
            raise EmptyResultError(f"Google Hotels returned no priced hotels in {city}")
        return {
            "provider_used": self.name,
            "data_source": "live",
            "options": options,
            "check_in": check_in,
            "check_out": check_out,
            "limitation": "Live Google Hotels rates via SerpApi; availability can change before booking.",
        }


def _tier(stars, price: float) -> str:
    if isinstance(stars, (int, float)):
        return "budget" if stars <= 2 else "mid" if stars == 3 else "comfort" if stars == 4 else "luxury"
    return "budget" if price < 70 else "mid" if price < 150 else "comfort" if price < 300 else "luxury"


def _why(prop: dict) -> str | None:
    parts = []
    if prop.get("hotel_class"):
        parts.append(prop["hotel_class"])
    if prop.get("overall_rating") and prop.get("reviews"):
        parts.append(f"rated {prop['overall_rating']} by {prop['reviews']:,} guests")
    amenities = (prop.get("amenities") or [])[:3]
    if amenities:
        parts.append(", ".join(amenities))
    return "; ".join(parts) or None


def _slug(text: str) -> str:
    return "-".join(re.findall(r"[a-z0-9]+", text.lower())) or "city"
