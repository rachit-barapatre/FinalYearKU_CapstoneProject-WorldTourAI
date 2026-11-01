"""Structured logs for agents and the external APIs they depend on.

Every event is one JSON line: when an agent starts, finishes or fails (with its duration, the
provider it used and any fallback), and every call to an outside service (status, duration,
retries, cache hits). A run_id ties together all events of one plan.

Where the lines go:
  * always stdout, so Vercel → (ai project) → Logs shows them (filter by "agent_failed",
    "api_error" or a run_id);
  * locally also ai/logs/agents-YYYY-MM-DD.jsonl (set AGENT_LOG_FILE=0 to turn the files off,
    AGENT_LOG_DIR to move them). Vercel's file system is read-only, so no files there.

Summarise the files with:  python scripts/agent_report.py  (see --help).

Secrets never reach the logs: URLs lose their query string and key-like values are masked.
"""

from __future__ import annotations

import contextvars
import json
import logging
import os
import re
import sys
import threading
import time
import traceback
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

_run_id: contextvars.ContextVar[str | None] = contextvars.ContextVar("worldtour_run_id", default=None)
_agent: contextvars.ContextVar[str | None] = contextvars.ContextVar("worldtour_agent", default=None)
_lock = threading.Lock()
_stdout = logging.getLogger("worldtour.agents")
if not _stdout.handlers:
    _handler = logging.StreamHandler(sys.stdout)
    _handler.setFormatter(logging.Formatter("%(message)s"))
    _stdout.addHandler(_handler)
    _stdout.setLevel(logging.INFO)
    _stdout.propagate = False

_SECRET_KEYS = re.compile(r"(key|token|secret|password|authorization|signature|access_code)", re.I)
_SECRET_VALUES = re.compile(r"(sk-or-v1-[A-Za-z0-9]{8,}|sk_(?:test|live)_[A-Za-z0-9]{8,}|whsec_[A-Za-z0-9]{8,}|mongodb(?:\+srv)?://[^\s\"']+|Bearer\s+[A-Za-z0-9._-]{8,})")
_ROOT = Path(__file__).resolve().parents[3]  # .../ai


def new_run_id() -> str:
    return uuid.uuid4().hex[:12]


@contextmanager
def run_context(run_id: str | None = None):
    """All events logged inside belong to this plan run."""
    token = _run_id.set(run_id or new_run_id())
    try:
        yield _run_id.get()
    finally:
        _run_id.reset(token)


def current_run_id() -> str | None:
    return _run_id.get()


def endpoint(url: str) -> str:
    """'https://api.example.com/v1/x?api_key=…' → 'api.example.com/v1/x' (no query string, ever)."""
    try:
        parts = urlsplit(url)
        return f"{parts.netloc}{parts.path}"
    except Exception:
        return "unknown"


def _clean(value, depth: int = 0):
    if depth > 4:
        return "…"
    if isinstance(value, dict):
        return {k: ("[redacted]" if _SECRET_KEYS.search(str(k)) else _clean(v, depth + 1)) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_clean(v, depth + 1) for v in list(value)[:20]]
    if isinstance(value, str):
        text = _SECRET_VALUES.sub("[redacted]", value)
        return text if len(text) <= 800 else text[:800] + "…"
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    return _clean(str(value), depth + 1)


def _file_path() -> Path | None:
    if os.environ.get("AGENT_LOG_FILE", "1") == "0" or os.environ.get("VERCEL"):
        return None
    folder = Path(os.environ.get("AGENT_LOG_DIR") or _ROOT / "logs")
    return folder / f"agents-{datetime.now(timezone.utc):%Y-%m-%d}.jsonl"


def log_event(event: str, level: str = "info", **fields) -> dict:
    """Write one structured event. Never raises: logging must not break planning."""
    record = {
        "ts": datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
        "level": level,
        "event": event,
        "run_id": fields.pop("run_id", None) or _run_id.get(),
        "agent": fields.pop("agent", None) or _agent.get(),
        **_clean(fields),
    }
    record = {k: v for k, v in record.items() if v is not None}
    try:
        line = json.dumps(record, ensure_ascii=False, default=str)
        _stdout.log(logging.ERROR if level == "error" else logging.WARNING if level == "warning" else logging.INFO, line)
        path = _file_path()
        if path is not None:
            with _lock:
                path.parent.mkdir(parents=True, exist_ok=True)
                with path.open("a", encoding="utf-8") as handle:
                    handle.write(line + "\n")
    except Exception:  # pragma: no cover - logging is best effort
        pass
    return record


