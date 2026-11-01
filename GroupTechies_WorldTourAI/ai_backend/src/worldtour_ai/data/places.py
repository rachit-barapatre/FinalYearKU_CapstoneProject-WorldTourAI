"""Known places, gateways, and offline resolution."""

from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class Place:
    name: str
    kind: str
    lat: float | None
    lon: float | None
    iata: str | None
    country: str | None
    aliases: tuple[str, ...]
    suggested_cities: tuple[str, ...] = ()


def _city(name, lat, lon, iata, country, aliases=()):
    return Place(name, "city", lat, lon, iata, country, (name.lower(),) + tuple(a.lower() for a in aliases))


def _region(name, lat, lon, country, aliases, cities, iata=None):
    return Place(
        name, "region", lat, lon, iata, country,
        (name.lower(),) + tuple(a.lower() for a in aliases),
        tuple(cities),
    )


PLACES: tuple[Place, ...] = (
    _city("Ahmedabad", 23.0225, 72.5714, "AMD", "India", ("amdavad",)),
    _city("Mumbai", 19.0760, 72.8777, "BOM", "India", ("bombay",)),
    _city("Delhi", 28.6139, 77.2090, "DEL", "India", ("new delhi",)),
    _city("Jaipur", 26.9124, 75.7873, "JAI", "India"),
    _city("Udaipur", 24.5854, 73.7125, "UDR", "India"),
    _city("Jodhpur", 26.2389, 73.0243, "JDH", "India"),
    _city("Agra", 27.1767, 78.0081, "AGR", "India"),
    # Panaji, between the north and south beaches; the state's geographic centre is inland and far from them.
    _city("Goa", 15.4909, 73.8278, "GOI", "India", ("panaji", "panjim")),
    _city("Shimla", 31.1048, 77.1734, "SLV", "India"),
    _city("Manali", 32.2432, 77.1892, "KUU", "India"),
    _city("Kolkata", 22.5726, 88.3639, "CCU", "India", ("calcutta",)),
    _city("Chennai", 13.0827, 80.2707, "MAA", "India", ("madras",)),
    _city("Bengaluru", 12.9716, 77.5946, "BLR", "India", ("bangalore",)),
    _city("Hyderabad", 17.3850, 78.4867, "HYD", "India"),
    _city("Pune", 18.5204, 73.8567, "PNQ", "India"),
    _city("Kochi", 9.9312, 76.2673, "COK", "India", ("cochin",)),
    _city("Varanasi", 25.3176, 82.9739, "VNS", "India", ("banaras",)),
    _city("Amritsar", 31.6340, 74.8723, "ATQ", "India"),
    _city("Srinagar", 34.0837, 74.7973, "SXR", "India"),
    _city("Leh", 34.1526, 77.5771, "IXL", "India"),
    _city("Surat", 21.1702, 72.8311, "STV", "India"),
    _city("Lucknow", 26.8467, 80.9462, "LKO", "India"),
    _city("Guwahati", 26.1445, 91.7362, "GAU", "India"),
    _city("Port Blair", 11.6234, 92.7265, "IXZ", "India", ("andaman",)),
    # Hill stations and small towns use the nearest practical airport for flights.
    _city("Rishikesh", 30.0869, 78.2676, "DED", "India"),
    _city("Haridwar", 29.9457, 78.1642, "DED", "India"),
    _city("Dehradun", 30.3165, 78.0322, "DED", "India"),
    _city("Mussoorie", 30.4598, 78.0644, "DED", "India"),
    _city("Nainital", 29.3803, 79.4636, "PGH", "India"),
    _city("Ooty", 11.4102, 76.6950, "CJB", "India", ("udhagamandalam", "ooty hills")),
    _city("Coorg", 12.4244, 75.7382, "IXE", "India", ("kodagu", "madikeri")),
    _city("Mysuru", 12.2958, 76.6394, "BLR", "India", ("mysore",)),
    _city("Munnar", 10.0889, 77.0595, "COK", "India"),
    _city("Alappuzha", 9.4981, 76.3388, "COK", "India", ("alleppey",)),
    _city("Puducherry", 11.9416, 79.8083, "MAA", "India", ("pondicherry", "pondy")),
    _city("Darjeeling", 27.0410, 88.2663, "IXB", "India"),
    _city("Gangtok", 27.3389, 88.6065, "IXB", "India"),
    _city("Chandigarh", 30.7333, 76.7794, "IXC", "India"),
    _city("Indore", 22.7196, 75.8577, "IDR", "India"),
    _city("Nagpur", 21.1458, 79.0882, "NAG", "India"),
    _city("Bhubaneswar", 20.2961, 85.8245, "BBI", "India"),
    _city("Jaisalmer", 26.9157, 70.9083, "JSA", "India"),
    _city("Mount Abu", 24.5926, 72.7156, "UDR", "India"),
    _city("Pushkar", 26.4897, 74.5511, "JAI", "India"),
    _city("Pokhara", 28.2096, 83.9856, "PKR", "Nepal"),
    _city("Dubai", 25.2048, 55.2708, "DXB", "United Arab Emirates"),
    _city("Abu Dhabi", 24.4539, 54.3773, "AUH", "United Arab Emirates"),
    _city("Kathmandu", 27.7172, 85.3240, "KTM", "Nepal"),
    _city("Colombo", 6.9271, 79.8612, "CMB", "Sri Lanka"),
    # Named "Malé" so the English word "male" in a request is not read as a destination.
    _city("Malé", 4.1755, 73.5093, "MLE", "Maldives", ("maldives", "male city")),
    _city("Kuala Lumpur", 3.1390, 101.6869, "KUL", "Malaysia"),
    _city("Hong Kong", 22.3193, 114.1694, "HKG", "Hong Kong"),
    _city("Seoul", 37.5665, 126.9780, "ICN", "South Korea"),
    _city("Istanbul", 41.0082, 28.9784, "IST", "Turkey"),
    _city("Sydney", -33.8688, 151.2093, "SYD", "Australia"),
    _city("Toronto", 43.6532, -79.3832, "YYZ", "Canada"),
    _city("San Francisco", 37.7749, -122.4194, "SFO", "United States"),
    _city("Los Angeles", 34.0522, -118.2437, "LAX", "United States"),
    _city("San Diego", 32.7157, -117.1611, "SAN", "United States"),
    _city("Las Vegas", 36.1699, -115.1398, "LAS", "United States"),
    _city("Orlando", 28.5383, -81.3792, "MCO", "United States"),
    _city("Miami", 25.7617, -80.1918, "MIA", "United States"),
    _city("Chicago", 41.8781, -87.6298, "ORD", "United States"),
    _city("Zurich", 47.3769, 8.5417, "ZRH", "Switzerland"),
    _city("Barcelona", 41.3874, 2.1686, "BCN", "Spain"),
    _city("Athens", 37.9838, 23.7275, "ATH", "Greece"),
    _city("Tokyo", 35.6762, 139.6503, "HND", "Japan"),
    _city("Kyoto", 35.0116, 135.7681, "UKY", "Japan"),
    _city("Osaka", 34.6937, 135.5023, "KIX", "Japan"),
    _city("Paris", 48.8566, 2.3522, "CDG", "France"),
    _city("Amsterdam", 52.3676, 4.9041, "AMS", "Netherlands"),
    _city("Rome", 41.9028, 12.4964, "FCO", "Italy"),
    _city("Florence", 43.7696, 11.2558, "FLR", "Italy"),
    _city("Venice", 45.4408, 12.3155, "VCE", "Italy"),
    _city("London", 51.5072, -0.1276, "LHR", "United Kingdom"),
    _city("Singapore", 1.3521, 103.8198, "SIN", "Singapore"),
    _city("Bangkok", 13.7563, 100.5018, "BKK", "Thailand"),
    _city("Phuket", 7.8804, 98.3923, "HKT", "Thailand"),
    _city("Berlin", 52.5200, 13.4050, "BER", "Germany"),
    _city("Madrid", 40.4168, -3.7038, "MAD", "Spain"),
    _city("Lisbon", 38.7223, -9.1393, "LIS", "Portugal"),
    _city("Vienna", 48.2082, 16.3738, "VIE", "Austria"),
    _city("Prague", 50.0755, 14.4378, "PRG", "Czech Republic"),
    _city("Budapest", 47.4979, 19.0402, "BUD", "Hungary"),
    _city("New York", 40.7128, -74.0060, "JFK", "United States", ("nyc",)),
    # Kuta/Seminyak, where most visitors stay; the island's centre is inland.
    _city("Bali", -8.7000, 115.1700, "DPS", "Indonesia", ("denpasar",)),
    _region("Japan", 35.6762, 139.6503, "Japan", (), ("Tokyo", "Kyoto", "Osaka"), "HND"),
    _region("Thailand", 13.7563, 100.5018, "Thailand", (), ("Bangkok", "Phuket"), "BKK"),
    _region("Italy", 41.9028, 12.4964, "Italy", (), ("Rome", "Florence", "Venice"), "FCO"),
    _region("Europe", 48.8566, 2.3522, None, ("european",), ("Paris", "Amsterdam", "Rome"), "CDG"),
    _region("Northern India", 28.6139, 77.2090, "India", ("north india",), ("Delhi", "Agra", "Jaipur"), "DEL"),
    _region("Rajasthan", 26.9124, 75.7873, "India", (), ("Jaipur", "Udaipur", "Jodhpur"), "JAI"),
    _region("Himachal Pradesh", 31.1048, 77.1734, "India", ("himachal",), ("Shimla", "Manali"), "SLV"),
    _region("India", 28.6139, 77.2090, "India", (), ("Delhi", "Jaipur", "Agra"), "DEL"),
    _region("California", 34.0522, -118.2437, "United States", ("cali", "socal", "norcal"), ("Los Angeles", "San Francisco", "San Diego"), "LAX"),
    _region("Florida", 25.7617, -80.1918, "United States", (), ("Miami", "Orlando"), "MIA"),
    _region("United States", 40.7128, -74.0060, "United States", ("usa", "america"), ("New York", "Chicago", "San Francisco"), "JFK"),
    _region("Kerala", 9.9312, 76.2673, "India", (), ("Kochi", "Munnar", "Alappuzha"), "COK"),
    _region("Uttarakhand", 30.3165, 78.0322, "India", (), ("Rishikesh", "Mussoorie"), "DED"),
    _region("Sikkim", 27.3389, 88.6065, "India", (), ("Gangtok",), "IXB"),
    _region("Nepal", 27.7172, 85.3240, "Nepal", (), ("Kathmandu", "Pokhara"), "KTM"),
    _region("Kashmir", 34.0837, 74.7973, "India", (), ("Srinagar",), "SXR"),
    _region("Ladakh", 34.1526, 77.5771, "India", (), ("Leh",), "IXL"),
    _region("Switzerland", 47.3769, 8.5417, "Switzerland", (), ("Zurich",), "ZRH"),
    _region("Spain", 40.4168, -3.7038, "Spain", (), ("Madrid", "Barcelona"), "MAD"),
    _region("France", 48.8566, 2.3522, "France", (), ("Paris",), "CDG"),
    _region("Australia", -33.8688, 151.2093, "Australia", (), ("Sydney",), "SYD"),
)

