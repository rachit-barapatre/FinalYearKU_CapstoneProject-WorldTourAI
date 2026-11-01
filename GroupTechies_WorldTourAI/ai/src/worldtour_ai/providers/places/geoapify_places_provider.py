"""Geoapify Places search."""

from __future__ import annotations

from worldtour_ai.config.settings import get_settings
from worldtour_ai.providers.places.base_places_provider import BasePlacesProvider
from worldtour_ai.utils.exceptions import EmptyResultError, ProviderError
from worldtour_ai.utils.http import HttpClient

_DEFAULT = "tourism.sights,tourism.attraction.viewpoint,entertainment.museum,entertainment.zoo,entertainment.aquarium,entertainment.theme_park,beach"
_SKIP = ("memorial", "building", "office", "commercial.houseware", "man_made", "artwork", "accommodation")
# OpenStreetMap tags single shops as malls and hotel frontage as beaches; keep only names that look like the real thing.
_MALL_WORDS = ("mall", "souk", "souq", "market", "bazaar", "outlet", "plaza", "galleria", "arcade")
_NOT_SIGHTS = ("grocery", "supermarket", "hypermarket", "mini mart", "minimart", "pharmacy", "laundry", "mobile", "electronics")
_PRIVATE_BEACH_WORDS = (
    "hotel", "resort", "club", "private", "mandarin", "hilton", "marriott", "hyatt", "sheraton",
    "ritz", "four seasons", "westin", "sofitel", "rixos", "intercontinental", "radisson",
)

_CATEGORIES = {
    "history": "tourism.sights.castle,tourism.sights.fort,tourism.sights.place_of_worship,entertainment.museum",
    "culture": "entertainment.culture,entertainment.museum,tourism.attraction",
    "food": "catering.restaurant",
    "nature": "natural,leisure.park",
    "beach": "beach,natural",
    "adventure": "sport,natural",
    "shopping": "commercial.shopping_mall,commercial.marketplace",
}


class GeoapifyPlacesProvider(BasePlacesProvider):
    name = "geoapify"
    data_source = "live"

    def __init__(self, http: HttpClient | None = None) -> None:
        self.http = http or HttpClient()

    def search_places(self, city: str, lat: float | None, lon: float | None, preferences: list[str]) -> dict:
        key = get_settings().geoapify_api_key
        if not key or lat is None or lon is None:
            raise ProviderError("Geoapify needs an API key and coordinates")
        groups = [_DEFAULT]
        for pref in preferences or []:
            category = _CATEGORIES.get(pref)
            if category and category not in groups:
                groups.append(category)
        batches = []
        for category in groups:
            payload = self.http.get_json(
                "https://api.geoapify.com/v2/places",
                params={
                    "categories": category,
                    "filter": f"circle:{lon},{lat},8000",
                    "bias": f"proximity:{lon},{lat}",
                    "limit": 20,
                    "apiKey": key,
                },
                cache_ttl=12 * 3600,
            )
            batches.append(payload.get("features") or [])
        features = []
        seen_ids = set()
        for row in range(max((len(batch) for batch in batches), default=0)):
            for batch in batches:
                if row < len(batch):
                    feature = batch[row]
                    place_id = (feature.get("properties") or {}).get("place_id")
                    if place_id in seen_ids:
                        continue
                    seen_ids.add(place_id)
                    features.append(feature)
        places = []
        for index, feature in enumerate(features, start=1):
            props = feature.get("properties") or {}
            coords = (feature.get("geometry") or {}).get("coordinates") or [None, None]
            categories_found = props.get("categories") or []
            name = (props.get("name_international") or {}).get("en") or props.get("name")
            if not name:
                continue
            if any(skip in category for category in categories_found for skip in _SKIP):
                continue
            if not _plausible(name, categories_found):
                continue
            places.append(
                {
                    "place_id": props.get("place_id") or f"geo-{index}",
                    "name": name,
                    "category": _label(categories_found),
                    "address": _short_address(props.get("address_line2") or props.get("formatted") or "", city),
                    "city": city,
                    "lat": coords[1],
                    "lon": coords[0],
                    "rating": 4.0,
                    "data_source": "live",
                }
            )
        if not places:
            raise EmptyResultError("Geoapify returned no places")
        return {"provider_used": self.name, "data_source": "live", "places": places}


def _short_address(text: str, city: str) -> str:
    """Street and district only: drop the city, region, country and accessibility tags."""
    city_key = (city or "").strip().lower()
    parts = []
    for part in (piece.strip() for piece in text.split(",")):
        lowered = part.lower()
        if not part or "wheelchair" in lowered or lowered.startswith(city_key) or "emirate" in lowered:
            continue
        if lowered in {"united arab emirates", "india", "france", "japan", "italy", "united kingdom", "united states"}:
            continue
        parts.append(part)
    return ", ".join(parts[:2])


def _plausible(name: str, categories: list[str]) -> bool:
    lowered = name.lower()
    joined = " ".join(categories)
    if any(word in lowered for word in _NOT_SIGHTS):
        return False
    if "shopping_mall" in joined and not any(word in lowered for word in _MALL_WORDS):
        return False
    if categories and all(category == "beach" for category in categories):
        return not any(word in lowered for word in _PRIVATE_BEACH_WORDS)
    return True


def _label(categories: list[str]) -> str:
    joined = " ".join(categories)
    for keyword, label in (
        ("theme_park", "entertainment"),
        ("zoo", "entertainment"),
        ("aquarium", "entertainment"),
        ("beach", "beach"),
        ("museum", "history"),
        ("castle", "history"),
        ("fort", "history"),
        ("place_of_worship", "culture"),
        ("culture", "culture"),
        ("catering", "food"),
        ("park", "nature"),
        ("natural", "nature"),
        ("sport", "adventure"),
        ("shopping", "shopping"),
        ("marketplace", "shopping"),
    ):
        if keyword in joined:
            return label
    return "sightseeing"
