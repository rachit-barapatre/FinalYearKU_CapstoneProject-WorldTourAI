"""OpenRouter chat client. Only the configured free model is called."""

from __future__ import annotations

import json
import re
import time

from worldtour_ai.config.settings import get_settings
from worldtour_ai.utils.agent_logs import log_api_call
from worldtour_ai.utils.exceptions import ConfigurationError, ProviderError, QuotaExceededError
from worldtour_ai.utils.http import HttpClient

_SAFE_METADATA_KEYS = (
    "limit_source", "scope", "limit_usd", "spend_usd", "resets_at",
    "reasons", "provider_name", "model_slug", "error_type",
)
_KEY_PATTERN = re.compile(r"sk-or-[A-Za-z0-9_\-]+")

# Circuit breaker: the free model is often slow or rate limited. After one failure it is skipped for a few minutes,
# so every chat turn and plan does not wait for it again; the built-in parser and summaries cover the gap.
_paused_until = 0.0


def llm_paused() -> bool:
    return time.monotonic() < _paused_until


def pause_llm() -> None:
    """Skip the LLM for LLM_COOLDOWN_SECONDS (also called by callers that gave up waiting for it)."""
    global _paused_until
    seconds = get_settings().llm_cooldown_seconds
    if seconds > 0:
        _paused_until = time.monotonic() + seconds


def resume_llm() -> None:
    global _paused_until
    _paused_until = 0.0


def _redact(text: str, secret: str = "") -> str:
    if secret:
        text = text.replace(secret, "[redacted]")
    return _KEY_PATTERN.sub("[redacted]", text)


def safe_error_detail(response, secret: str = "", limit: int = 300) -> str:
    """Summarise an OpenRouter error body without leaking the API key or echoing user input."""
    try:
        body = response.json()
    except Exception:
        body = None
    parts: list[str] = []
    error = body.get("error") if isinstance(body, dict) else None
    if isinstance(error, dict):
        if error.get("code") is not None:
            parts.append(f"code={error['code']}")
        if error.get("message"):
            parts.append(f"message={error['message']}")
        metadata = error.get("metadata")
        if isinstance(metadata, dict):
            for key in _SAFE_METADATA_KEYS:
                if key in metadata:
                    parts.append(f"{key}={metadata[key]}")
    elif isinstance(body, dict) and body.get("message"):
        parts.append(f"message={body['message']}")
    elif response.text:
        parts.append(f"body={response.text.strip()[:limit]}")
    detail = _redact("; ".join(str(part) for part in parts), secret)
    return detail[:limit]


class RateLimitedError(ProviderError):
    def __init__(self, message: str, retry_after: float | None = None) -> None:
        super().__init__(message)
        self.retry_after = retry_after


class EmptyAnswerError(ProviderError):
    """HTTP 200 with no text (free models sometimes spend their whole budget thinking). Another try may reach a different model."""


class _Reply:
    """The parts of an HTTP answer this client uses (kept separate from httpx so tests can supply one)."""

    def __init__(self, status_code: int, body: bytes, headers: dict | None = None) -> None:
        self.status_code = status_code
        self.text = body.decode("utf-8", errors="replace")
        self.headers = headers or {}

    def json(self):
        return json.loads(self.text)


def _send(url: str, headers: dict, payload: dict, timeout: float) -> _Reply:
    """POST with a real wall-clock limit. httpx timeouts apply per read, so a server that keeps the connection
    alive (as OpenRouter does while a free model is queued) could otherwise hold the request open far past `timeout`."""
    import httpx

    deadline = time.monotonic() + timeout
    try:
        with httpx.stream("POST", url, headers=headers, json=payload, timeout=httpx.Timeout(timeout, connect=min(10.0, timeout))) as response:
            chunks = []
            for chunk in response.iter_bytes():
                if time.monotonic() > deadline:
                    raise ProviderError(f"OpenRouter request failed: no complete answer within {timeout:.0f}s")
                chunks.append(chunk)
            return _Reply(response.status_code, b"".join(chunks), dict(response.headers))
    except httpx.HTTPError as exc:
        raise ProviderError(f"OpenRouter request failed: {type(exc).__name__}") from exc


