"""Runtime configuration (overridable via environment variables)."""

from datetime import UTC, date, datetime, time, timedelta
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="", extra="ignore")

    elexon_base_url: str = "https://data.elexon.co.uk/bmrs/api/v1"
    data_dir: Path = BACKEND_DIR / "data"
    # When true, ignore the committed snapshot and pull fresh data from Elexon on startup.
    live_fetch: bool = False

    # Purchase decisions in scope: made 2026-01-01 .. 2026-01-31,
    # i.e. delivery days 2026-01-02 .. 2026-02-01.
    first_decision_date: date = date(2026, 1, 1)
    last_decision_date: date = date(2026, 1, 31)

    # Default decision time on D-1 (GB day-ahead hourly auction gate closure, UK local time).
    gate_time: time = time(9, 20)
    market_tz: str = "Europe/London"

    # Longest forecast horizon analysed in the error-vs-horizon view.
    max_horizon_h: int = 48

    # Optional path to built frontend; served by FastAPI when present (Docker image).
    static_dir: Path | None = None

    @property
    def forecast_publish_window(self) -> tuple[datetime, datetime]:
        """Publishes needed so every delivery hour has a forecast at every horizon up to max."""
        start = datetime.combine(self.first_decision_date, time(0), UTC)
        end = datetime.combine(self.last_decision_date, time(0), UTC)
        return start - timedelta(days=3), end + timedelta(days=2)

    @property
    def actuals_date_window(self) -> tuple[date, date]:
        return self.first_decision_date, self.last_decision_date + timedelta(days=1)


@lru_cache
def get_settings() -> Settings:
    return Settings()
