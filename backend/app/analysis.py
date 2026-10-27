"""Pure forecast-vs-actual analysis. No I/O here, so everything is unit-testable.

Conventions
-----------
* All timestamps are tz-aware UTC pandas Timestamps.
* ``error = forecast - actual`` (MW). Positive error => forecast too high => wind
  under-delivered => more thermal top-up was needed than planned.
* Forecasts are hourly; actuals are half-hourly. Accuracy is evaluated on the hourly
  target times, matched to the actual whose settlement period starts at the same time.
"""

from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

QUANTILES = (0.05, 0.1, 0.5, 0.9, 0.95)


# --------------------------------------------------------------------------- normalise


def actuals_frame(rows: list[dict]) -> pd.DataFrame:
    """Columns: startTime, actual. One row per half-hour (last value wins on duplicates)."""
    df = pd.DataFrame(rows, columns=["startTime", "generation"])
    df["startTime"] = pd.to_datetime(df["startTime"], utc=True)
    df = df.rename(columns={"generation": "actual"}).astype({"actual": float})
    return df.drop_duplicates("startTime", keep="last").sort_values("startTime").reset_index(drop=True)


def forecasts_frame(rows: list[dict]) -> pd.DataFrame:
    """Columns: publishTime, startTime, forecast, horizon_h.

    Rows whose target is at or before their publish time are not forecasts (the feed
    re-publishes recent history), so they are dropped.
    """
    df = pd.DataFrame(rows, columns=["publishTime", "startTime", "generation"])
    df["publishTime"] = pd.to_datetime(df["publishTime"], utc=True)
    df["startTime"] = pd.to_datetime(df["startTime"], utc=True)
    df = df.rename(columns={"generation": "forecast"}).astype({"forecast": float})
    df["horizon_h"] = (df["startTime"] - df["publishTime"]).dt.total_seconds() / 3600
    df = df[df["horizon_h"] > 0]
    return (
        df.drop_duplicates(["publishTime", "startTime"], keep="last")
        .sort_values(["publishTime", "startTime"])
        .reset_index(drop=True)
    )


# --------------------------------------------------------------------------- selection


def latest_forecast_before(forecasts: pd.DataFrame, targets: pd.DataFrame) -> pd.DataFrame:
    """For each (startTime, cutoff) in ``targets`` pick the most recent forecast for that
    startTime whose publishTime <= cutoff. Targets with no eligible forecast get NaN.
    """
    ts = "datetime64[ns, UTC]"  # merge_asof needs identical datetime units on both sides
    left = targets[["startTime", "cutoff"]].astype(ts).sort_values("cutoff")
    right = forecasts[["publishTime", "startTime", "forecast"]].astype({"publishTime": ts, "startTime": ts})
    right = right.sort_values("publishTime")
    merged = pd.merge_asof(
        left,
        right,
        left_on="cutoff",
        right_on="publishTime",
        by="startTime",
        direction="backward",
        allow_exact_matches=True,
    )
    merged["horizon_h"] = (merged["startTime"] - merged["publishTime"]).dt.total_seconds() / 3600
    return merged.sort_values("startTime").reset_index(drop=True)


def hourly_targets(start: pd.Timestamp, end: pd.Timestamp) -> pd.DatetimeIndex:
    """Hourly target times in [start, end)."""
    return pd.date_range(start, end, freq="1h", inclusive="left", tz="UTC")


def forecast_at_horizon(forecasts: pd.DataFrame, targets: pd.DatetimeIndex, horizon_h: float) -> pd.DataFrame:
    """The forecast a user would have had ``horizon_h`` hours before each target."""
    t = pd.DataFrame({"startTime": targets})
    t["cutoff"] = t["startTime"] - pd.Timedelta(hours=horizon_h)
    return latest_forecast_before(forecasts, t)


def decision_time_utc(delivery_day: date, gate: time, tz: str) -> pd.Timestamp:
    """Decision is taken on D-1 at the gate time, expressed in market local time."""
    local = datetime.combine(delivery_day - timedelta(days=1), gate, ZoneInfo(tz))
    return pd.Timestamp(local).tz_convert("UTC")


def delivery_day_bounds(delivery_day: date, tz: str) -> tuple[pd.Timestamp, pd.Timestamp]:
    """UTC [start, end) of a local delivery day (handles 23/25h clock-change days)."""
    z = ZoneInfo(tz)
    start = pd.Timestamp(datetime.combine(delivery_day, time(0), z)).tz_convert("UTC")
    end = pd.Timestamp(datetime.combine(delivery_day + timedelta(days=1), time(0), z)).tz_convert("UTC")
    return start, end