@contextmanager
def agent_span(agent_id: str, run_id: str | None = None):
    """Times one agent run and logs agent_started / agent_completed / agent_failed.

    The block can call span['result'] = <agent output> so the completion line records the
    provider used, data source, fallback reason, warnings and errors the agent reported.
    """
    token_agent = _agent.set(agent_id)
    token_run = _run_id.set(run_id) if run_id and not _run_id.get() else None
    started = time.perf_counter()
    span: dict = {"result": None}
    log_event("agent_started", agent=agent_id)
    try:
        yield span
    except Exception as exc:
        log_event(
            "agent_failed",
            level="error",
            agent=agent_id,
            duration_ms=round((time.perf_counter() - started) * 1000),
            error_type=type(exc).__name__,
            error=str(exc),
            where=_where(exc),
        )
        raise
    else:
        summary = summarise_result(span.get("result"))
        errors = summary.pop("errors", None)
        log_event(
            "agent_degraded" if errors else "agent_completed",
            level="warning" if errors else "info",
            agent=agent_id,
            duration_ms=round((time.perf_counter() - started) * 1000),
            errors=errors,
            **summary,
        )
    finally:
        _agent.reset(token_agent)
        if token_run is not None:
            _run_id.reset(token_run)


def summarise_result(result) -> dict:
    """The parts of an agent's output worth keeping in a log line."""
    if not isinstance(result, dict):
        return {}
    out: dict = {}
    for key, value in result.items():
        if key.endswith("_result") and isinstance(value, dict):
            for field in ("provider_used", "data_source", "fallback_reason", "verified_count"):
                if value.get(field) not in (None, ""):
                    out[field] = value[field]
            if isinstance(value.get("options"), list):
                out["options"] = len(value["options"])
            if isinstance(value.get("days"), list):
                out["days"] = len(value["days"])
            if isinstance(value.get("places"), list):
                out["places"] = len(value["places"])
        elif key.endswith("_result") and value is None:
            out["result"] = "none"
    if result.get("errors"):
        out["errors"] = result["errors"]
    if result.get("warnings"):
        out["warnings"] = result["warnings"][:5]
    return out


def _where(exc: BaseException) -> str:
    """file:line of the innermost frame inside worldtour_ai, to find the failing code quickly."""
    frames = [f for f in traceback.extract_tb(exc.__traceback__) if "worldtour_ai" in f.filename]
    if not frames:
        return ""
    frame = frames[-1]
    short = frame.filename.split("worldtour_ai")[-1].lstrip("/\\")
    return f"{short}:{frame.lineno} in {frame.name}"


def log_api_call(service: str, url: str, *, status: int | None, duration_ms: float, ok: bool, error: str | None = None, attempt: int = 1, cached: bool = False, **extra) -> None:
    """One call to an outside service (flights, hotels, maps, weather, AI model, translation…)."""
    if cached:
        log_event("api_cache_hit", service=service, endpoint=endpoint(url), **extra)
        return
    log_event(
        "api_call" if ok else "api_error",
        level="info" if ok else "warning",
        service=service,
        endpoint=endpoint(url),
        status=status,
        duration_ms=round(duration_ms),
        attempt=attempt,
        error=error,
        **extra,
    )


_SERVICES = {
    "serpapi.com": "serpapi",
    "api.aviationstack.com": "aviationstack",
    "api.geoapify.com": "geoapify",
    "router.project-osrm.org": "osrm",
    "api.open-meteo.com": "open-meteo",
    "archive-api.open-meteo.com": "open-meteo",
    "geocoding-api.open-meteo.com": "open-meteo",
    "api.frankfurter.app": "frankfurter",
    "api.frankfurter.dev": "frankfurter",
    "openrouter.ai": "openrouter",
    "api.mymemory.translated.net": "mymemory",
}


def service_for(url: str) -> str:
    host = urlsplit(url).netloc.lower()
    return next((name for domain, name in _SERVICES.items() if host == domain or host.endswith("." + domain)), host or "unknown")
