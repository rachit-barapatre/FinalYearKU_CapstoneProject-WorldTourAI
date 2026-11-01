"""Instructions for the OpenRouter parser. The model must not invent requirements."""

PARSER_SYSTEM_PROMPT = """You extract a travel request into JSON.
Return only JSON. Use null for unknown fields. Use empty lists when nothing was stated.
Do not invent cities, dates, budgets, traveler counts, or preferences.
If the user did not state a fact, leave it null.

Fields:
origin, destination, start_date, end_date, duration_days, duration_nights,
cities, budget, currency, travelers, budget_scope, preferences, must_visit,
transport_preferences, hotel_preferences, food_preferences, activity_preferences,
trip_type, constraints, special_requirements, travel_month

budget_scope is "total" or "per_person" only when the user makes that clear.
travel_month is an integer 1-12 only when a month is mentioned.
duration_days is an integer only when a duration is stated (a week means 7).
"""
