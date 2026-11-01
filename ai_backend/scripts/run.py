"""Interactive WorldTour terminal application."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")

from worldtour_ai.services.exporter import save_plan
from worldtour_ai.services.intake import apply_refinement, collect_request, resolve_feasibility
from worldtour_ai.services.terminal_ui import banner, format_event, print_plan, print_request_summary, section
from worldtour_ai.workflows.state import fresh_state
from worldtour_ai.workflows.travel_graph import build_workflow

EXIT_WORDS = {"n", "no", "exit", "quit", "done", "bye", "goodbye"}
NEW_WORDS = {"new", "new trip", "another", "another trip", "plan another trip", "y", "yes"}
SAVE_WORDS = {"save", "export", "save plan", "save it"}

NEXT_STEPS = """
What would you like to do next? For example:
  premium / balanced / budget      switch package
  more relaxed / more activities   change the pace
  remove <place name>              drop a place from the plan
  add beaches / we like food       add interests
  budget 50000 INR / 3 people / 12-18 Dec / 5 days  change details
  by train / by bus / by cab / fly  change how you travel
  save                             save the plan (text + calendar file)
  new                              plan a different trip
  exit                             quit"""


def _configure_stdio() -> None:
    for stream in (sys.stdout, sys.stdin):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure:
            try:
                reconfigure(encoding="utf-8", errors="replace")
            except Exception:
                pass


def _read_line(prompt: str) -> str | None:
    try:
        return input(prompt)
    except EOFError:
        print()
        return None


def _ask(question: str) -> str | None:
    print()
    print(question)
    return _read_line("> ")


def _run_graph(app, text: str, history: list[dict], request: dict) -> dict:
    state = fresh_state(text, history, request, ready=True)
    final = None
    seen = 0
    for snapshot in app.stream(state, stream_mode="values"):
        final = snapshot
        events = snapshot.get("agent_execution_history") or []
        for event in events[seen:]:
            print(format_event(event))
        seen = len(events)
    return final or state


def refine(app, text: str, history: list[dict], request: dict, final: dict) -> str:
    """Let the user adjust or save the plan. Returns "new" or "exit"."""
    plan = final.get("final_plan")
    while True:
        print(NEXT_STEPS)
        answer = _read_line("> ")
        if answer is None:
            return "exit"
        lowered = answer.strip().lower()
        if lowered in EXIT_WORDS:
            return "exit"
        if lowered in NEW_WORDS:
            return "new"
        if not lowered:
            continue
        if lowered in SAVE_WORDS:
            if not plan:
                print("There is no plan to save yet.")
                continue
            paths = save_plan(plan)
            print("Saved:")
            for path in paths:
                print(f"  {path}")
            if len(paths) == 1:
                print("  (Add travel dates to also get a calendar file.)")
            continue
        updated, changes = apply_refinement(request, answer)
        if not changes:
            print("I didn't catch a change there. Try one of the examples below, or 'new' for a different trip.")
            continue
        history = history + [{"role": "user", "content": answer}]
        checked = resolve_feasibility(updated, _ask, history)
        if checked is None:
            return "exit"
        request = checked
        section("UPDATING THE PLAN: " + "; ".join(changes))
        final = _run_graph(app, text, history, request)
        plan = final.get("final_plan")
        if plan:
            print_plan(plan)


def main() -> None:
    _configure_stdio()
    banner()
    app = build_workflow()
    while True:
        print("Enter your travel request:")
        text = _read_line("> ")
        if text is None or text.strip().lower() in EXIT_WORDS:
            print("Goodbye.")
            return
        if not text.strip():
            print("Please describe the trip you want.")
            continue
        request, history = collect_request(text.strip(), _ask)
        if request is None:
            print("Goodbye.")
            return
        print_request_summary(request)
        section("WORKFLOW STARTED")
        final = _run_graph(app, text.strip(), history, request)
        if final.get("final_plan"):
            print_plan(final["final_plan"])
        if refine(app, text.strip(), history, request, final) == "exit":
            print("Goodbye.")
            return
        print()


if __name__ == "__main__":
    main()
