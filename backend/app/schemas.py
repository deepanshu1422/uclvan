"""Response models (also drive the OpenAPI docs at /api/docs)."""

from pydantic import BaseModel


class Meta(BaseModel):
    delivery_days: list[str]
    default_gate: str
    market_tz: str
    max_horizon_h: int
    source: str
    fetched_at: str
    forecast_publishes: int


class Band(BaseModel):
    low: float | None
    mid: float | None
    high: float | None
    q_low: float
    q_high: float
    n: int


class DecisionPoint(BaseModel):
    t: str
    forecast: float | None
    p10: float | None
    p50: float | None
    p90: float | None
    actual: float | None
    horizon_h: float | None


class Point(BaseModel):
    t: str
    value: float | None


class Vintage(BaseModel):
    publish_time: str
    before_decision: bool
    points: list[Point]


class DecisionSummary(BaseModel):
    forecast_mwh: float | None
    p10_mwh: float | None
    p50_mwh: float | None
    actual_mwh: float | None
    min_forecast_mw: float | None
    max_forecast_mw: float | None
    mae: float | None
    bias: float | None


class Decision(BaseModel):
    delivery_date: str
    gate: str
    decision_time: str
    publish_time: str | None
    horizon_min_h: float | None
    horizon_max_h: float | None
    band: Band
    summary: DecisionSummary
    points: list[DecisionPoint]
    actuals_halfhourly: list[Point]
    vintages: list[Vintage]


class SeriesPoint(BaseModel):
    t: str
    forecast: float | None
    actual: float | None
    error: float | None
    publish_time: str | None


class Accuracy(BaseModel):
    mode: str
    horizon_h: int | None
    gate: str
    start: str
    end: str
    metrics: dict
    by_hour: list[dict]
    by_day: list[dict]
    histogram: list[dict]
    series: list[SeriesPoint]


class HorizonRow(BaseModel):
    lead_h: int
    n: int
    coverage_pct: float
    mae: float | None
    rmse: float | None
    bias: float | None
    p10: float | None
    p90: float | None
