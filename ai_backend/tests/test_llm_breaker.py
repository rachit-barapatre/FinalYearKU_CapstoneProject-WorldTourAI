"""A slow or failing free LLM is skipped for a while instead of delaying every chat turn and plan."""

import pytest

from worldtour_ai.config.settings import reset_settings_cache
from worldtour_ai.providers.llm import openrouter_provider as llm
from worldtour_ai.providers.llm.openrouter_provider import OpenRouterProvider, _Reply
from worldtour_ai.utils.exceptions import ProviderError


@pytest.fixture(autouse=True)
def configured(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-test-not-a-real-key")
    monkeypatch.setenv("DISABLE_NETWORK", "false")
    monkeypatch.setenv("LLM_COOLDOWN_SECONDS", "300")
    reset_settings_cache()
    llm.resume_llm()
    yield
    llm.resume_llm()
    monkeypatch.undo()
    reset_settings_cache()


def _ok(text):
    import json
    return _Reply(200, json.dumps({"model": "free", "choices": [{"message": {"content": text}}]}).encode())


def test_one_failure_pauses_the_llm_and_later_calls_do_not_touch_the_network(monkeypatch):
    calls = []

    def timeout(*_a, **_k):
        calls.append(1)
        raise ProviderError("OpenRouter request failed: ReadTimeout")

    monkeypatch.setattr(llm, "_send", timeout)
    with pytest.raises(ProviderError):
        OpenRouterProvider().complete("system", "user")
    assert len(calls) == 1 and llm.llm_paused()
    with pytest.raises(ProviderError, match="paused"):
        OpenRouterProvider().complete("system", "user")
    assert len(calls) == 1, "a paused LLM must not be called"


def test_a_success_resumes_the_llm(monkeypatch):
    llm.pause_llm()
    assert llm.llm_paused()
    llm.resume_llm()

    monkeypatch.setattr(llm, "_send", lambda *_a, **_k: _ok("hello"))
    assert OpenRouterProvider().complete("system", "user") == "hello"
    assert not llm.llm_paused()


def test_cooldown_can_be_turned_off(monkeypatch):
    monkeypatch.setenv("LLM_COOLDOWN_SECONDS", "0")
    reset_settings_cache()
    llm.pause_llm()
    assert not llm.llm_paused()
