"""Thin client for the Elexon BMRS Insights API (no API key required).

Only two datasets are used:
  * FUELHH  - half-hourly generation outturn by fuel type (we keep fuelType=WIND)
  * WINDFOR - national wind generation forecast, hourly, ~8 publishes per day
"""

from datetime import date, datetime, timedelta

import httpx

from .config import get_settings

_TIMEOUT = httpx.Timeout(30.0)
_RETRIES = 3


def _get(client: httpx.Client, path: str, params: dict) -> list[dict]:
    last_error: Exception | None = None
    for _ in range(_RETRIES):
        try:
            resp = client.get(path, params=params)
            resp.raise_for_status()
            return resp.json()
        except (httpx.HTTPError, ValueError) as exc:  # network, 4xx/5xx, bad JSON
            last_error = exc
    raise RuntimeError(f"Elexon request failed: {path} {params}") from last_error


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def fetch_wind_actuals(start: date, end: date) -> list[dict]:
    """WIND outturn for settlement dates start..end inclusive, fetched in 7-day chunks."""
    settings = get_settings()
    rows: list[dict] = []
    with httpx.Client(base_url=settings.elexon_base_url, timeout=_TIMEOUT) as client:
        chunk_start = start
        while chunk_start <= end:
            chunk_end = min(chunk_start + timedelta(days=6), end)
            rows += _get(
                client,
                "/datasets/FUELHH/stream",
                {
                    "settlementDateFrom": chunk_start.isoformat(),
                    "settlementDateTo": chunk_end.isoformat(),
                    "fuelType": "WIND",
                },
            )
            chunk_start = chunk_end + timedelta(days=1)
    return [{"startTime": r["startTime"], "generation": r["generation"]} for r in rows if r.get("fuelType") == "WIND"]


def fetch_wind_forecasts(publish_from: datetime, publish_to: datetime) -> list[dict]:
    """Every WINDFOR forecast published in [publish_from, publish_to), fetched in 7-day chunks."""
    settings = get_settings()
    rows: list[dict] = []
    with httpx.Client(base_url=settings.elexon_base_url, timeout=_TIMEOUT) as client:
        chunk_start = publish_from
        while chunk_start < publish_to:
            chunk_end = min(chunk_start + timedelta(days=7), publish_to)
            rows += _get(
                client,
                "/datasets/WINDFOR/stream",
                {"publishDateTimeFrom": _iso(chunk_start), "publishDateTimeTo": _iso(chunk_end)},
            )
            chunk_start = chunk_end
    # Chunk boundaries are inclusive on the API side, so de-duplicate.
    unique = {
        (r["publishTime"], r["startTime"]): {
            "publishTime": r["publishTime"],
            "startTime": r["startTime"],
            "generation": r["generation"],
        }
        for r in rows
    }
    return list(unique.values())