def _answer_text(payload: dict) -> str:
    """The reply text, whether the model returned a string or a list of content parts. Empty string if there is none."""
    try:
        content = payload["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise ProviderError("OpenRouter response had no message") from exc
    if isinstance(content, list):
        content = "".join(part.get("text", "") for part in content if isinstance(part, dict))
    return content.strip() if isinstance(content, str) else ""


def _transient(error: ProviderError) -> bool:
    text = str(error)
    return "request failed" in text or "returned 5" in text


class OpenRouterProvider:
    name = "openrouter"

    def __init__(self, http: HttpClient | None = None) -> None:
        self.http = http or HttpClient()

    def complete(
        self,
        system_prompt: str,
        user_prompt: str,
        timeout: float | None = None,
        attempts: int = 1,
        max_tokens: int | None = None,
    ) -> str:
        """One free-model answer. `timeout` is a wall-clock limit per attempt.

        Empty answers raise EmptyAnswerError and never pause the LLM. Timeouts, 5xx and rate limits pause it for
        LLM_COOLDOWN_SECONDS once the attempts are used up; a pause is never slept through here.
        """
        if llm_paused():
            raise ProviderError("OpenRouter is paused for a few minutes after a failure")
        tries = max(attempts, 1)
        last_error: ProviderError | None = None
        for attempt in range(tries):
            try:
                result = self._complete_once(system_prompt, user_prompt, timeout, max_tokens)
                resume_llm()
                return result
            except RateLimitedError as exc:
                last_error = exc
                if attempt < tries - 1:  # only wait when another try follows
                    time.sleep(min(exc.retry_after or 5 * (attempt + 1), 20))
            except ProviderError as exc:
                last_error = exc
                if isinstance(exc, (ConfigurationError, EmptyAnswerError)) or not _transient(exc):
                    if isinstance(exc, EmptyAnswerError) and attempt < tries - 1:
                        continue
                    break
        if isinstance(last_error, (RateLimitedError, QuotaExceededError)) or (last_error is not None and _transient(last_error)):
            pause_llm()
        raise last_error or ProviderError("OpenRouter call failed")

    def _complete_once(self, system_prompt: str, user_prompt: str, timeout: float | None, max_tokens: int | None = None) -> str:
        settings = get_settings()
        model = settings.openrouter_free_model
        if not settings.free_model_allowed(model):
            raise ConfigurationError(f"Refusing non-free model: {model}")
        if not settings.openrouter_api_key:
            raise ProviderError("OPENROUTER_API_KEY is not set")
        if settings.disable_network:
            raise ProviderError("Network access is disabled")

        started = time.perf_counter()
        try:
            return self._post(settings, model, system_prompt, user_prompt, timeout, max_tokens, started)
        except ProviderError as exc:
            log_api_call("openrouter", "https://openrouter.ai/api/v1/chat/completions", status=getattr(exc, "status", None), duration_ms=(time.perf_counter() - started) * 1000, ok=False, error=str(exc), model=model)
            raise

    def _post(self, settings, model, system_prompt, user_prompt, timeout, max_tokens, started) -> str:
        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        }
        if max_tokens:
            payload["max_tokens"] = int(max_tokens)
        response = _send(
            "https://openrouter.ai/api/v1/chat/completions",
            {
                "Authorization": f"Bearer {settings.openrouter_api_key}",
                "Content-Type": "application/json",
                "HTTP-Referer": "http://localhost/worldtour",
                "X-Title": "WorldTour Academic Project",
            },
            payload,
            timeout or settings.request_timeout_seconds,
        )
        if response.status_code == 429:
            if "per-day" in response.text or "free_tier_daily" in response.text:
                raise QuotaExceededError(
                    "OpenRouter daily free-model limit reached (50 requests/day without credits). "
                    "It resets at 00:00 UTC."
                )
            retry_after = response.headers.get("Retry-After")
            raise RateLimitedError(
                "OpenRouter returned 429", float(retry_after) if retry_after and str(retry_after).isdigit() else None
            )
        if response.status_code >= 400:
            detail = safe_error_detail(response, settings.openrouter_api_key)
            error = ProviderError(
                f"OpenRouter returned {response.status_code}" + (f" ({detail})" if detail else "")
            )
            error.status = response.status_code
            raise error
        try:
            body = response.json()
        except ValueError as exc:
            raise ProviderError("OpenRouter returned something that is not JSON") from exc
        content = _answer_text(body)
        if not content:
            raise EmptyAnswerError("OpenRouter returned an empty answer")
        log_api_call("openrouter", "https://openrouter.ai/api/v1/chat/completions", status=response.status_code, duration_ms=(time.perf_counter() - started) * 1000, ok=True, model=body.get("model") or model)
        return content
