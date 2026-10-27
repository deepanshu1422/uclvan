from datetime import date, time

import pandas as pd
import pytest

from app import analysis as an

TZ = "Europe/London"


def _fc(rows):
    return an.forecasts_frame([{"publishTime": p, "startTime": s, "generation": g} for p, s, g in rows])


def _act(rows):
    return an.actuals_frame([{"startTime": s, "generation": g} for s, g in rows])


def ts(s):
    return pd.Timestamp(s, tz="UTC")


def test_forecasts_frame_drops_non_forecast_rows_and_computes_horizon():
    f = _fc(
        [
            ("2026-01-10T10:00:00Z", "2026-01-10T09:00:00Z", 1),  # target in the past
            ("2026-01-10T10:00:00Z", "2026-01-10T10:00:00Z", 2),  # target == publish
            ("2026-01-10T10:00:00Z", "2026-01-11T10:00:00Z", 3),
        ]
    )
    assert list(f["forecast"]) == [3]
    assert f["horizon_h"].iloc[0] == 24


def test_latest_forecast_before_picks_most_recent_eligible_publish():
    f = _fc(
        [
            ("2026-01-10T02:30:00Z", "2026-01-11T12:00:00Z", 100),
            ("2026-01-10T07:30:00Z", "2026-01-11T12:00:00Z", 200),
            ("2026-01-10T09:30:00Z", "2026-01-11T12:00:00Z", 300),  # after cutoff
        ]
    )
    t = pd.DataFrame({"startTime": [ts("2026-01-11T12:00")], "cutoff": [ts("2026-01-10T09:20")]})
    out = an.latest_forecast_before(f, t)
    assert out["forecast"].iloc[0] == 200
    assert out["publishTime"].iloc[0] == ts("2026-01-10T07:30")
    assert out["horizon_h"].iloc[0] == pytest.approx(28.5)


def test_publish_exactly_at_cutoff_is_eligible():
    f = _fc([("2026-01-10T09:20:00Z", "2026-01-11T00:00:00Z", 5)])
    t = pd.DataFrame({"startTime": [ts("2026-01-11T00:00")], "cutoff": [ts("2026-01-10T09:20")]})
    assert an.latest_forecast_before(f, t)["forecast"].iloc[0] == 5


def test_target_without_eligible_forecast_is_nan():
    f = _fc([("2026-01-10T12:00:00Z", "2026-01-11T00:00:00Z", 5)])
    t = pd.DataFrame({"startTime": [ts("2026-01-11T00:00")], "cutoff": [ts("2026-01-10T09:20")]})
    assert an.latest_forecast_before(f, t)["forecast"].isna().all()


def test_forecast_at_horizon_respects_lead_time():
    f = _fc(
        [
            ("2026-01-10T00:00:00Z", "2026-01-11T00:00:00Z", 1),  # 24h ahead
            ("2026-01-10T20:00:00Z", "2026-01-11T00:00:00Z", 2),  # 4h ahead
        ]
    )
    targets = pd.DatetimeIndex([ts("2026-01-11T00:00")])
    assert an.forecast_at_horizon(f, targets, 4)["forecast"].iloc[0] == 2
    assert an.forecast_at_horizon(f, targets, 5)["forecast"].iloc[0] == 1
    assert an.forecast_at_horizon(f, targets, 25)["forecast"].isna().all()


def test_decision_time_is_d_minus_1_at_gate_local_time():
    assert an.decision_time_utc(date(2026, 1, 15), time(9, 20), TZ) == ts("2026-01-14T09:20")
    # Summer: BST = UTC+1
    assert an.decision_time_utc(date(2026, 7, 15), time(9, 20), TZ) == ts("2026-07-14T08:20")


def test_delivery_day_bounds_handle_clock_change():
    start, end = an.delivery_day_bounds(date(2026, 3, 29), TZ)  # spring forward: 23h day
    assert (end - start) == pd.Timedelta(hours=23)


def test_decision_forecast_covers_every_hour_of_day():
    rows = [("2026-01-14T07:30:00Z", f"2026-01-15T{h:02d}:00:00Z", h) for h in range(24)]
    out = an.decision_forecast(_fc(rows), date(2026, 1, 15), time(9, 20), TZ)
    assert len(out) == 24
    assert out["forecast"].tolist() == list(range(24))


def test_join_uses_actual_with_matching_start_time():
    f = _fc([("2026-01-10T00:00:00Z", "2026-01-11T00:00:00Z", 1000)])
    a = _act([("2026-01-11T00:00:00Z", 800), ("2026-01-11T00:30:00Z", 9999)])
    out = an.join_actuals(an.forecast_at_horizon(f, pd.DatetimeIndex([ts("2026-01-11T00:00")]), 1), a)
    assert out["actual"].iloc[0] == 800
    assert out["error"].iloc[0] == 200


def test_metrics_math():
    df = pd.DataFrame({"forecast": [110.0, 90.0, 100.0, None], "actual": [100.0, 100.0, 100.0, 50.0]})
    df["error"] = df["forecast"] - df["actual"]
    m = an.metrics(df)
    assert m["n"] == 3
    assert m["mae"] == pytest.approx(6.7)
    assert m["bias"] == 0
    assert m["rmse"] == pytest.approx(8.2)
    assert m["nmae_pct"] == pytest.approx(6.67)


def test_metrics_empty():
    assert an.metrics(pd.DataFrame({"forecast": [], "actual": [], "error": []})) == {"n": 0}


def test_error_band_uses_actual_minus_forecast():
    df = pd.DataFrame({"forecast": [100.0] * 10, "actual": [float(x) for x in range(91, 101)]})
    band = an.error_band(df, 0.0, 1.0)
    assert band["low"] == -9 and band["high"] == 0 and band["mid"] == -4.5
