"""Per-person, per-km fares in USD for travel between trip cities by bus or train.

These are static planning figures, not live prices.
"""

from __future__ import annotations

INTERCITY_PER_KM: dict[str, float] = {
    "India": 0.03,
    "Nepal": 0.03,
    "Sri Lanka": 0.03,
    "Thailand": 0.05,
    "Indonesia": 0.05,
    "Malaysia": 0.05,
    "Maldives": 0.2,
    "United Arab Emirates": 0.08,
    "Singapore": 0.1,
    "Hong Kong": 0.1,
    "Japan": 0.2,
    "South Korea": 0.12,
    "Turkey": 0.06,
    "France": 0.15,
    "Netherlands": 0.15,
    "Italy": 0.12,
    "Spain": 0.12,
    "Portugal": 0.1,
    "Germany": 0.15,
    "Austria": 0.14,
    "Czech Republic": 0.08,
    "Hungary": 0.08,
    "Greece": 0.1,
    "Switzerland": 0.3,
    "United Kingdom": 0.2,
    "United States": 0.15,
    "Canada": 0.15,
    "Australia": 0.15,
}

DEFAULT_PER_KM = 0.1

# Per person, per day, for the itinerary's average-spend line. Not a live price.
DAILY_ESTIMATE = {
    "India": {"food": 12, "local": 5, "activities": 7},
    "Singapore": {"food": 30, "local": 8, "activities": 15},
    "United States": {"food": 50, "local": 20, "activities": 25},
    "United Arab Emirates": {"food": 35, "local": 12, "activities": 20},
}
DEFAULT_DAILY = {"food": 30, "local": 10, "activities": 15}

# Cheapest realistic clean hotel room per night, USD. Used only to check whether a budget is feasible.
BUDGET_NIGHT = {
    "India": 25, "Nepal": 20, "Sri Lanka": 25, "Thailand": 30, "Indonesia": 25, "Malaysia": 30,
    "United Arab Emirates": 60, "Singapore": 90, "Hong Kong": 80, "Japan": 70, "South Korea": 60,
    "Turkey": 40, "Maldives": 90, "France": 90, "Netherlands": 100, "Italy": 80, "Spain": 70,
    "Portugal": 60, "Germany": 80, "Austria": 80, "Czech Republic": 50, "Hungary": 50, "Greece": 60,
    "Switzerland": 130, "United Kingdom": 100, "United States": 110, "Canada": 100, "Australia": 100,
}
DEFAULT_BUDGET_NIGHT = 60
