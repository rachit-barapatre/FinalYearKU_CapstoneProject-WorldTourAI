"""Frankfurter exchange rates. No API key."""

from __future__ import annotations

from worldtour_ai.providers.currency.base_currency_provider import BaseCurrencyProvider
from worldtour_ai.utils.exceptions import ProviderError
from worldtour_ai.utils.http import HttpClient


class FrankfurterProvider(BaseCurrencyProvider):
    name = "frankfurter"
    data_source = "live"

    def __init__(self, http: HttpClient | None = None) -> None:
        self.http = http or HttpClient()

    def convert(self, amount: float, source: str, target: str) -> dict:
        source = source.upper()
        target = target.upper()
        if source == target:
            return {"amount": amount, "rate": 1.0, "provider_used": self.name, "data_source": self.data_source}
        payload = self.http.get_json(
            "https://api.frankfurter.dev/v1/latest",
            params={"from": source, "to": target},
            cache_ttl=12 * 3600,
        )
        rate = (payload.get("rates") or {}).get(target)
        if rate is None:
            raise ProviderError(f"No Frankfurter rate for {source} to {target}")
        return {
            "amount": round(amount * float(rate), 2),
            "rate": float(rate),
            "provider_used": self.name,
            "data_source": self.data_source,
        }
