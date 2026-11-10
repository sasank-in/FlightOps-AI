"""Inference API tests using a small model trained on synthetic data (no dataset needed)."""

import importlib
import json
import sys
from pathlib import Path

import numpy as np
import pytest

pytest.importorskip("fastapi")
from fastapi.testclient import TestClient  # noqa: E402

from flightops.data.schema import FEATURE_NAMES, IDX  # noqa: E402
from flightops.features.build_features import build_window_features, feature_names  # noqa: E402
from flightops.inference.predict import N_TIMESTEPS, Predictor  # noqa: E402
from flightops.models.isolation_forest import IForestDetector  # noqa: E402

SERVICE_DIR = Path(__file__).resolve().parents[2] / "services" / "inference-api"


def _nominal_windows(n, seed=0):
    rng = np.random.default_rng(seed)
    X = rng.normal(size=(n, N_TIMESTEPS, len(FEATURE_NAMES))).astype(np.float32)
    X[:, :, IDX["total_pressure"]] += 1000
    X[:, :, IDX["vert_accel"]] = 1 + 0.05 * X[:, :, IDX["vert_accel"]]
    return X


@pytest.fixture(scope="module")
def model_path(tmp_path_factory):
    X = _nominal_windows(300)
    F = build_window_features(X)
    det = IForestDetector(n_estimators=50).fit(F.to_numpy(), list(F.columns))
    det.threshold = float(np.quantile(det.score(F.to_numpy()), 0.95))
    return det.save(tmp_path_factory.mktemp("model") / "if.joblib")


@pytest.fixture
def client(model_path, monkeypatch):
    monkeypatch.setenv("FLIGHTOPS_MODEL_PATH", str(model_path))
    monkeypatch.syspath_prepend(str(SERVICE_DIR))
    main = importlib.import_module("app.main")
    with TestClient(main.app) as c:
        c.main = main
        yield c


def _payload(X, flight_ids=None):
    return {"windows": [
        {"flight_id": (flight_ids or [f"f{i}" for i in range(len(X))])[i], "window_start_seconds": 10,
         "telemetry": {name: X[i, :, k].astype(float).tolist() for k, name in enumerate(FEATURE_NAMES)}}
        for i in range(len(X))
    ]}


def test_health_and_model_info(client):
    assert client.get("/health").json() == {"status": "ok", "model_loaded": True, "load_error": None}
    info = client.get("/v1/model").json()
    assert info["input"]["variables"] == FEATURE_NAMES and info["input"]["timesteps"] == 160
    assert info["score_direction"] == "higher = more anomalous" and info["threshold"] > 0


def test_score_returns_contract_and_flags_outlier(client):
    X = _nominal_windows(2, seed=5)
    X[1, :, IDX["airspeed"]] += 80                     # strongly unusual approach
    X[1, :, IDX["airspeed"]] *= np.linspace(1, 3, N_TIMESTEPS)
    for name in ("flap", "pitch", "core_speed", "glideslope_dev"):
        X[1, :, IDX[name]] += 25
    r = client.post("/v1/score", json=_payload(X, ["normal-1", "odd-2"]), headers={"x-request-id": "abc123"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["request_id"] == "abc123" and r.headers["x-request-id"] == "abc123"
    e0, e1 = body["events"]
    assert e0["flight_id"] == "normal-1" and e0["window_start_seconds"] == 10 and e0["window_end_seconds"] == 169
    assert set(e0) >= {"model_name", "model_version", "anomaly_score", "threshold", "is_anomaly",
                       "supporting_features", "quality_flags", "interpretation"}
    assert e1["anomaly_score"] > e0["anomaly_score"] and e1["is_anomaly"]
    assert e1["supporting_features"][0]["feature"] in {"airspeed", "flap", "pitch", "core_speed", "glideslope_dev"}
    assert len(e1["supporting_features"]) == 3


def test_scoring_is_deterministic(client):
    p = _payload(_nominal_windows(1, seed=9))
    a = client.post("/v1/score", json=p).json()["events"][0]["anomaly_score"]
    b = client.post("/v1/score", json=p).json()["events"][0]["anomaly_score"]
    assert a == b


@pytest.mark.parametrize("mutate", [
    lambda p: p["windows"][0]["telemetry"].pop("flap"),                                # missing variable
    lambda p: p["windows"][0]["telemetry"].update(extra=[0.0] * 160),                  # unknown variable
    lambda p: p["windows"][0]["telemetry"].update(flap=[0.0] * 159),                   # wrong length
    lambda p: p["windows"][0].update(flight_id="../../etc/passwd"),                     # unsafe id
    lambda p: p["windows"][0].update(model_path="/tmp/x"),                              # extra field
    lambda p: p.update(windows=[]),                                                     # empty batch
])
def test_invalid_requests_rejected(client, mutate):
    p = _payload(_nominal_windows(1))
    mutate(p)
    assert client.post("/v1/score", json=p).status_code == 422


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), float("-inf")])
def test_non_finite_values_rejected_without_echo(client, bad):
    p = _payload(_nominal_windows(1))
    p["windows"][0]["telemetry"]["flap"][3] = bad
    body = json.dumps(p)  # Python's json writes NaN/Infinity; strict JSON clients would not
    r = client.post("/v1/score", content=body, headers={"content-type": "application/json"})
    assert r.status_code == 422
    err = r.json()
    assert err["error"] == "invalid_request" and "input" not in err["detail"][0]
    assert any("flap" in e["loc"] for e in err["detail"])


def test_batch_and_body_limits(client, monkeypatch):
    X = _nominal_windows(1)
    too_many = _payload(np.repeat(X, client.main.MAX_BATCH + 1, axis=0))
    assert client.post("/v1/score", json=too_many).status_code == 422
    monkeypatch.setattr(client.main, "MAX_BODY_BYTES", 1000)
    r = client.post("/v1/score", json=_payload(X))
    assert r.status_code == 413 and r.json()["error"] == "payload_too_large"


def test_missing_model_degrades_cleanly(tmp_path, monkeypatch):
    monkeypatch.setenv("FLIGHTOPS_MODEL_PATH", str(tmp_path / "missing.joblib"))
    monkeypatch.syspath_prepend(str(SERVICE_DIR))
    main = importlib.import_module("app.main")
    with TestClient(main.app) as c:
        h = c.get("/health")
        assert h.status_code == 503 and h.json()["model_loaded"] is False
        assert c.post("/v1/score", json=_payload(_nominal_windows(1))).status_code == 503


def test_predictor_rejects_mismatched_feature_set(tmp_path):
    det = IForestDetector(n_estimators=10).fit(np.random.default_rng(0).normal(size=(50, 4)), ["a", "b", "c", "d"])
    det.threshold = 0.5
    with pytest.raises(ValueError, match="different feature set"):
        Predictor.load(det.save(tmp_path / "old.joblib"))
    assert len(feature_names()) == 170
