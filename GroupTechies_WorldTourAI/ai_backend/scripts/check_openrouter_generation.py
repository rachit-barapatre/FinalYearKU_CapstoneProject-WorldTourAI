"""Does OpenRouter actually GENERATE text with the configured free model? (check_openrouter_key.py only checks the key.)

Sends ONE tiny request (max 20 tokens) and, with --long, ONE more with a prompt about the size of the day-by-day
writer's. Each uses one request of the free daily allowance (about 50/day without credits). Never prints the key.

Run from ai_backend:  python scripts/check_openrouter_generation.py [--long]
"""
import json
import re
import sys
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from worldtour_ai.config.settings import get_settings  # noqa: E402
from worldtour_ai.providers.llm.openrouter_provider import safe_error_detail  # noqa: E402

settings = get_settings()
key, model = settings.openrouter_api_key, settings.openrouter_free_model
print(f"key present: {bool(key)} | model: {model} | free-only allowed: {settings.free_model_allowed(model)}")
if not key or not settings.free_model_allowed(model):
    raise SystemExit("Nothing sent: no key, or the model is not a free one.")


def ask(label: str, prompt: str, max_tokens: int, timeout: float) -> None:
    started = time.perf_counter()
    try:
        r = httpx.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json", "X-Title": "WorldTour check"},
            json={"model": model, "max_tokens": max_tokens, "messages": [{"role": "user", "content": prompt}]},
            timeout=timeout,
        )
    except httpx.HTTPError as exc:
        print(f"{label}: FAILED after {time.perf_counter() - started:.1f}s - {type(exc).__name__} (timeout was {timeout:.0f}s)")
        return
    took = time.perf_counter() - started
    if r.status_code != 200:
        print(f"{label}: HTTP {r.status_code} after {took:.1f}s - {safe_error_detail(r, key)}")
        return
    body = r.json()
    text = (body.get("choices") or [{}])[0].get("message", {}).get("content") or ""
    text = re.sub(r"sk-or-[\w\-]+", "[redacted]", text)
    print(f"{label}: HTTP 200 in {took:.1f}s | served by: {body.get('model')} | reply: {text.strip()[:80]!r}")


ask("tiny request", "Reply with the single word OK.", 20, 90)
if "--long" in sys.argv:
    days = "\n".join(f"Day {n}: arrival, two sights, lunch, dinner, hotel in Jaipur." for n in range(1, 5))
    ask("writer-sized request", f"Write one friendly sentence for each day of this itinerary as JSON.\n{days}", 600, 120)
