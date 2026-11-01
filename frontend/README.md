# WorldTour frontend

React + TypeScript + Vite + Tailwind CSS + Clerk sign-in. Talks to the Python planner in `../ai_backend` and the accounts API in `../server` (saved trips, profile).

## Run locally

```bash
# terminal 1 — the planner API (from ../ai_backend, virtualenv active)
python scripts/serve.py                       # http://127.0.0.1:8000

# terminal 2 — the accounts API (from ../server; only needed for sign-in / My trips)
npm run dev                                   # http://localhost:5000

# terminal 3 — this app
npm install
npm run dev                                   # http://localhost:5173 (proxies /api to :8000)
```

## Build

```bash
npm run build      # type-check + production build into dist/ (+ SEO pages)
npm run lint
npm test           # node tests + vitest component tests
```

## Configuration

Copy `.env.example` to `.env`. All three names are public (they end up in the browser); never put secret keys here.

- `VITE_API_URL` — the deployed planner API (`ai_backend`). Leave it empty locally.
- `VITE_SERVER_URL` — the accounts API (`server`), e.g. `http://localhost:5000` locally.
- `VITE_CLERK_PUBLISHABLE_KEY` — Clerk publishable key (`pk_...`). Without the last two the site runs guest-only.

## Structure

- `src/store.ts` — chat, session and plan state (persisted in the browser)
- `src/lib/api.ts` — planner API calls, including the streamed planning progress
- `src/lib/account.tsx` — signed-in profile/trip calls to the accounts API (token handling, retries)
- `src/lib/tripSync.ts`, `saveRules.ts`, `saveStatus.ts` — saving finished plans to My trips and the save-status bar
- `src/pages/` — `TripPage` (planner), `HistoryPage` (My trips), `ProfilePage`, `SettingsPage`, `AuthPage`, `SharedTrip`
- `src/components/ChatPanel.tsx` — the conversation
- `src/components/PlanningProgress.tsx` — live agent progress
- `src/components/plan/` — Overview (packages, transport, hotels, weather), Day by day (timetable + map), Costs, Book & export
