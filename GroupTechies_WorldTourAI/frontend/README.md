# WorldTour frontend

React + TypeScript + Vite + Tailwind CSS. Talks to the Python API in `../ai`.

## Run locally

```bash
# terminal 1 — the API (from ../ai)
venv\Scripts\python scripts\serve.py          # http://127.0.0.1:8000

# terminal 2 — this app
npm install
npm run dev                                   # http://localhost:5173 (proxies /api to :8000)
```

## Build

```bash
npm run build      # type-check + production build into dist/
npm run lint
```

## Configuration

`VITE_API_URL` — the deployed API address (for example `https://worldtour-api.vercel.app`). Leave it empty locally.
It is public; never put API keys in frontend variables.

## Structure

- `src/store.ts` — chat, session and plan state (persisted in the browser)
- `src/lib/api.ts` — API calls, including the streamed planning progress
- `src/components/ChatPanel.tsx` — the conversation
- `src/components/PlanningProgress.tsx` — live agent progress
- `src/components/plan/` — Overview (packages, transport, hotels, weather), Day by day (timetable + map), Costs, Book & export
