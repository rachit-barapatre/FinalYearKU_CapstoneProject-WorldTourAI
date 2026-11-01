# WorldTour AI

WorldTour is a multi-agent trip planner. You describe a trip in ordinary language; a LangGraph workflow runs flight, hotel, weather, place, route, budget and itinerary agents and returns a day-by-day plan with costs and booking links. Signed-in travellers can save every finished itinerary to **My trips**, reopen, share or delete it, and manage a profile.

## Repository layout

| Folder | What it is | Stack |
| --- | --- | --- |
| `frontend/` | The website | React 19, TypeScript, Vite, Tailwind CSS, Clerk, zustand |
| `server/` | Accounts API: profiles, photos, saved trips, sharing | Express 5, MongoDB Atlas (Mongoose), Clerk, Cloudinary |
| `ai_backend/` | Trip-planning API and terminal app | FastAPI, LangGraph, LangChain tools, OpenRouter (free models only) |

```text
Browser ── Clerk (sign-in)
   ├────── ai_backend/  POST /api/chat, /api/plan, /api/export/*   (planning)
   └────── server/      /api/me, /api/trips, /api/stats, /api/share (accounts, saved trips) ── MongoDB Atlas, Cloudinary
```

Each folder has its own README with details: [frontend](frontend/README.md), [server](server/README.md) (API table and step-by-step deployment), [ai_backend](ai_backend/README.md) (agents, algorithms, providers, limitations).

## Prerequisites

Node.js 20 or newer, Python 3.11 or newer, and free accounts for the services you want to use: OpenRouter (planning text), Clerk (sign-in), MongoDB Atlas and Cloudinary (saved trips and photos). Planning works without Clerk, MongoDB and Cloudinary; the site then runs guest-only.

## Run everything locally

Copy each `.env.example` to `.env` in its folder and fill in your own values. Never commit `.env` files.

```bash
# 1. Planner API  ->  http://127.0.0.1:8000
cd ai_backend
python -m venv .venv
.venv\Scripts\activate            # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
python scripts/serve.py

# 2. Accounts API  ->  http://localhost:5000/api/health   (optional: only for sign-in / My trips)
cd server
npm install
npm run dev

# 3. Website  ->  http://localhost:5173
cd frontend
npm install
npm run dev
```

For sign-in locally set `VITE_SERVER_URL=http://localhost:5000` and `VITE_CLERK_PUBLISHABLE_KEY=pk_test_...` in `frontend/.env`. If MongoDB cannot be reached, run `npm run check:db` in `server/`.

## Environment variables

Names only; see each `.env.example` for descriptions.

- `frontend/.env`: `VITE_API_URL`, `VITE_SERVER_URL`, `VITE_CLERK_PUBLISHABLE_KEY` (all public).
- `server/.env`: `PORT`, `DNS_SERVERS`, `MONGODB_URI`, `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SIGNING_SECRET`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `CLOUDINARY_FOLDER`, optional `ALLOWED_ORIGINS`, `APP_URL`.
- `ai_backend/.env`: `OPENROUTER_API_KEY`, `OPENROUTER_FREE_MODEL`, `SERPAPI_API_KEY`, `AVIATIONSTACK_API_KEY`, `GEOAPIFY_API_KEY`, `OSRM_BASE_URL`, provider selectors, runtime and speed settings, optional `ACCESS_CODE`, `ALLOWED_ORIGINS`, `UPSTASH_REDIS_REST_*`, `PLANS_PER_DAY`.

## Tests and builds

```bash
cd frontend && npm test && npx tsc -b && npm run build && npm run lint
cd server   && npm test
cd ai_backend && pip install -e ".[dev]" && python -m pytest tests
```

All tests run offline; the server API suite downloads a temporary in-memory MongoDB the first time.

## Deployment

Each folder deploys as its own Vercel project (root directory `frontend`, `server`, `ai_backend`). Environment variables, the Atlas network setting (`0.0.0.0/0`), the Clerk webhook and the order to set things up are in [server/README.md](server/README.md#deploy-vercel--step-by-step).

## Security notes

Secrets live only in git-ignored `.env` files and in Vercel's environment settings. The server derives the user from a verified Clerk token and ignores any user id sent by the browser; every trip query is scoped to that user.
