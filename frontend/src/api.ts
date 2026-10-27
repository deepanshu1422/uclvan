// Typed client for the FastAPI backend. Shapes mirror backend/app/schemas.py.

export interface Meta {
  delivery_days: string[];
  default_gate: string;
  market_tz: string;
  max_horizon_h: number;
  source: string;
  fetched_at: string;
  forecast_publishes: number;
}

export interface Band {
  low: number | null;
  mid: number | null;
  high: number | null;
  q_low: number;
  q_high: number;
  n: number;
}

export interface DecisionPoint {
  t: string;
  forecast: number | null;
  p10: number | null;
  p50: number | null;
  p90: number | null;
  actual: number | null;
  horizon_h: number | null;
}

export interface Point {
  t: string;
  value: number | null;
}

export interface Vintage {
  publish_time: string;
  before_decision: boolean;
  points: Point[];
}

export interface Decision {
  delivery_date: string;
  gate: string;
  decision_time: string;
  publish_time: string | null;
  horizon_min_h: number | null;
  horizon_max_h: number | null;
  band: Band;
  summary: {
    forecast_mwh: number | null;
    p10_mwh: number | null;
    p50_mwh: number | null;
    actual_mwh: number | null;
    min_forecast_mw: number | null;
    max_forecast_mw: number | null;
    mae: number | null;
    bias: number | null;
  };
  points: DecisionPoint[];
  actuals_halfhourly: Point[];
  vintages: Vintage[];
}

export interface Metrics {
  n: number;
  mae?: number;
  rmse?: number;
  bias?: number;
  nmae_pct?: number;
  mean_actual?: number;
  max_abs_error?: number;
  p_abs_err_gt_2gw_pct?: number;
  quantiles?: Record<string, number>;
}

export interface GroupRow {
  n: number;
  mae: number | null;
  bias: number | null;
  rmse: number | null;
}

export interface Accuracy {
  mode: "decision" | "horizon";
  horizon_h: number | null;
  gate: string;
  start: string;
  end: string;
  metrics: Metrics;
  by_hour: (GroupRow & { hour: number })[];
  by_day: (GroupRow & { day: string })[];
  histogram: { from: number; to: number; count: number }[];
  series: { t: string; forecast: number | null; actual: number | null; error: number | null; publish_time: string | null }[];
}

export interface HorizonRow {
  lead_h: number;
  n: number;
  coverage_pct: number;
  mae: number | null;
  rmse: number | null;
  bias: number | null;
  p10: number | null;
  p90: number | null;
}

const BASE = import.meta.env.VITE_API_BASE ?? "";

async function get<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") qs.set(k, String(v));
  const res = await fetch(`${BASE}/api${path}${qs.size ? `?${qs}` : ""}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  meta: () => get<Meta>("/meta"),
  decision: (delivery_date: string, gate?: string) => get<Decision>("/decision", { delivery_date, gate }),
  accuracy: (p: { mode: string; horizon_h?: number; gate?: string; start?: string; end?: string }) =>
    get<Accuracy>("/accuracy", p),
  horizons: (start?: string, end?: string) => get<HorizonRow[]>("/accuracy/horizons", { start, end }),
};
