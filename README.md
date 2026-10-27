# Wind Forecast Decision Desk

A web app for a UK utility's day-ahead power desk. It shows the GB national wind forecast that was available at
decision time and measures how accurate those forecasts were. The desk can then size thermal / day-ahead purchases
against a quantified wind range instead of a single number.

**Live app:** https://uclvan.vercel.app
**API docs (OpenAPI):** https://uclvan.vercel.app/api/docs

Scope, as given in the brief:

- Data comes only from Elexon BMRS: actual wind outturn from `FUELHH` (`fuelType = WIND`, half-hourly) and the
  national wind forecast from `WINDFOR` (hourly, about 8 publishes a day).
- Only purchase decisions made in January 2026 are covered. A decision on day D-1 is for delivery day D, so delivery
  days run from 2026-01-02 to 2026-02-01.

## What the app does

### 1. Decision Desk: "what should I plan against for delivery day D?"

- Pick a delivery day and a decision time on D-1 (default **09:20 UK time**, roughly GB day-ahead auction gate
  closure).
- The app picks the **latest WINDFOR forecast published at or before that moment** for each hour of D. This is exactly
  what the desk could have seen; nothing published later leaks in.
- On top of the forecast it shows a **P10–P90 wind range** and a **bias-adjusted P50**. Both come from the empirical
  distribution of decision-time errors over January.
- Daily totals (MWh) are shown for forecast, P10, P50 and, in hindsight, the actual.
- A "forecast vintages" chart shows how the forecast for that day changed across successive publishes.

### 2. Forecast Accuracy: "how far can I trust the forecast?"

- There are two modes:
  - **Decision-time:** the forecast actually used at the gate.
  - **Fixed lead time:** the forecast published *h* hours ahead, for h from 0 to 48.
- Metrics: MAE, RMSE, bias, normalised MAE, the P5–P95 error quantiles, and the share of hours missed by more than 2 GW.
- The same metrics are broken down by hour of day and by delivery day, with an error histogram.
- An **error-vs-lead-time curve** (0–48 h) shows how much accuracy is lost by deciding a day early.

### Usability and accessibility

- Each page has a "how to read this" guide with a glossary (P10/P50, MAE, bias, lead time). It stays open until the
  user closes it.
- A plain-language **recommendation** box ("plan on X GW, secure Y GW more") and auto-generated **key findings** sit
  above the charts.
- Every chart has a text summary for screen readers and a "Show as table" toggle with the underlying numbers.
- Tabs follow the WAI-ARIA tabs pattern (arrow keys, Home/End). There is a skip link, visible focus rings, labelled
  form controls and `role="alert"` errors.
- Series are told apart by line style (dashed P50 and bias lines) as well as colour.
- Light and dark themes are both checked with axe-core against WCAG 2.1 AA, with zero violations. The layout is
  responsive down to 360 px.
- The current view is kept in the URL, so links can be shared.

### Headline findings (January 2026, 744 delivery hours, 09:20 gate)

| Metric | Value |
|---|---|
| Mean absolute error | ~2.0 GW (≈18% of mean wind output of 11.3 GW) |
| Bias (forecast − actual) | **+1.75 GW**: the forecast ran consistently high |
| P10 / P90 of error | −0.43 GW / +4.15 GW |
| Hours missed by > 2 GW | 41% |
| MAE at 1 h vs 24 h vs 48 h lead | 1.68 / 1.93 / 2.30 GW |

The practical takeaway: in January 2026, planning on the raw forecast would have left the desk systematically short of
wind. Procurement sized on the P10/P50 levels would have been better.

## Design notes

- **Error convention:** `error = forecast − actual`. A positive error means wind under-delivered, so more power had to
  be bought.
- **Matching:** forecasts are hourly and actuals are half-hourly. Each hourly target is matched to the settlement
  period that starts at the same time.
- **Latest-forecast selection:** done with `pandas.merge_asof(by=startTime, direction="backward")` on `publishTime`. A
  forecast published exactly at the cutoff counts as available.
- **Feed clean-up:** WINDFOR rows with `startTime <= publishTime` are re-published history, not forecasts, so they are
  dropped.
- **Time zones:** everything is UTC internally. Delivery days and gate times are UK local (`Europe/London`), so
  clock-change days come out as 23 or 25 hours.
