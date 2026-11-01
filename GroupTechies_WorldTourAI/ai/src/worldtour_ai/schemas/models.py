"""Flexible travel models. Unknown user fields stay null instead of being invented."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class TravelRequest(BaseModel):
    origin: str | None = None
    destination: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    duration_days: int | None = None
    duration_nights: int | None = None
    cities: list[str] = Field(default_factory=list)
    budget: float | None = None
    currency: str | None = None
    currency_assumed: bool = False
    travelers: int | None = None
    budget_scope: str | None = None
    budget_is_user_stated: bool = False
    preferences: list[str] = Field(default_factory=list)
    must_visit: list[str] = Field(default_factory=list)
    transport_preferences: list[str] = Field(default_factory=list)
    hotel_preferences: list[str] = Field(default_factory=list)
    food_preferences: list[str] = Field(default_factory=list)
    activity_preferences: list[str] = Field(default_factory=list)
    trip_type: str | None = None
    constraints: list[str] = Field(default_factory=list)
    special_requirements: list[str] = Field(default_factory=list)
    travel_month: int | None = None
    pace: str | None = None  # relaxed | balanced | packed
    package_choice: str | None = None  # budget | balanced | premium, set when the user picks one
    excluded_places: list[str] = Field(default_factory=list)
    accepted_risks: list[str] = Field(default_factory=list)  # feasibility warnings the user chose to accept
    cities_are_suggestions: bool = False
    parser_notes: list[str] = Field(default_factory=list)
    parser_mode: str | None = None
    # A signed-in traveler's saved display currency (Settings); the currency they write still wins.
    preferred_currency: str | None = None


class FlightOption(BaseModel):
    option_id: str
    airline: str | None = None
    flight_number: str | None = None
    origin: str | None = None
    destination: str | None = None
    departure_airport: str | None = None
    arrival_airport: str | None = None
    departure_time: str | None = None
    arrival_time: str | None = None
    duration_minutes: int | None = None
    stops: int | None = None
    price: float | None = None
    currency: str | None = None
    price_is_estimate: bool = False
    score: float | None = None
    data_source: str = "unknown"


class HotelOption(BaseModel):
    option_id: str
    name: str
    city: str | None = None
    price_per_night: float | None = None
    currency: str | None = None
    rating: float | None = None
    location: str | None = None
    distance_to_center_km: float | None = None
    lat: float | None = None
    lon: float | None = None
    score: float | None = None
    data_source: str = "unknown"


class BudgetResult(BaseModel):
    capacity: int
    total_cost: float
    total_value: float
    selected_items: list[dict[str, Any]] = Field(default_factory=list)
    rejected_items: list[dict[str, Any]] = Field(default_factory=list)
    exact: bool = True
    currency: str | None = None
    user_budget: float | None = None
    planning_budget_is_assumption: bool = False


class RouteResult(BaseModel):
    provider_used: str
    data_source: str
    distance_km: float | None = None
    duration_minutes: float | None = None
    dijkstra_path: list[str] = Field(default_factory=list)
    dijkstra_cost_km: float | None = None
    astar_path: list[str] = Field(default_factory=list)
    astar_cost_km: float | None = None
    places: list[dict[str, Any]] = Field(default_factory=list)
    note: str = (
        "OSRM or the local fallback supplied edge data. "
        "WorldTour ran its own Dijkstra and A* implementations."
    )


class ItineraryActivity(BaseModel):
    activity_id: str
    name: str
    day: int
    start_minute: int
    end_minute: int
    category: str | None = None
    location: str | None = None
    notes: str | None = None


class DailyItinerary(BaseModel):
    day: int
    date: str | None = None
    city: str | None = None
    activities: list[ItineraryActivity] = Field(default_factory=list)
    summary: str | None = None


class WeatherForecast(BaseModel):
    location: str
    data_source: str
    days: list[dict[str, Any]] = Field(default_factory=list)
    summary: str | None = None
    warning: str | None = None


class Recommendation(BaseModel):
    place_id: str
    name: str
    category: str | None = None
    city: str | None = None
    lat: float | None = None
    lon: float | None = None
    rating: float | None = None
    score: float | None = None
    data_source: str = "unknown"


class AgentResult(BaseModel):
    agent_id: str
    success: bool
    data: dict[str, Any] = Field(default_factory=dict)
    algorithms_executed: list[str] = Field(default_factory=list)
    provider_used: str | None = None
    data_source: str | None = None
    warnings: list[str] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)


class FinalPlan(BaseModel):
    trip_summary: str
    origin: str | None = None
    destination: str | None = None
    dates: dict[str, Any] = Field(default_factory=dict)
    duration: dict[str, Any] = Field(default_factory=dict)
    travelers: int | None = None
    budget: dict[str, Any] = Field(default_factory=dict)
    selected_flights: list[dict[str, Any]] = Field(default_factory=list)
    selected_hotels: list[dict[str, Any]] = Field(default_factory=list)
    cities: list[str] = Field(default_factory=list)
    routes: dict[str, Any] = Field(default_factory=dict)
    daily_itinerary: list[dict[str, Any]] = Field(default_factory=list)
    attractions: list[dict[str, Any]] = Field(default_factory=list)
    weather_information: dict[str, Any] = Field(default_factory=dict)
    estimated_cost: float | None = None
    remaining_budget: float | None = None
    warnings: list[str] = Field(default_factory=list)
    constraint_violations: list[dict[str, Any]] = Field(default_factory=list)
    optimization_explanation: str = ""
    algorithms_actually_used: list[str] = Field(default_factory=list)
    provider_information: list[dict[str, Any]] = Field(default_factory=list)
    replanning_history: list[dict[str, Any]] = Field(default_factory=list)
    optimization_metrics: dict[str, Any] = Field(default_factory=dict)
