"""Tests run offline: no network, no keys, no log files, so they never spend free-tier quota."""

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

for name in ("OPENROUTER_API_KEY", "SERPAPI_API_KEY", "GEOAPIFY_API_KEY", "AVIATIONSTACK_API_KEY", "ACCESS_CODE",
             "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"):
    os.environ[name] = ""
os.environ["DISABLE_NETWORK"] = "true"
os.environ["AGENT_LOG_FILE"] = "0"