- **Data loading:** a snapshot of both datasets is committed in `backend/data/` so the app is deterministic and fast on
  serverless. Set `LIVE_FETCH=true` to pull from Elexon at startup instead. If no snapshot exists, the app falls back
  to a live pull.
- **Caching:** derived tables are cached in-process (`lru_cache`), so each request only slices them.
- **Known limitation:** the P10/P50/P90 band is fitted on the whole of January, so it is in-sample for the day being
  viewed. A production version would fit it on a rolling window of *past* days only.

## Repository layout

```
.
├── api/index.py               Vercel serverless entrypoint (wraps the FastAPI app)
├── backend/
│   ├── app/
│   │   ├── main.py            FastAPI app, middleware, serves built frontend in Docker
│   │   ├── routes.py          HTTP layer: /api/meta, /api/decision, /api/accuracy, /api/accuracy/horizons
│   │   ├── analysis.py        Pure pandas analysis (selection, joins, metrics); no I/O
│   │   ├── store.py           Loads the snapshot or live data and caches the derived tables
│   │   ├── elexon.py          Elexon BMRS client (FUELHH + WINDFOR, chunked, retries)
│   │   ├── schemas.py         Pydantic response models
│   │   └── config.py          Settings (env-overridable): scope dates, gate time, TZ, horizons
│   ├── data/                  Committed Elexon snapshot (JSON)
│   ├── scripts/fetch_snapshot.py  Regenerates the snapshot from Elexon
│   ├── tests/                 pytest: analysis unit tests + API tests
│   ├── requirements.txt / requirements-dev.txt
│   └── pyproject.toml         pytest + ruff config
├── frontend/                  React 19 + TypeScript + Vite + Recharts
│   └── src/
│       ├── App.tsx            Shell, tabs, shared state
│       ├── pages/DecisionDesk.tsx
│       ├── pages/Accuracy.tsx
│       ├── api.ts             Typed API client
│       ├── components.tsx / format.ts / useApi.ts / index.css
├── Dockerfile                 Multi-stage: builds frontend, serves it + API from one Python image
├── docker-compose.yml         Prod-like container, or a hot-reload dev profile
├── vercel.json                Vercel config: static frontend + Python function for /api
├── requirements.txt           Python deps for the Vercel function
└── .github/workflows/ci.yml   CI: ruff + pytest, eslint + build, docker build
```

## Running it

### Docker (recommended)

```bash
docker compose up --build
# open http://localhost:8000      (API docs at http://localhost:8000/api/docs)
```

Hot-reload dev setup in Docker:

```bash
docker compose --profile dev up
# frontend http://localhost:5173, API http://localhost:8001
```

### Without Docker

```bash
# backend (Python 3.12)
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --port 8000

# frontend (Node 22+), in a second terminal
cd frontend
npm ci
npm run dev          # http://localhost:5173, proxies /api to :8000
```

### Tests and lint

```bash
cd backend && pytest -q && ruff check .
cd frontend && npm run lint && npm run build
```

### Refreshing the data snapshot

```bash
cd backend && python -m scripts.fetch_snapshot
```

### Configuration (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `LIVE_FETCH` | `false` | Ignore the snapshot and fetch from Elexon on startup |
| `GATE_TIME` | `09:20` | Default decision time on D-1 (UK local) |
| `FIRST_DECISION_DATE` / `LAST_DECISION_DATE` | `2026-01-01` / `2026-01-31` | Decision window |
| `MAX_HORIZON_H` | `48` | Longest lead time in the horizon analysis |
| `ELEXON_BASE_URL` | `https://data.elexon.co.uk/bmrs/api/v1` | BMRS API base |

## Deployment

The app is deployed on **Vercel**:

- The Vite build is served as static files.
- `/api/*` is routed to a Python serverless function (`api/index.py`) that imports the same FastAPI app.
- The Docker image is an alternative single-container deployment (for example Heroku, Render or Fly).

## Use of AI tools

This project was built with help from **Claude Code (Anthropic)**, an AI coding assistant. I used it for:

- researching the Elexon datasets and the GB day-ahead market context
- scaffolding the backend and frontend
- writing tests, Docker and Vercel config, and this README

I reviewed the design decisions (decision-time selection, error convention, scope window), the analysis and the
results myself.
