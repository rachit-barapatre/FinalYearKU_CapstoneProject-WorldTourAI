"""Stable registry used by the inspection script."""

from worldtour_ai.agents.budget_agent import BudgetAgent
from worldtour_ai.agents.coordinator_agent import CoordinatorAgent
from worldtour_ai.agents.flight_agent import FlightAgent
from worldtour_ai.agents.hotel_agent import HotelAgent
from worldtour_ai.agents.itinerary_agent import ItineraryAgent
from worldtour_ai.agents.recommendation_agent import RecommendationAgent
from worldtour_ai.agents.route_agent import RouteAgent
from worldtour_ai.agents.transport_agent import TransportAgent
from worldtour_ai.agents.weather_agent import WeatherAgent

AGENTS = [
    CoordinatorAgent,
    FlightAgent,
    TransportAgent,
    HotelAgent,
    BudgetAgent,
    RouteAgent,
    ItineraryAgent,
    WeatherAgent,
    RecommendationAgent,
]
