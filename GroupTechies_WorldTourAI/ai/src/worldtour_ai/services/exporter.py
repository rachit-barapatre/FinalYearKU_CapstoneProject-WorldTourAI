"""Save a finished plan as a text file and, when dates are known, a calendar (.ics) file."""

from __future__ import annotations

import io
import re
from contextlib import redirect_stdout
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from worldtour_ai.services.terminal_ui import print_plan

TRIPS_DIR = Path(__file__).resolve().parents[3] / "trips"


def save_plan(plan: dict, directory: Path | None = None) -> list[Path]:
    folder = directory or TRIPS_DIR
    folder.mkdir(parents=True, exist_ok=True)
    stem = file_stem(plan)
    text_path = folder / f"{stem}.txt"
    text_path.write_text(plan_text(plan), encoding="utf-8")
    saved = [text_path]
    calendar = plan_calendar(plan)
    if calendar:
        ics_path = folder / f"{stem}.ics"
        ics_path.write_text(calendar, encoding="utf-8", newline="")
        saved.append(ics_path)
    return saved


def file_stem(plan: dict) -> str:
    return f"{_slug(plan.get('destination') or 'trip')}_{datetime.now().strftime('%Y%m%d-%H%M%S')}"


def plan_text(plan: dict) -> str:
    """The full plan as plain text, exactly as the terminal prints it."""
    buffer = io.StringIO()
    with redirect_stdout(buffer):
        print_plan(plan)
    return buffer.getvalue()


def plan_calendar(plan: dict) -> str | None:
    """An .ics calendar of the timetable, or None when the trip has no dates."""
    start = (plan.get("dates") or {}).get("start_date")
    return _calendar(plan, date.fromisoformat(start)) if start else None


def _calendar(plan: dict, start: date) -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//WorldTour//Trip Planner//EN", "CALSCALE:GREGORIAN"]
    for day in plan.get("daily_itinerary") or []:
        day_date = start + timedelta(days=int(day.get("day") or 1) - 1)
        for index, activity in enumerate(day.get("activities") or []):
            begin = _at(day_date, activity.get("start_minute"))
            end = _at(day_date, activity.get("end_minute"))
            if not begin or not end:
                continue
            lines += [
                "BEGIN:VEVENT",
                f"UID:{day_date.isoformat()}-{index}-{_slug(activity.get('name') or 'item')}@worldtour",
                f"DTSTAMP:{stamp}",
                f"DTSTART:{begin}",
                f"DTEND:{end}",
                f"SUMMARY:{_escape(activity.get('name') or 'Activity')}",
                f"LOCATION:{_escape(day.get('city') or '')}",
                f"DESCRIPTION:{_escape(activity.get('detail') or '')}",
                "END:VEVENT",
            ]
    lines.append("END:VCALENDAR")
    return "\r\n".join(lines) + "\r\n"


def _at(day: date, minute) -> str | None:
    if not isinstance(minute, int):
        return None
    moment = datetime(day.year, day.month, day.day) + timedelta(minutes=minute)
    return moment.strftime("%Y%m%dT%H%M%S")


def _escape(text: str) -> str:
    return str(text).replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(text).lower()).strip("-") or "trip"
