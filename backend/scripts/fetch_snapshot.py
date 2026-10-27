"""Regenerate the committed data snapshot from Elexon.

Usage (from backend/):  python -m scripts.fetch_snapshot
"""

import json
from datetime import UTC, datetime

from app.config import get_settings
from app.elexon import fetch_wind_actuals, fetch_wind_forecasts
from app.store import ACTUALS_FILE, FORECASTS_FILE


def main() -> None:
    settings = get_settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    fetched_at = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")

    actuals = fetch_wind_actuals(*settings.actuals_date_window)
    forecasts = fetch_wind_forecasts(*settings.forecast_publish_window)

    for name, rows in ((ACTUALS_FILE, actuals), (FORECASTS_FILE, forecasts)):
        payload = {"fetchedAt": fetched_at, "rows": sorted(rows, key=lambda r: tuple(r.values()))}
        (settings.data_dir / name).write_text(json.dumps(payload, separators=(",", ":")))
        print(f"wrote {name}: {len(rows)} rows")


if __name__ == "__main__":
    main()
