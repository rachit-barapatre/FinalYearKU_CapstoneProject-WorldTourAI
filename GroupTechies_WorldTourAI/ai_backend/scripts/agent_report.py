"""Summarise the agent logs in ai/logs/ (written by worldtour_ai/utils/agent_logs.py).

Usage (from the ai folder):
    venv/Scripts/python scripts/agent_report.py              # last 7 days
    venv/Scripts/python scripts/agent_report.py --days 1     # today only
    venv/Scripts/python scripts/agent_report.py --run 3f2a…  # every event of one plan
    venv/Scripts/python scripts/agent_report.py --errors 50  # more recent errors

On Vercel the same JSON lines are in the project's Logs tab; download them as .jsonl and pass
--file path/to/logs.jsonl to summarise those instead.
"""

from __future__ import annotations

import argparse
import json
import statistics
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

LOGS = Path(__file__).resolve().parents[1] / "logs"


def load(days: int, file: str | None) -> list[dict]:
    paths = [Path(file)] if file else sorted(LOGS.glob("agents-*.jsonl"))
    since = datetime.now(timezone.utc) - timedelta(days=days)
    rows = []
    for path in paths:
        if not file:
            try:
                if datetime.strptime(path.stem[7:], "%Y-%m-%d").replace(tzinfo=timezone.utc) < since - timedelta(days=1):
                    continue
            except ValueError:
                pass
        for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
            line = line.strip()
            if not line.startswith("{"):
                # Vercel exports wrap each line; keep only the JSON part.
                line = line[line.find("{") :] if "{" in line else ""
            try:
                row = json.loads(line)
            except ValueError:
                continue
            if row.get("event") and (file or row.get("ts", "") >= since.isoformat()):
                rows.append(row)
    return rows


def table(title: str, header: list[str], rows: list[list]) -> None:
    print(f"\n{title}")
    if not rows:
        print("  (nothing logged)")
        return
    widths = [max(len(str(x)) for x in col) for col in zip(header, *rows)]
    print("  " + "  ".join(str(h).ljust(w) for h, w in zip(header, widths)))
    print("  " + "  ".join("-" * w for w in widths))
    for row in rows:
        print("  " + "  ".join(str(c).ljust(w) for c, w in zip(row, widths)))


def ms(values: list[float]) -> str:
    return f"{statistics.median(values):.0f}" if values else "-"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--days", type=int, default=7)
    parser.add_argument("--run", help="show every event of one run_id")
    parser.add_argument("--errors", type=int, default=15, help="how many recent errors to list")
    parser.add_argument("--file", help="a .jsonl file (e.g. exported from Vercel) instead of ai/logs")
    args = parser.parse_args()
    rows = load(args.days, args.file)
    if not rows:
        print(f"No agent logs found in {args.file or LOGS}. Plan a trip locally first (logs are written there).")
        return

    if args.run:
        for row in rows:
            if row.get("run_id", "").startswith(args.run):
                rest = {k: v for k, v in row.items() if k not in {"ts", "event", "run_id", "level"}}
                print(f"{row['ts'][11:23]}  {row['level']:<7} {row['event']:<20} {json.dumps(rest, ensure_ascii=False)}")
        return

    plans = [r for r in rows if r["event"] in {"plan_completed", "plan_failed"}]
    print(f"Agent logs: {len(rows)} events, {len({r.get('run_id') for r in rows if r.get('run_id')})} runs, "
          f"{len(plans)} plans ({sum(r['event'] == 'plan_failed' for r in plans)} failed)")

    agents: dict[str, dict] = defaultdict(lambda: {"runs": 0, "failed": 0, "degraded": 0, "ms": [], "providers": Counter(), "fallbacks": 0})
    for r in rows:
        if r["event"] in {"agent_completed", "agent_degraded", "agent_failed"}:
            a = agents[r.get("agent", "?")]
            a["runs"] += 1
            a["failed"] += r["event"] == "agent_failed"
            a["degraded"] += r["event"] == "agent_degraded"
            if r.get("duration_ms") is not None:
                a["ms"].append(r["duration_ms"])
            if r.get("provider_used"):
                a["providers"][r["provider_used"]] += 1
            a["fallbacks"] += bool(r.get("fallback_reason"))
    table(
        "Agents",
        ["agent", "runs", "failed", "with errors", "fallbacks", "median ms", "max ms", "providers used"],
        [[k, v["runs"], v["failed"], v["degraded"], v["fallbacks"], ms(v["ms"]), max(v["ms"], default="-"), ", ".join(f"{p}×{n}" for p, n in v["providers"].most_common(3))]
         for k, v in sorted(agents.items())],
    )

    apis: dict[str, dict] = defaultdict(lambda: {"calls": 0, "errors": 0, "cached": 0, "ms": [], "statuses": Counter()})
    for r in rows:
        if r["event"] in {"api_call", "api_error", "api_cache_hit"}:
            a = apis[r.get("service", "?")]
            if r["event"] == "api_cache_hit":
                a["cached"] += 1
                continue
            a["calls"] += 1
            a["errors"] += r["event"] == "api_error"
            if r.get("duration_ms") is not None:
                a["ms"].append(r["duration_ms"])
            a["statuses"][str(r.get("status") or "no response")] += 1
    table(
        "External APIs",
        ["service", "calls", "errors", "error %", "cache hits", "median ms", "max ms", "status codes"],
        [[k, v["calls"], v["errors"], f"{100 * v['errors'] / v['calls']:.0f}%" if v["calls"] else "-", v["cached"], ms(v["ms"]), max(v["ms"], default="-"),
          ", ".join(f"{s}×{n}" for s, n in v["statuses"].most_common(4))] for k, v in sorted(apis.items())],
    )

    providers = Counter((r.get("kind"), r.get("provider"), r["event"]) for r in rows if r["event"] in {"provider_failed", "provider_empty"})
    table("Provider fallbacks", ["kind", "provider", "what happened", "times"], [[k, p, e.replace("provider_", ""), n] for (k, p, e), n in providers.most_common()])

    slow = sorted((r for r in rows if r["event"] in {"api_call", "api_error"} and r.get("duration_ms")), key=lambda r: -r["duration_ms"])[:8]
    table("Slowest API calls", ["when", "service", "endpoint", "ms", "status"], [[r["ts"][:19], r.get("service"), r.get("endpoint"), r["duration_ms"], r.get("status")] for r in slow])

    errors = [r for r in rows if r["level"] in {"error", "warning"} and r["event"] not in {"api_cache_hit"}][-args.errors:]
    print(f"\nMost recent problems (last {len(errors)})")
    for r in errors:
        what = r.get("agent") or r.get("service") or r.get("provider") or ""
        detail = r.get("error") or r.get("errors") or r.get("agent_errors") or ""
        where = f"  at {r['where']}" if r.get("where") else ""
        print(f"  {r['ts'][:19]}  {r['level']:<7} {r['event']:<22} {what:<22} run {r.get('run_id', '-')}: {str(detail)[:160]}{where}")


if __name__ == "__main__":
    main()
