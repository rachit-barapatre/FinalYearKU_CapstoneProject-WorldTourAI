"""Approximate fallback rates. Labeled so they are not shown as live quotes."""

from __future__ import annotations

from worldtour_ai.providers.currency.base_currency_provider import BaseCurrencyProvider

_PER_USD = {
    "USD": 1.0,
    "EUR": 0.92,
    "GBP": 0.78,
    "INR": 83.0,
    "JPY": 149.0,
    "SGD": 1.34,
    "THB": 34.0,
    "AED": 3.67,
}


class StaticCurrencyProvider(BaseCurrencyProvider):
    name = "static_currency_fallback"
    data_source = "fallback_rates"

    def convert(self, amount: float, source: str, target: str) -> dict:
        source = source.upper()
        target = target.upper()
        if source not in _PER_USD or target not in _PER_USD:
            raise ValueError(f"Unsupported fallback currency: {source}->{target}")
        rate = _PER_USD[target] / _PER_USD[source]
        return {
            "amount": round(amount * rate, 2),
            "rate": rate,
            "provider_used": self.name,
            "data_source": self.data_source,
            "note": "Approximate fallback rate, not a live Frankfurter quote.",
        }
