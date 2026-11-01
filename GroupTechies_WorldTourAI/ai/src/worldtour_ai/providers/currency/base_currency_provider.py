"""Currency conversion interface."""

from __future__ import annotations


class BaseCurrencyProvider:
    name = "base_currency_provider"
    data_source = "unknown"

    def convert(self, amount: float, source: str, target: str) -> dict:
        raise NotImplementedError
