"""Data access: committed snapshot by default, live Elexon pull as fallback.

Frames and derived tables are cached per process; on serverless this means one
build per cold start (well under a second for one month of data).
"""

import json
import logging
from dataclasses import dataclass
from datetime import date, time, timedelta
from functools import lru_cache

import pandas as pd

from . import analysis as an
from .config import get_settings
from .elexon import fetch_wind_actuals, fetch_wind_forecasts

log = logging.getLogger(__name__)

ACTUALS_FILE = "wind_actuals_FUELHH.json"
FORECASTS_FILE = "wind_forecasts_WINDFOR.json"


@dataclass(frozen=True)
class Dataset:
    actuals: pd.DataFrame
    forecasts: pd.DataFrame
    source: str  # "snapshot" | "live"
    fetched_at: str


def _read_snapshot() -> tuple[list[dict], list[dict], str] | None:
    d = get_settings().data_dir
    try:
        a = json.loads((d / ACTUALS_FILE).read_text())
        f = json.loads((d / FORECASTS_FILE).read_text())
    except FileNotFoundError:
        return None
    return a["rows"], f["rows"], a["fetchedAt"]


def _fetch_live() -> tuple[list[dict], list[dict], str]:
    s = get_settings()
    now = pd.Timestamp.now(tz="UTC").strftime("%Y-%m-%dT%H:%M:%SZ")
    return fetch_wind_actuals(*s.actuals_date_window), fetch_wind_forecasts(*s.forecast_publish_window), now


@lru_cache(maxsize=1)
def dataset() -> Dataset:
    snap = None if get_settings().live_fetch else _read_snapshot()
    if snap is None:
        log.info("Loading data live from Elexon")
        actuals, forecasts, fetched_at = _fetch_live()
        source = "live"
    else:
        actuals, forecasts, fetched_at = snap
        source = "snapshot"
    return Dataset(an.actuals_frame(actuals), an.forecasts_frame(forecasts), source, fetched_at)


def delivery_days() -> list[date]:
    s = get_settings()
    first = s.first_decision_date + timedelta(days=1)
    n = (s.last_decision_date - s.first_decision_date).days + 1
    return [first + timedelta(days=i) for i in range(n)]


def evaluation_window() -> tuple[pd.Timestamp, pd.Timestamp]:
    """UTC span of all in-scope delivery days."""
    s = get_settings()
    days = delivery_days()
    return an.delivery_day_bounds(days[0], s.market_tz)[0], an.delivery_day_bounds(days[-1], s.market_tz)[1]


@lru_cache(maxsize=16)
def decisions(gate: time) -> pd.DataFrame:
    ds = dataset()
    return an.decision_table(ds.forecasts, ds.actuals, delivery_days(), gate, get_settings().market_tz)


@lru_cache(maxsize=1)
def horizons() -> pd.DataFrame:
    ds = dataset()
    targets = an.hourly_targets(*evaluation_window())
    return an.horizon_table(ds.forecasts, ds.actuals, targets, range(0, get_settings().max_horizon_h + 1))
