"""FastAPI app: the same chat, workflow and plan as the terminal, over HTTP.

Endpoints
    GET  /api/health        status and whether an access code is required
    POST /api/chat          one chat message -> next question, or ready to plan
    POST /api/plan          run the workflow; streams NDJSON progress events, then the plan
    POST /api/export/text   the plan as plain text
    POST /api/export/ics    the timetable as a calendar file

Protection (all optional, set as environment variables)
    ACCESS_CODE             visitors must send this in the X-Access-Code header
    ALLOWED_ORIGINS         comma-separated frontend URLs allowed by CORS (default *)
    UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
                            enable a per-visitor daily limit on plans (PLANS_PER_DAY, default 10)
"""

from __future__ import annotations

import hmac
import json
import logging
import os
import queue
import threading
import time
from datetime import date

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse, Response, StreamingResponse
from pydantic import BaseModel

from worldtour_ai.config.settings import get_settings
from worldtour_ai.services.chat_session import chat_step
from worldtour_ai.utils.agent_logs import log_event, new_run_id, run_context
from worldtour_ai.services.translate import LANGUAGES, from_english, to_english
from worldtour_ai.services.exporter import file_stem, plan_calendar, plan_text
from worldtour_ai.workflows.state import fresh_state
from worldtour_ai.workflows.travel_graph import build_workflow

app = FastAPI(title="WorldTour API", version="1.0.0")
logger = logging.getLogger("worldtour.web")


@app.middleware("http")
async def json_errors(request: Request, call_next):
    """Turn unexpected crashes into JSON 500s *inside* the CORS layer.

    Without this, an unhandled error is answered by the outermost server-error handler
    without CORS headers, and the browser reports it as a generic network failure.
    Registered before CORSMiddleware so CORS wraps it.
    """
    try:
        return await call_next(request)
    except Exception:
        logger.exception("unhandled error on %s", request.url.path)
        return JSONResponse({"detail": "The planner hit an unexpected error. Please try again."}, status_code=500)


app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "*").split(",") if o.strip()],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "X-Access-Code"],
    expose_headers=["Content-Disposition"],  # lets the browser read download file names cross-site
)
_WORKFLOW = None
HEARTBEAT_SECONDS = 5


def _workflow():
    global _WORKFLOW
    if _WORKFLOW is None:
        _WORKFLOW = build_workflow()
    return _WORKFLOW


class ChatBody(BaseModel):
    session: dict | None = None
    message: str
    # Chat language: en, hi, gu or mr. Replies come back in it; messages in its script are read in English.
    language: str = "en"
    # A signed-in traveler's saved settings: home city (start point) and display currency.
    home_city: str | None = None
    currency: str | None = None


class PlanBody(BaseModel):
    session: dict


class ExportBody(BaseModel):
    plan: dict


def _check_access(request: Request) -> None:
    code = os.environ.get("ACCESS_CODE")
    if code and not hmac.compare_digest(request.headers.get("X-Access-Code", ""), code):
        raise HTTPException(status_code=401, detail="This planner needs an access code.")


def _over_daily_limit(request: Request) -> bool:
    """Per-visitor daily plan limit via Upstash Redis REST. Off unless configured."""
    url, token = os.environ.get("UPSTASH_REDIS_REST_URL"), os.environ.get("UPSTASH_REDIS_REST_TOKEN")
    if not url or not token:
        return False
    visitor = (request.headers.get("x-forwarded-for") or (request.client.host if request.client else "unknown")).split(",")[0].strip()
    key = f"worldtour:plans:{visitor}:{date.today().isoformat()}"
    try:
        response = httpx.post(
            f"{url.rstrip('/')}/pipeline",
            headers={"Authorization": f"Bearer {token}"},
            json=[["INCR", key], ["EXPIRE", key, 86400]],
            timeout=5,
        )
        count = int(response.json()[0]["result"])
    except Exception:
        return False  # never block planning because the limiter is down
    return count > int(os.environ.get("PLANS_PER_DAY", "10"))


@app.get("/")
def root() -> dict:
    """Friendly landing response so the bare API address shows it is alive."""
    return {
        "name": "WorldTour API",
        "status": "ok",
        "health": "/api/health",
        "docs": "/docs",
        "endpoints": ["POST /api/chat", "POST /api/plan", "POST /api/export/text", "POST /api/export/ics"],
    }


@app.get("/api/health")
def health() -> dict:
    settings = get_settings()
    return {
        "status": "ok",
        "access_code_required": bool(os.environ.get("ACCESS_CODE")),
        # Which data sources are configured (never the keys themselves), to explain fallbacks.
        "sources": {
            "live_fares_and_hotels": bool(settings.serpapi_api_key),
            "ai": bool(settings.openrouter_api_key),
            "maps_and_places": bool(settings.geoapify_api_key),
            "flight_schedules": bool(settings.aviationstack_api_key),
        },
    }


