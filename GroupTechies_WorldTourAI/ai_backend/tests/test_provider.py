"""OpenRouter client behaviour on the awkward answers the free models really produce (no network)."""

import json

import pytest

from worldtour_ai.config.settings import reset_settings_cache
from worldtour_ai.providers.llm import openrouter_provider as llm
from worldtour_ai.providers.llm.openrouter_provider import EmptyAnswerError, OpenRouterProvider, RateLimitedError, _Reply
from worldtour_ai.utils.exceptions import ProviderError, QuotaExceededError


@pytest.fixture(autouse=True)
def configured(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-test-not-a-real-key")
    monkeypatch.setenv("DISABLE_NETWORK", "false")
    monkeypatch.setenv("LLM_COOLDOWN_SECONDS", "300")
    reset_settings_cache()
    llm.resume_llm()
    monkeypatch.setattr(llm.time, "sleep", lambda *_: pytest.fail("slept when no retry follows"))
    yield
    llm.resume_llm()
    monkeypatch.undo()
    reset_settings_cache()


def reply(content, status=200, headers=None, raw=None):
    body = raw if raw is not None else json.dumps({"model": "m", "choices": [{"message": {"content": content}}]})
    return _Reply(status, body.encode(), headers)


def test_empty_answer_is_an_error_but_does_not_pause_the_llm(monkeypatch):
    monkeypatch.setattr(llm, "_send", lambda *a, **k: reply(""))
    with pytest.raises(EmptyAnswerError):
        OpenRouterProvider().complete("s", "u")
    assert not llm.llm_paused()


def test_empty_answer_is_retried_when_attempts_remain(monkeypatch):
    answers = iter(["", "second time lucky"])
    monkeypatch.setattr(llm, "_send", lambda *a, **k: reply(next(answers)))
    assert OpenRouterProvider().complete("s", "u", attempts=2) == "second time lucky"


def test_content_parts_list_is_joined(monkeypatch):
    parts = [{"type": "text", "text": "hel"}, {"type": "text", "text": "lo"}]
    monkeypatch.setattr(llm, "_send", lambda *a, **k: reply(parts))
    assert OpenRouterProvider().complete("s", "u") == "hello"


def test_null_content_is_treated_as_empty(monkeypatch):
    monkeypatch.setattr(llm, "_send", lambda *a, **k: reply(None))
    with pytest.raises(EmptyAnswerError):
        OpenRouterProvider().complete("s", "u")


def test_response_without_choices_is_a_provider_error(monkeypatch):
    monkeypatch.setattr(llm, "_send", lambda *a, **k: reply(None, raw='{"error": "x"}'))
    with pytest.raises(ProviderError):
        OpenRouterProvider().complete("s", "u")


def test_non_json_body_is_a_provider_error(monkeypatch):
    monkeypatch.setattr(llm, "_send", lambda *a, **k: reply(None, raw="<html>gateway</html>"))
    with pytest.raises(ProviderError, match="not JSON"):
        OpenRouterProvider().complete("s", "u")


def test_rate_limit_does_not_sleep_after_the_last_attempt_and_pauses(monkeypatch):
    monkeypatch.setattr(llm, "_send", lambda *a, **k: reply(None, 429, {"Retry-After": "30"}, raw="{}"))
    with pytest.raises(RateLimitedError):
        OpenRouterProvider().complete("s", "u", attempts=1)
    assert llm.llm_paused()


def test_rate_limit_waits_only_between_attempts(monkeypatch):
    sleeps = []
    monkeypatch.setattr(llm.time, "sleep", lambda s: sleeps.append(s))
    answers = iter([reply(None, 429, {"Retry-After": "2"}, raw="{}"), reply("fine")])
    monkeypatch.setattr(llm, "_send", lambda *a, **k: next(answers))
    assert OpenRouterProvider().complete("s", "u", attempts=2) == "fine"
    assert sleeps == [2.0]


def test_daily_quota_is_reported_and_pauses(monkeypatch):
    monkeypatch.setattr(llm, "_send", lambda *a, **k: reply(None, 429, raw='{"error":"free_tier_daily"}'))
    with pytest.raises(QuotaExceededError):
        OpenRouterProvider().complete("s", "u")
    assert llm.llm_paused()


def test_server_error_pauses_but_a_403_model_refusal_does_not(monkeypatch):
    monkeypatch.setattr(llm, "_send", lambda *a, **k: reply(None, 403, raw='{"error":{"message":"agentic harness only"}}'))
    with pytest.raises(ProviderError):
        OpenRouterProvider().complete("s", "u")
    assert not llm.llm_paused()
    monkeypatch.setattr(llm, "_send", lambda *a, **k: reply(None, 503, raw="{}"))
    with pytest.raises(ProviderError):
        OpenRouterProvider().complete("s", "u")
    assert llm.llm_paused()


def test_max_tokens_and_timeout_are_sent(monkeypatch):
    seen = {}

    def send(url, headers, payload, timeout):
        seen.update(payload=payload, timeout=timeout)
        return reply("ok")

    monkeypatch.setattr(llm, "_send", send)
    OpenRouterProvider().complete("s", "u", timeout=17, max_tokens=500)
    assert seen["payload"]["max_tokens"] == 500 and seen["timeout"] == 17
