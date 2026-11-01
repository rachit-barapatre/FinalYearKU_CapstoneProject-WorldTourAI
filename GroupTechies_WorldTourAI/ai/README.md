# WorldTour

WorldTour is a terminal-based multi-agent travel optimization system. You describe a trip in ordinary language. A LangGraph workflow parses the request, checks constraints, and runs only the agents that the trip needs. Deterministic algorithms — not the language model — rank flights, pick hotels, pack the budget, search routes, and schedule days.

This repository is the agentic planning subsystem. It does not include accounts, a web UI, payments, or deployment.

## Why this is an optimization problem

A trip is a set of choices with limits: money, days, opening hours, distance, and weather. WorldTour scores options with explicit weights (cost, duration, distance, rating, preference match, weather suitability, convenience) and then solves constrained subproblems:

- which optional activities fit in the remaining budget
- which path through the constructed graph is shortest
- which activities can share a day without overlapping

The result is one feasible plan under those weights. It is not claimed to be universally the best trip.

## Multi-agent architecture

```text
User text
  -> Request parser
  -> Constraint validator
  -> Coordinator (LangGraph StateGraph)
  -> Flight, Hotel, Weather, Recommendation (only if required)
  -> Route (also measures distances between trip cities)
  -> Budget
  -> Itinerary
  -> Weather conflict check
  -> Replan (at most twice)
  -> Final plan
```

Agents call LangChain tools. Tools call provider interfaces. Providers call external APIs or a labeled fallback. Algorithms live under `src/worldtour_ai/algorithms/` and are executed by the tools.

## Agents

| ID | Role |
| --- | --- |
| `COORDINATOR_AGENT` | Chooses which agents to run and tracks the workflow |
| `FLIGHT_AGENT` | Retrieves aviation records and ranks them |
| `HOTEL_AGENT` | Asks OpenRouter for real hotels in each trip city, locates them on Geoapify, keeps the top matches |
| `BUDGET_AGENT` | Reserves flights, hotels, and travel between cities, then packs paid activities into what is left |
| `ROUTE_AGENT` | Builds a graph and searches it |
| `ITINERARY_AGENT` | Lays activities onto days |
| `WEATHER_AGENT` | Retrieves forecast or seasonal history and supports conflict checks |
| `RECOMMENDATION_AGENT` | Finds and ranks places |

`scripts/inspect_agents.py` prints each agent's responsibilities, algorithms, tools, provider, and LLM role.

## DSA mapping

| Component | Algorithm | Why |
| --- | --- | --- |
| Flight Agent | Priority queue, sorting | Rank every option by the weighted score |
| Hotel Agent | Heap, Top-K, sorting | Keep the best few hotels without a full sort as the selection method |
| Budget Agent | 0/1 knapsack (dynamic programming) | Choose each optional item at most once under a capacity |
| Route Agent | Dijkstra and A* | Shortest path on the graph WorldTour builds. A* uses Haversine as a geographic heuristic |
| Itinerary Agent | Greedy interval scheduling | The LLM picks recommended places for each day. Interval scheduling only drops overlaps |
| Recommendation Agent | BFS, DFS, Top-K, sorting | Walk a category graph of places, then keep the best matches |
| Weather Agent | Constraint checking | Compare outdoor activities with wet or stormy days |
| Coordinator | LangGraph StateGraph | The workflow itself is the control structure |

Weather retrieval is not dynamic programming. Dynamic programming runs only inside the knapsack implementation.

## API services are not the project algorithms

Aviationstack provides external flight and aviation data. It does not perform WorldTour's optimization algorithms. The free plan is real-time aviation data for personal use, with a small monthly quota. It is not a booking API and it does not return future fares. When a price is missing, a labeled planning estimate is used. When there is no direct record, one- or two-stop options are joined from real Aviationstack records (for example AMD -> DEL -> DXB -> LAX); connection times are not guaranteed. When the API is unavailable, the plan has no flights and says so.

Hotels come from the free OpenRouter model, which names real hotels that match the request (city, travelers, trip style, budget, interests) with a typical nightly rate. Each name is geocoded with Geoapify; hotels that cannot be located are marked unverified. Rates are model estimates, not live availability. If OpenRouter is unavailable (for example the 50-requests-per-day free limit), Geoapify accommodation records (without rates) are used.

OSRM provides external routing data and services (`route`, `table`, `trip`), including real-time route calculation from its road network. It is not a live-traffic service. Dijkstra and A* are implemented independently inside WorldTour, in `algorithms/graphs/`, using `heapq`, `dict`, `set`, and `list`. OSRM edge weights are inputs to that graph. The public OSRM server is the default `OSRM_BASE_URL`.