_BY_ALIAS: dict[str, Place] = {}
for place in PLACES:
    for alias in place.aliases:
        _BY_ALIAS.setdefault(alias, place)


def normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().lower())


def lookup_place(name: str | None) -> Place | None:
    if not name:
        return None
    return _BY_ALIAS.get(normalize(name))


def place_aliases() -> list[str]:
    """Every name and alias the catalog knows, for typo correction."""
    return list(_BY_ALIAS)


def find_mentions(text: str) -> list[tuple[int, int, Place]]:
    """Longest-alias matches, dropping a hit fully inside a longer one."""
    lowered = text.lower()
    hits: list[tuple[int, int, Place]] = []
    for alias, place in sorted(_BY_ALIAS.items(), key=lambda item: len(item[0]), reverse=True):
        for match in re.finditer(rf"(?<![a-z]){re.escape(alias)}(?![a-z])", lowered):
            start, end = match.start(), match.end()
            if any(start >= s and end <= e for s, e, _ in hits):
                continue
            hits.append((start, end, place))
    hits.sort(key=lambda item: item[0])
    return hits


def place_payload(place: Place) -> dict:
    return {
        "name": place.name,
        "kind": place.kind,
        "lat": place.lat,
        "lon": place.lon,
        "iata": place.iata,
        "country": place.country,
        "suggested_cities": list(place.suggested_cities),
    }