def decision_forecast(forecasts: pd.DataFrame, delivery_day: date, gate: time, tz: str) -> pd.DataFrame:
    """Latest forecast available at decision time for every hour of the delivery day."""
    cutoff = decision_time_utc(delivery_day, gate, tz)
    start, end = delivery_day_bounds(delivery_day, tz)
    t = pd.DataFrame({"startTime": hourly_targets(start, end)})
    t["cutoff"] = cutoff
    out = latest_forecast_before(forecasts, t)
    out["delivery_day"] = delivery_day
    return out


def decision_table(
    forecasts: pd.DataFrame, actuals: pd.DataFrame, days: list[date], gate: time, tz: str
) -> pd.DataFrame:
    """Decision-time forecast joined with actuals across many delivery days."""
    frames = [decision_forecast(forecasts, d, gate, tz) for d in days]
    return join_actuals(pd.concat(frames, ignore_index=True), actuals)


def join_actuals(fc: pd.DataFrame, actuals: pd.DataFrame) -> pd.DataFrame:
    out = fc.merge(actuals.astype({"startTime": "datetime64[ns, UTC]"}), on="startTime", how="left")
    out["error"] = out["forecast"] - out["actual"]
    return out


def horizon_table(forecasts: pd.DataFrame, actuals: pd.DataFrame, targets: pd.DatetimeIndex, horizons) -> pd.DataFrame:
    """Long table: one row per (target, horizon) with forecast, actual and error."""
    frames = []
    for h in horizons:
        f = forecast_at_horizon(forecasts, targets, h)
        f["lead_h"] = h
        frames.append(f)
    return join_actuals(pd.concat(frames, ignore_index=True), actuals)


# --------------------------------------------------------------------------- metrics


def _r(x: float, nd: int = 1) -> float | None:
    return None if x is None or not np.isfinite(x) else round(float(x), nd)


def metrics(df: pd.DataFrame) -> dict:
    """Headline accuracy metrics on rows that have both a forecast and an actual."""
    d = df.dropna(subset=["forecast", "actual"])
    if d.empty:
        return {"n": 0}
    e = d["error"].to_numpy()
    mean_actual = float(d["actual"].mean())
    abs_e = np.abs(e)
    return {
        "n": int(len(d)),
        "mae": _r(abs_e.mean()),
        "rmse": _r(np.sqrt((e**2).mean())),
        "bias": _r(e.mean()),
        "nmae_pct": _r(100 * abs_e.mean() / mean_actual if mean_actual else np.nan, 2),
        "mean_actual": _r(mean_actual),
        "max_abs_error": _r(abs_e.max()),
        "p_abs_err_gt_2gw_pct": _r(100 * (abs_e > 2000).mean(), 1),
        "quantiles": {f"p{int(q * 100)}": _r(np.quantile(e, q)) for q in QUANTILES},
    }


def group_metrics(df: pd.DataFrame, key: pd.Series, name: str) -> list[dict]:
    d = df.dropna(subset=["forecast", "actual"])
    out = []
    for k, g in d.groupby(key.loc[d.index]):
        m = metrics(g)
        out.append({name: k, "n": m["n"], "mae": m["mae"], "bias": m["bias"], "rmse": m["rmse"]})
    return out


def error_band(decisions: pd.DataFrame, qlow: float = 0.1, qhigh: float = 0.9) -> dict:
    """Empirical quantiles of the residual (actual - forecast) for decision-time forecasts.

    Adding these to a forecast gives a wind range: forecast + low is the P10 wind level
    (actual wind came in above it 90% of the time), forecast + mid is the bias-adjusted P50.
    """
    d = decisions.dropna(subset=["forecast", "actual"])
    resid = d["actual"] - d["forecast"]
    return {
        "low": _r(resid.quantile(qlow)),
        "mid": _r(resid.quantile(0.5)),
        "high": _r(resid.quantile(qhigh)),
        "q_low": qlow,
        "q_high": qhigh,
        "n": int(len(d)),
    }


def histogram(df: pd.DataFrame, bin_mw: int = 500) -> list[dict]:
    e = df["error"].dropna()
    if e.empty:
        return []
    lo = int(np.floor(e.min() / bin_mw) * bin_mw)
    hi = int(np.ceil(e.max() / bin_mw) * bin_mw) + bin_mw
    counts, edges = np.histogram(e, bins=np.arange(lo, hi + 1, bin_mw))
    return [
        {"from": int(a), "to": int(b), "count": int(c)} for a, b, c in zip(edges[:-1], edges[1:], counts, strict=False)
    ]
