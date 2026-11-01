"""OpenRouter chat client. Only the configured free model is called."""

from __future__ import annotations

import time

from worldtour_ai.config.settings import get_settings
from worldtour_ai.utils.agent_logs import log_api_call
from worldtour_ai.utils.exceptions import ConfigurationError, ProviderError, QuotaExceededError
from worldtour_ai.utils.http import HttpClient


class RateLimitedError(ProviderError):
    def __init__(self, message: str, retry_after: float | None = None) -> None:
        super().__init__(message)
        self.retry_after = retry_after


class OpenRouterProvider:
    name = "openrouter"

    def __init__(self, http: HttpClient | None = None) -> None:
        self.http = http or HttpClient()

    def complete(
        self, system_prompt: str, user_prompt: str, timeout: float | None = None, attempts: int = 1
    ) -> str:
        last_error: ProviderError | None = None
        for attempt in range(max(attempts, 1)):
            try:
                return self._complete_once(system_prompt, user_prompt, timeout)
            except RateLimitedError as exc:
                last_error = exc
                time.sleep(min(exc.retry_after or 5 * (attempt + 1), 20))
            except ProviderError as exc:
                last_error = exc
                if "request failed" not in str(exc) and "returned 5" not in str(exc):
                    raise
        raise last_error or ProviderError("OpenRouter call failed")

    def _complete_once(self, system_prompt: str, user_prompt: str, timeout: float | None) -> str:
        settings = get_settings()
        model = settings.openrouter_free_model
        if not settings.free_model_allowed(model):
            raise ConfigurationError(f"Refusing non-free model: {model}")
        if not settings.openrouter_api_key:
            raise ProviderError("OPENROUTER_API_KEY is not set")
        if settings.disable_network:
            raise ProviderError("Network access is disabled")
        import httpx

        started = time.perf_counter()
        try:
            return self._post(httpx, settings, model, system_prompt, user_prompt, timeout, started)
        except ProviderError as exc:
            log_api_call("openrouter", "https://openrouter.ai/api/v1/chat/completions", status=getattr(exc, "status", None), duration_ms=(time.perf_counter() - started) * 1000, ok=False, error=str(exc), model=model)
            raise

    def _post(self, httpx, settings, model, system_prompt, user_prompt, timeout, started) -> str:
        try:
            response = httpx.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.openrouter_api_key}",
                    "Content-Type": "application/json",
                    "HTTP-Referer": "http://localhost/worldtour",
                    "X-Title": "WorldTour Academic Project",
                },
                json={
                    "model": model,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                },
                timeout=timeout or settings.request_timeout_seconds,
            )
        except httpx.HTTPError as exc:
            raise ProviderError(f"OpenRouter request failed: {exc}") from exc
        if response.status_code == 429:
            if "per-day" in response.text or "free_tier_daily" in response.text:
                raise QuotaExceededError(
                    "OpenRouter daily free-model limit reached (50 requests/day without credits). "
                    "It resets at 00:00 UTC."
                )
            retry_after = response.headers.get("Retry-After")
            raise RateLimitedError(
                "OpenRouter returned 429", float(retry_after) if retry_after and retry_after.isdigit() else None
            )
        if response.status_code >= 400:
            raise ProviderError(f"OpenRouter returned {response.status_code}")
        payload = response.json()
        try:
            content = payload["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise ProviderError("OpenRouter response had no message") from exc
        log_api_call("openrouter", "https://openrouter.ai/api/v1/chat/completions", status=response.status_code, duration_ms=(time.perf_counter() - started) * 1000, ok=True, model=payload.get("model") or model)
        return content
