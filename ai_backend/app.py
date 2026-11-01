"""Entry point for Vercel (and local runs): exposes the FastAPI app as `app`.

Vercel detects a FastAPI instance named `app` in a root-level app.py and routes every
request path to it, so no rewrites are needed.
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "src"))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(ROOT / ".env")  # local development only; on Vercel the dashboard variables are used

from worldtour_ai.web.app import app  # noqa: E402,F401