Open-Meteo supplies the forecast. Dates outside the forecast window use Open-Meteo's historical archive and are labeled seasonal historical weather, not a live forecast.

Geoapify supplies place search when `GEOAPIFY_API_KEY` is set. Without it, the plan has no attractions.

Frankfurter supplies exchange rates with no key. If it cannot be reached, approximate fallback rates are labeled as fallback rates.

## LangChain, LangGraph, and OpenRouter

LangChain (`langchain-core` tools) is the tool boundary. Each agent invokes a tool. The tool runs Python algorithms or a provider. The language model is not asked to invent a shortest path, a knapsack solution, or a schedule.

LangGraph owns the workflow: a `StateGraph` with conditional edges for missing information, and a replan loop capped by `MAX_REPLAN_ATTEMPTS` (default 2).

OpenRouter is the only LLM integration. The client sends `OPENROUTER_FREE_MODEL` (default `openrouter/free`) and refuses a model name that is not that configured free model or an explicit `:free` / `/free` slug. It never switches to a paid model. If no key is set, the heuristic parser is used and the plan records `parser_mode: heuristic`. The parser drops model fields that are not grounded in the user's text.

## Live data only

```text
Real provider -> bounded retry -> (failure) agent reports it -> workflow continues
```

There is no mock data. If Aviationstack, the hotel providers, Open-Meteo or Geoapify fail, that part of the plan is left out and a warning explains why. Only two computed fallbacks remain:

- local graph distances (Haversine) when OSRM cannot be reached
- static currency rates when Frankfurter cannot be reached

`USE_MOCK_FALLBACK=true` (the name is kept for compatibility) enables those two fallbacks.

## Folder structure

```text
ai/
  src/worldtour_ai/
    agents/          eight primary agents
    algorithms/      graphs, knapsack, interval scheduling, heaps, sorting, traversal
    tools/           LangChain tools
    providers/       flights, hotels, weather, routing, places, currency, llm
    workflows/       LangGraph state and graph
    schemas/         Pydantic models
    services/        parser, constraints, scoring, final plan, terminal output
    prompts/         parser instructions
    config/          environment settings
  scripts/run.py                 interactive application
  scripts/inspect_agents.py      agent metadata
  scripts/check_providers.py     live provider check
```

## Installation

From the `ai` directory:

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
```

On macOS or Linux, activate with `source .venv/bin/activate` and copy the example env with `cp .env.example .env`.

## Environment variables

See `.env.example`.

- `SERPAPI_API_KEY` (recommended, free plan 250 searches/month): live Google Flights fares and Google Hotels rates for your exact dates. About 3 searches per plan. Sign up at https://serpapi.com/users/sign_up
- `OPENROUTER_API_KEY`, `OPENROUTER_FREE_MODEL`
- `AVIATIONSTACK_API_KEY` (fallback when SerpApi is not set or out of searches: current schedules, estimated fares)
- `GEOAPIFY_API_KEY`
- `OSRM_BASE_URL` (default `https://router.project-osrm.org`)
- `FLIGHT_PROVIDER=aviationstack`
- `HOTEL_PROVIDER=openrouter` (any other value uses Geoapify hotel records only)
- `WEATHER_PROVIDER=open_meteo`
- `ROUTING_PROVIDER=osrm`
- `PLACES_PROVIDER=geoapify`
- `CURRENCY_PROVIDER=frankfurter`
- `USE_MOCK_FALLBACK=true`
- `DEBUG_MODE=false` (set `true` for parser, provider, and transition logs)
- `MAX_RETRY_ATTEMPTS=2`
- `MAX_REPLAN_ATTEMPTS=2`
- `AI_DAY_DESCRIPTIONS=true` (set `false` to skip the AI-written day text for the fastest plans)
- `AI_DESCRIPTION_TIMEOUT_SECONDS=45` (slower AI answers fall back to the built-in day summary)
- `PARSER_LLM_WAIT_SECONDS=8` (how long the chat waits for the background AI parse)

No secrets are stored in source. Responses cached on disk do not include API keys. Debug logs redact request URLs that contain credentials.

## Checks

There is no automated test suite.

```bash
python scripts/inspect_agents.py
python scripts/check_providers.py BOM SIN Singapore   # calls every provider live and shows which one answered
```

## Web app

The same planner runs as a web API (`src/worldtour_ai/web/app.py`, FastAPI) used by the React app in `../frontend`.

