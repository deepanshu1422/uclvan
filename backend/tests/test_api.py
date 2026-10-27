"""Smoke tests against the committed snapshot."""

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_meta():
    r = client.get("/api/meta").json()
    assert r["delivery_days"][0] == "2026-01-02"
    assert r["delivery_days"][-1] == "2026-02-01"
    assert r["source"] == "snapshot"


def test_decision_uses_latest_publish_before_gate():
    r = client.get("/api/decision", params={"delivery_date": "2026-01-15"}).json()
    assert r["decision_time"] == "2026-01-14T09:20:00Z"
    assert r["publish_time"] == "2026-01-14T07:30:00Z"
    assert len(r["points"]) == 24
    assert all(p["p10"] <= p["p50"] <= p["p90"] for p in r["points"])
    assert any(v["before_decision"] for v in r["vintages"])
    assert any(not v["before_decision"] for v in r["vintages"])


def test_later_gate_uses_later_publish():
    r = client.get("/api/decision", params={"delivery_date": "2026-01-15", "gate": "10:00"}).json()
    assert r["publish_time"] == "2026-01-14T09:30:00Z"


def test_decision_out_of_scope_rejected():
    assert client.get("/api/decision", params={"delivery_date": "2026-03-01"}).status_code == 422
    assert client.get("/api/decision", params={"delivery_date": "2026-01-15", "gate": "9am"}).status_code == 422


def test_accuracy_modes():
    d = client.get("/api/accuracy").json()
    assert d["metrics"]["n"] == 31 * 24
    h = client.get(
        "/api/accuracy", params={"mode": "horizon", "horizon_h": 4, "start": "2026-01-10", "end": "2026-01-10"}
    )
    assert h.status_code == 200
    assert len(h.json()["series"]) == 24


def test_horizon_curve():
    rows = client.get("/api/accuracy/horizons").json()
    assert [r["lead_h"] for r in rows] == list(range(49))
    assert rows[0]["mae"] < rows[36]["mae"]
