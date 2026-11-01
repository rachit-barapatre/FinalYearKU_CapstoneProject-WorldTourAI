"""Small JSON file cache so scarce API quotas are not spent twice."""

from __future__ import annotations

import json
import os
import time
from pathlib import Path


class ResponseCache:
    def __init__(self, directory: Path | None = None) -> None:
        root = Path(__file__).resolve().parents[3]  # the ai/ project folder
        # Serverless hosts (Vercel) only allow writing to /tmp; CACHE_DIR overrides both.
        default = Path("/tmp/worldtour-cache") if os.environ.get("VERCEL") else root / ".cache"
        self.directory = directory or Path(os.environ.get("CACHE_DIR") or default)

    def _path(self, key: str) -> Path:
        return self.directory / f"{key}.json"

    def get(self, key: str) -> dict | None:
        path = self._path(key)
        if not path.exists():
            return None
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None
        if payload.get("expires_at", 0) < time.time():
            return None
        value = payload.get("value")
        return value if isinstance(value, dict) else None

    def set(self, key: str, value: dict, ttl_seconds: int) -> None:
        body = {"expires_at": time.time() + ttl_seconds, "value": value}
        try:
            self.directory.mkdir(parents=True, exist_ok=True)
            self._path(key).write_text(json.dumps(body), encoding="utf-8")
        except OSError:
            pass  # caching is an optimization; a read-only disk must not break planning
