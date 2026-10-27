"""HTTP layer: validates input, slices the cached tables, shapes JSON. No analysis logic here."""

from datetime import date, time

import pandas as pd
from fastapi import APIRouter, HTTPException, Query

from . import analysis as an
from . import store
from .config import get_settings
from .schemas import Accuracy, Decision, HorizonRow, Meta

router = APIRouter(prefix="/api")

GateQuery = Query(None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$", description="Decision time on D-1, HH:MM UK local")


def _iso(x) -> str | None:
    return None if pd.isna(x) else pd.Timestamp(x).strftime("%Y-%m-%dT%H:%M:%SZ")


def _num(x) -> float | None:
    return None if x is None or pd.isna(x) else round(float(x), 1)


def _gate(gate: str | None) -> time:
    return time.fromisoformat(gate) if gate else get_settings().gate_time


def _day(d: date) -> date:
    days = store.delivery_days()
    if d not in days:
        raise HTTPException(422, f"delivery_date must be between {days[0]} and {days[-1]}")
    return d


def _local_hour(ts: pd.Series) -> pd.Series:
    return ts.dt.tz_convert(get_settings().market_tz).dt.hour


@router.get("/health")
def health() -> dict:
    return {"status": "ok"}


@router.get("/meta", response_model=Meta)
def meta() -> Meta:
    s = get_settings()
    ds = store.dataset()
    return Meta(
        delivery_days=[d.isoformat() for d in store.delivery_days()],
        default_gate=s.gate_time.strftime("%H:%M"),
        market_tz=s.market_tz,
        max_horizon_h=s.max_horizon_h,
        source=ds.source,
        fetched_at=ds.fetched_at,
        forecast_publishes=int(ds.forecasts["publishTime"].nunique()),
    )


@router.get("/decision", response_model=Decision)
def decision(delivery_date: date, gate: str | None = GateQuery) -> dict:
    """What the desk saw at decision time for one delivery day, plus hindsight actuals."""
    s = get_settings()
    day, g = _day(delivery_date), _gate(gate)
    ds = store.dataset()
    table = store.decisions(g)
    band = an.error_band(table)
    rows = table[table["delivery_day"] == day]
    cutoff = an.decision_time_utc(day, g, s.market_tz)
    start, end = an.delivery_day_bounds(day, s.market_tz)

    def plus(v, delta):
        return None if pd.isna(v) or delta is None else max(0.0, v + delta)

    points = [
        {
            "t": _iso(r.startTime),
            "forecast": _num(r.forecast),
            "p10": _num(plus(r.forecast, band["low"])),
            "p50": _num(plus(r.forecast, band["mid"])),
            "p90": _num(plus(r.forecast, band["high"])),
            "actual": _num(r.actual),
            "horizon_h": _num(r.horizon_h),
        }
        for r in rows.itertuples()
    ]

    act = ds.actuals[(ds.actuals["startTime"] >= start) & (ds.actuals["startTime"] < end)]
    fc = ds.forecasts[(ds.forecasts["startTime"] >= start) & (ds.forecasts["startTime"] < end)]
    vintages = [
        {
            "publish_time": _iso(p),
            "before_decision": bool(p <= cutoff),
            "points": [{"t": _iso(t), "value": _num(v)} for t, v in zip(g_["startTime"], g_["forecast"], strict=False)],
        }
        for p, g_ in fc.groupby("publishTime")
    ]

    def mwh(values) -> float | None:
        v = [x for x in values if x is not None]
        return round(sum(v)) if v else None

    m = an.metrics(rows)
    forecasts = rows["forecast"].dropna()
    return {
        "delivery_date": day.isoformat(),
        "gate": g.strftime("%H:%M"),
        "decision_time": _iso(cutoff),
        "publish_time": _iso(rows["publishTime"].max()),
        "horizon_min_h": _num(rows["horizon_h"].min()),
        "horizon_max_h": _num(rows["horizon_h"].max()),
        "band": band,
        "summary": {
            "forecast_mwh": mwh(p["forecast"] for p in points),
            "p10_mwh": mwh(p["p10"] for p in points),
            "p50_mwh": mwh(p["p50"] for p in points),
            # Half-hourly MW averages -> MWh
            "actual_mwh": round(float(act["actual"].sum()) * 0.5) if len(act) else None,
            "min_forecast_mw": _num(forecasts.min()) if len(forecasts) else None,
            "max_forecast_mw": _num(forecasts.max()) if len(forecasts) else None,
            "mae": m.get("mae"),
            "bias": m.get("bias"),
        },
        "points": points,
        "actuals_halfhourly": [
            {"t": _iso(t), "value": _num(v)} for t, v in zip(act["startTime"], act["actual"], strict=False)
        ],
        "vintages": vintages,
    }


@router.get("/accuracy", response_model=Accuracy)
def accuracy(
    mode: str = Query("decision", pattern="^(decision|horizon)$"),
    horizon_h: int = Query(24, ge=0, le=48),
    gate: str | None = GateQuery,
    start: date | None = None,
    end: date | None = None,
) -> dict:
    """Accuracy over a range of delivery days, either for the forecast used at decision time
    or for a fixed forecast lead time."""
    s = get_settings()
    days = store.delivery_days()
    start, end = _day(start or days[0]), _day(end or days[-1])
    if end < start:
        raise HTTPException(422, "end must not be before start")
    g = _gate(gate)
    lo = an.delivery_day_bounds(start, s.market_tz)[0]
    hi = an.delivery_day_bounds(end, s.market_tz)[1]

    if mode == "decision":
        t = store.decisions(g)
    else:
        h = store.horizons()
        t = h[h["lead_h"] == horizon_h]
    t = t[(t["startTime"] >= lo) & (t["startTime"] < hi)]

    local = t["startTime"].dt.tz_convert(s.market_tz)
    return {
        "mode": mode,
        "horizon_h": horizon_h if mode == "horizon" else None,
        "gate": g.strftime("%H:%M"),
        "start": start.isoformat(),
        "end": end.isoformat(),
        "metrics": an.metrics(t),
        "by_hour": an.group_metrics(t, local.dt.hour, "hour"),
        "by_day": [{**r, "day": r["day"].isoformat()} for r in an.group_metrics(t, local.dt.date, "day")],
        "histogram": an.histogram(t),
        "series": [
            {
                "t": _iso(r.startTime),
                "forecast": _num(r.forecast),
                "actual": _num(r.actual),
                "error": _num(r.error),
                "publish_time": _iso(r.publishTime),
            }
            for r in t.itertuples()
        ],
    }


@router.get("/accuracy/horizons", response_model=list[HorizonRow])
def accuracy_by_horizon(start: date | None = None, end: date | None = None) -> list[dict]:
    """Error statistics as a function of forecast lead time (0..48h)."""
    s = get_settings()
    days = store.delivery_days()
    start, end = _day(start or days[0]), _day(end or days[-1])
    lo = an.delivery_day_bounds(start, s.market_tz)[0]
    hi = an.delivery_day_bounds(end, s.market_tz)[1]
    h = store.horizons()
    h = h[(h["startTime"] >= lo) & (h["startTime"] < hi)]
    out = []
    for lead, g_ in h.groupby("lead_h"):
        m = an.metrics(g_)
        out.append(
            {
                "lead_h": int(lead),
                "n": m["n"],
                "coverage_pct": round(100 * m["n"] / max(len(g_), 1), 1),
                "mae": m.get("mae"),
                "rmse": m.get("rmse"),
                "bias": m.get("bias"),
                "p10": m.get("quantiles", {}).get("p10"),
                "p90": m.get("quantiles", {}).get("p90"),
            }
        )
    return out
