"""Time the day-description step against the real free OpenRouter model (spends about 3 of the 50 daily free requests).

Run from ai_backend with the real .env:   python scripts/measure_day_writer.py [--days 5]

It builds a real timetable for a Goa trip (places are a fixed local list, so only the AI step varies), then runs the
day writer once with the live model and prints wall-clock seconds, requests made, days written and any fallback note.
No key or answer text is printed.
"""

from __future__ import annotations

import argparse
import copy
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "tests"))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=5)
    args = parser.parse_args()

    from worldtour_ai.config.settings import get_settings
    from worldtour_ai.providers.llm.openrouter_provider import llm_paused
    from worldtour_ai.services.day_writer import write_days

    settings = get_settings()
    if not settings.openrouter_api_key:
        print("OPENROUTER_API_KEY: EMPTY - nothing to measure")
        return 1
    import test_day_writer as fixtures  # reuses the offline Goa trip builder

    plan, _events, errors = fixtures.run_plan(
        f"Plan a {args.days} day trip from Ahmedabad to Goa for 2 people, starting 2026-12-10, budget 90000 INR, we like beaches and food"
    )
    if not plan:
        print("could not build a timetable:", errors)
        return 1
    days = copy.deepcopy(plan["daily_itinerary"])
    print(f"OPENROUTER_API_KEY: SET, paused={llm_paused()}, deadline={settings.ai_description_timeout_seconds:.0f}s, "
          f"{settings.ai_days_per_request} days/request, {settings.ai_parallel_requests} in parallel")
    started = time.perf_counter()
    result = write_days(days, {"destination": "Goa", "travelers": 2, "pace": "balanced"}, {}, lambda v: f"Rs {v:.0f}")
    print(f"wall-clock {time.perf_counter() - started:.1f}s | requests {result.calls} | days written {result.written}/{result.total}")
    for note in result.notes:
        print("note:", note)
    return 0 if result.written else 2


if __name__ == "__main__":
    raise SystemExit(main())