@app.post("/api/chat")
def chat(body: ChatBody, request: Request) -> dict:
    _check_access(request)
    if not body.message.strip():
        raise HTTPException(status_code=400, detail="Please type a message.")
    try:
        started = time.perf_counter()
        language = body.language if body.language in LANGUAGES else "en"
        defaults = {"home_city": (body.home_city or "")[:80], "currency": (body.currency or "")[:3]}
        result = chat_step(body.session, to_english(body.message[:2000], language), defaults=defaults)
        if language != "en":
            result["reply_en"] = result["reply"]
            result["reply"] = from_english(result["reply"], language)
        log_event("chat_turn", stage=result["session"].get("stage"), ready=result.get("ready"), asked=result["session"].get("pending"), language=language, duration_ms=round((time.perf_counter() - started) * 1000))
        return result
    except Exception as exc:
        logger.exception("chat step failed")
        log_event("chat_failed", level="error", error_type=type(exc).__name__, error=str(exc))
        raise HTTPException(status_code=500, detail="Sorry, I couldn't process that message. Please try rephrasing it.") from exc


@app.post("/api/plan")
def plan(body: PlanBody, request: Request) -> StreamingResponse:
    _check_access(request)
    session = dict(body.session)
    trip = session.get("request")
    if session.get("stage") != "ready" or not trip:
        raise HTTPException(status_code=400, detail="The chat has not collected a complete trip yet.")
    if _over_daily_limit(request):
        raise HTTPException(status_code=429, detail="Daily plan limit reached for this visitor. Please try again tomorrow.")
    history = session.get("history") or []
    first = next((m["content"] for m in history if m.get("role") == "user"), "trip")

    run_id = new_run_id()

    def run(out: queue.Queue) -> None:
        seen, final = 0, None
        started = time.perf_counter()
        with run_context(run_id):
            log_event("plan_started", origin=trip.get("origin"), destination=trip.get("destination"), days=trip.get("duration_days"), travelers=trip.get("travelers"))
            try:
                state = fresh_state(first, history, trip, ready=True)
                state["run_id"] = run_id
                for snapshot in _workflow().stream(state, stream_mode="values"):
                    final = snapshot
                    events = snapshot.get("agent_execution_history") or []
                    for event in events[seen:]:
                        out.put(("event", event))
                    seen = len(events)
                plan = (final or {}).get("final_plan")
                errors = (final or {}).get("errors") or []
                log_event(
                    "plan_completed" if plan else "plan_failed",
                    level=("warning" if errors else "info") if plan else "error",
                    duration_ms=round((time.perf_counter() - started) * 1000),
                    agent_errors=errors,
                    estimated_cost=(plan or {}).get("estimated_cost"),
                )
                out.put(("done", plan))
            except Exception as exc:  # report, don't hang the browser
                logger.exception("planning failed")
                log_event("plan_failed", level="error", duration_ms=round((time.perf_counter() - started) * 1000), error_type=type(exc).__name__, error=str(exc))
                out.put(("error", f"Planning failed: {exc}"))

    def stream():
        # The workflow runs in a thread; while a slow step (e.g. the AI writer) is busy, a small
        # "ping" line every few seconds keeps proxies and browsers from dropping an idle connection.
        out: queue.Queue = queue.Queue()
        threading.Thread(target=run, args=(out,), daemon=True).start()
        while True:
            try:
                kind, payload = out.get(timeout=HEARTBEAT_SECONDS)
            except queue.Empty:
                yield json.dumps({"type": "ping"}) + "\n"
                continue
            if kind == "event":
                yield json.dumps({"type": "event", "event": payload}, default=str) + "\n"
            elif kind == "error":
                yield json.dumps({"type": "error", "message": payload}) + "\n"
                return
            else:
                if not payload:
                    yield json.dumps({"type": "error", "message": "The planner finished without a plan."}) + "\n"
                else:
                    done = {**session, "stage": "planned"}
                    yield json.dumps({"type": "plan", "plan": payload, "session": done}, default=str) + "\n"
                return

    return StreamingResponse(stream(), media_type="application/x-ndjson", headers={"Cache-Control": "no-store"})


@app.post("/api/export/text")
def export_text(body: ExportBody) -> PlainTextResponse:
    return PlainTextResponse(
        plan_text(body.plan),
        headers={"Content-Disposition": f'attachment; filename="{file_stem(body.plan)}.txt"'},
    )


@app.post("/api/export/ics")
def export_ics(body: ExportBody) -> Response:
    calendar = plan_calendar(body.plan)
    if not calendar:
        raise HTTPException(status_code=400, detail="Add travel dates to get a calendar file.")
    return Response(
        calendar,
        media_type="text/calendar",
        headers={"Content-Disposition": f'attachment; filename="{file_stem(body.plan)}.ics"'},
    )
