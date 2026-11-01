"""HTTP helper with timeouts, bounded retries, and redacted debug logs."""

from __future__ import annotations

import hashlib
import time
from typing import Callable

import httpx

from worldtour_ai.config.settings import get_settings
from worldtour_ai.utils.cache import ResponseCache
from worldtour_ai.utils.exceptions import (
    EmptyResultError,
    ProviderError,
    QuotaExceededError,
    RateLimitError,
)
from worldtour_ai.utils.agent_logs import log_api_call, service_for
from worldtour_ai.utils.logging import get_logger

logger = get_logger("worldtour.http")
_cache = ResponseCache()


def redact(text: str) -> str:
    lowered = text
    for marker in ("access_key=", "apiKey=", "api_key=", "Authorization"):
        if marker.lower() in lowered.lower():
            return "[redacted request]"
    return text


def retry(fn: Callable[[], object], attempts: int, base_delay: float = 0.4):
    """Run fn with bounded exponential backoff. attempts is the total try count."""
    last: Exception | None = None
    tries = max(1, attempts)
    for index in range(tries):
        try:
            return fn()
        except (RateLimitError, QuotaExceededError):
            raise
        except ProviderError as exc:
            last = exc
            if index == tries - 1:
                break
            delay = base_delay * (2**index)
            logger.debug("Retrying after provider error (%s) in %.1fs", exc, delay)
            time.sleep(delay)
    assert last is not None
    raise last


class HttpClient:
    """Small wrapper around httpx. Network can be disabled for tests."""

    def __init__(self, timeout: float | None = None) -> None:
        settings = get_settings()
        self.timeout = timeout if timeout is not None else settings.request_timeout_seconds
        self.disable_network = settings.disable_network

    def get_json(
        self,
        url: str,
        params: dict | None = None,
        headers: dict | None = None,
        cache_ttl: int = 0,
        attempts: int | None = None,
    ) -> dict:
        settings = get_settings()
        if self.disable_network or settings.disable_network:
            raise ProviderError("Network access is disabled")

        cache_key = None
        if cache_ttl > 0:
            raw = url + "|" + repr(sorted((params or {}).items()))
            cache_key = hashlib.sha256(raw.encode("utf-8")).hexdigest()
            cached = _cache.get(cache_key)
            if cached is not None:
                logger.debug("Cache hit for %s", redact(url))
                log_api_call(service_for(url), url, status=None, duration_ms=0, ok=True, cached=True)
                return cached

        tries = attempts if attempts is not None else settings.max_retry_attempts
        attempt_no = [0]

        def _once() -> dict:
            logger.debug("GET %s", redact(url))
            attempt_no[0] += 1
            started = time.perf_counter()
            status: int | None = None
            try:
                try:
                    response = httpx.get(url, params=params, headers=headers, timeout=self.timeout)
                except httpx.TimeoutException as exc:
                    raise ProviderError(f"Request timed out after {self.timeout:.0f}s") from exc
                except httpx.HTTPError as exc:
                    raise ProviderError(f"HTTP error: {type(exc).__name__}") from exc
                status = response.status_code
                payload = _check(response)
            except Exception as exc:
                log_api_call(service_for(url), url, status=status, duration_ms=(time.perf_counter() - started) * 1000, ok=False, error=str(exc), attempt=attempt_no[0])
                raise
            log_api_call(service_for(url), url, status=status, duration_ms=(time.perf_counter() - started) * 1000, ok=True, attempt=attempt_no[0])
            return payload

        def _check(response) -> dict:
            if response.status_code == 429:
                raise RateLimitError("Provider rate limit reached")
            if response.status_code in {402, 403} and "quota" in response.text.lower():
                raise QuotaExceededError("Provider quota exhausted")
            if response.status_code >= 500:
                raise ProviderError(f"Provider server error {response.status_code}")
            if response.status_code >= 400:
                raise ProviderError(f"Provider request failed ({response.status_code})")

            try:
                payload = response.json()
            except ValueError as exc:
                raise ProviderError("Provider returned non-JSON data") from exc
            if not isinstance(payload, dict):
                raise ProviderError("Provider JSON was not an object")
            return payload

        try:
            payload = retry(_once, attempts=tries)
        except RateLimitError:
            raise
        if cache_key is not None:
            _cache.set(cache_key, payload, ttl_seconds=cache_ttl)
        return payload


def ensure_records(payload: dict, key: str = "data") -> list:
    records = payload.get(key)
    if not isinstance(records, list) or not records:
        raise EmptyResultError("Provider returned no records")
    return records
