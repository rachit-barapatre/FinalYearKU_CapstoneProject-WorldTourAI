"""Environment-backed settings. Secrets are never hard-coded."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_ENV_PATH = Path(__file__).resolve().parents[3] / ".env"


class Settings(BaseSettings):
    """Project settings loaded from the environment and an optional .env file."""

    openrouter_api_key: str = ""
    openrouter_free_model: str = "openrouter/free"

    aviationstack_api_key: str = ""
    geoapify_api_key: str = ""
    # SerpApi (free plan: 250 searches/month) gives live Google Flights fares and Google Hotels rates for future dates.
    serpapi_api_key: str = ""
    # Optional contact email for the free MyMemory translation API (raises its daily limit).
    mymemory_email: str = ""
    osrm_base_url: str = "https://router.project-osrm.org"

    flight_provider: str = "aviationstack"
    hotel_provider: str = "openrouter"
    weather_provider: str = "open_meteo"
    routing_provider: str = "osrm"
    places_provider: str = "geoapify"
    currency_provider: str = "frankfurter"

    use_mock_fallback: bool = True
    debug_mode: bool = False
    disable_network: bool = False

    max_retry_attempts: int = 2
    max_replan_attempts: int = 2
    request_timeout_seconds: float = 12.0

    # Speed controls for the free LLM. Slow answers fall back to the built-in text.
    ai_day_descriptions: bool = True
    ai_description_timeout_seconds: float = 45.0
    # The AI reads a message only when the built-in parser left an essential detail out; then it may take
    # this long, because the alternative is asking the traveler a question.
    parser_llm_wait_seconds: float = 20.0

    model_config = SettingsConfigDict(
        env_file=str(_ENV_PATH) if _ENV_PATH.exists() else None,
        env_file_encoding="utf-8",
        extra="ignore",
    )

    def free_model_allowed(self, model: str | None = None) -> bool:
        """Allow only the configured free OpenRouter model or an explicit :free slug."""
        name = (model or self.openrouter_free_model or "").strip().lower()
        if not name:
            return False
        if name != self.openrouter_free_model.strip().lower():
            return name.endswith(":free") or name.endswith("/free")
        return name == "openrouter/free" or name.endswith(":free") or name.endswith("/free")


@lru_cache
def get_settings() -> Settings:
    return Settings()


def reset_settings_cache() -> None:
    get_settings.cache_clear()