```bash
python scripts/serve.py      # http://127.0.0.1:8000  (GET /api/health, POST /api/chat, /api/plan, /api/export/text|ics)
```

On Vercel, the root `app.py` is the entry point (Vercel detects the FastAPI `app` and routes every path to it); `vercel.json` sets a 300-second limit.
Optional protection variables: `ACCESS_CODE`, `ALLOWED_ORIGINS`, `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (+ `PLANS_PER_DAY`).

## Running the terminal application

```bash
python scripts/run.py
```

The program works like a chat:

1. Type a travel request. If anything is missing it asks for all of it in one message: origin, destination, days, budget, travelers, and (optionally) travel dates, interests and pace. Answers are understood instantly; say `skip` to continue without something.
2. It checks that the trip is realistic before planning: too far for the number of days, too many cities, a budget below the cheapest realistic cost, dates in the past, or a road trip that is too long. It explains each problem with numbers and suggests a fix; reply `yes`, change something (`6 days`, `budget 80000 INR`, `keep 2`), or `continue` to plan as is.
3. It shows a summary of what it understood, then runs the planning workflow once.
4. The plan is shown in the currency you used (or your home country's currency): `₹`, `€`, `£`, `$` and so on. It includes three packages (Budget, Balanced, Premium), each with its own way of travelling and hotel; how to get there and back (flights, and for domestic or nearby trips also trains, buses and private cabs); hotels; day-by-day weather with packing tips; a full timetable for every day (airport/station transfers, cab or walking legs between sights with distance, time and fare, meals, check-in/out, city changes); a cost breakdown; and booking/map links.
5. Afterwards you can keep chatting to change it: `premium`, `budget`, `by train`, `by bus`, `fly`, `more relaxed`, `remove <place>`, `add beaches`, `budget 50000 INR`, `3 people`, `12-18 Dec`, `5 days`. Type `save` to write the plan to `trips/` as a text file and a calendar (`.ics`) file, `new` for another trip, or `exit`.

Budgets understand `₹`, `Rs`, `INR`, `lakh`, `crore` and `50k`. An amount without a currency is read in the currency of the country you travel from.

Example inputs you can type yourself:

- Plan a 7 day trip from Ahmedabad to Japan with a budget of 2000 USD.
- I want a romantic 5-day trip to Paris in December.
- Plan a budget trip from Mumbai to Europe covering Paris, Amsterdam and Rome.
- I have 10 days and want to explore northern India with a focus on historical places.
- I want to visit Europe.
- Take me somewhere warm in December for five days. I prefer beaches and adventure and I don't want to spend more than 1000 USD.

`DEBUG_MODE=true` adds provider failures, retries, and more state detail. Normal mode prints agent events and a final plan.

## Limitations

- Aviationstack's free plan is current flight status, not a future fare search. Quota is small, so responses are cached.
- Hotel rates are OpenRouter model estimates. The free OpenRouter tier allows 50 requests per day; hotel answers are cached for 24 hours.
- With `SERPAPI_API_KEY`, flights and hotels are live Google prices for your dates. Without it (or when the 250 monthly searches are used up), flights fall back to current Aviationstack schedules with distance-based fare estimates, and hotels to AI-suggested hotels with estimated rates.
- Train, bus and cab fares are per-country estimates from the real road distance (OSRM); there is no free live fare API for them. The booking links (IRCTC, redBus, Rome2Rio) show real fares and timings.
- Food is a static per-country planning rate, scaled by package. Local transport is the sum of the cab rides in the timetable.
- Open-Meteo forecasts cover roughly the next 16 days. Later dates show last year's weather for the same dates, marked "typical".
- Itinerary places and times are chosen by the planner; the AI only writes the descriptions. A day whose AI text does not match the schedule uses the built-in summary instead.
- Only cities and regions in `data/places.py` are supported.
- OSRM's public server is a shared route calculator, not a traffic feed.
- Suggested cities for a country or region are marked as suggestions when you did not name them.
- The knapsack runs on optional activities after a baseline flight and hotel estimate. It is not a full trip-booking optimizer.
- Very large budgets are scaled inside the DP table and marked inexact.
- The heuristic parser is used whenever OpenRouter is not configured. It will ask rather than guess a destination.

## Future improvements

- A hotel provider with live rates behind the existing hotel interface.
- A traffic-capable routing provider behind `BaseRoutingProvider`, without changing Dijkstra or A*.
- A future-dated flight search provider behind `BaseFlightProvider`.
- Richer opening-hour data per place.
- Persisted trip history once a user database exists outside this subsystem.
