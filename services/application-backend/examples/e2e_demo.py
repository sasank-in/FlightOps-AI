"""End-to-end demo: real dataset windows -> backend upload -> analysis (via inference API) -> anomalies.

Prerequisites (both running locally):
    inference API : uvicorn app.main:app --app-dir services/inference-api --port 8000
    backend       : see services/application-backend/README.md (port 8080)

Usage (conda env `environ`, from the repo root):
    python services/application-backend/examples/e2e_demo.py

Credentials are read from the repo-root .env (FLIGHTOPS_ADMIN_USERNAME / FLIGHTOPS_ADMIN_PASSWORD)
and are never printed. Exit code 0 only if backend results equal the offline evaluation scores.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request

import numpy as np
from dotenv import dotenv_values

from flightops.config import project_root
from flightops.data.processed import load_processed
from flightops.data.schema import FEATURE_NAMES, LABELS


def call(method: str, url: str, token: str | None = None, body: dict | None = None) -> tuple[int, dict]:
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.status, json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def main(argv=None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--backend", default="http://127.0.0.1:8080")
    p.add_argument("--per-class", type=int, default=1, help="windows per class to upload (max 500 total)")
    args = p.parse_args(argv)
    base = args.backend.rstrip("/")

    env = dotenv_values(project_root() / ".env")
    status, tok = call("POST", f"{base}/api/v1/auth/login", body={
        "username": env.get("FLIGHTOPS_ADMIN_USERNAME", "admin"), "password": env.get("FLIGHTOPS_ADMIN_PASSWORD", "")})
    if status != 200:
        print(f"login failed: HTTP {status} {tok.get('detail')}")
        return 1
    token = tok["access_token"]

    X, y = load_processed()
    offline = np.load(project_root() / "artifacts/reports/hybrid_scores.npz")
    test = offline["split"] == "test"
    rng = np.random.default_rng(1)
    idx = np.concatenate([rng.choice(np.flatnonzero(test & (y == k)), args.per_class, replace=False) for k in LABELS])

    windows = [{"windowStartSeconds": 160 * j,
                "telemetry": {n: X[i, :, k].astype(float).tolist() for k, n in enumerate(FEATURE_NAMES)}}
               for j, i in enumerate(idx)]
    status, flight = call("POST", f"{base}/api/v1/flights/upload", token, {
        "externalFlightReference": f"DASHLINK-DEMO-{int(time.time())}", "datasetId": "dashlink-4class",
        "metadata": {"source_windows": [int(i) for i in idx]}, "windows": windows})
    if status != 201:
        print(f"upload failed: HTTP {status} {flight}")
        return 1
    print(f"uploaded flight {flight['id']} with {flight['nWindows']} windows")

    status, run = call("POST", f"{base}/api/v1/flights/{flight['id']}/analyses", token)
    print(f"analysis {run['id']} started: HTTP {status} {run['status']}")
    for _ in range(120):
        _, run = call("GET", f"{base}/api/v1/analyses/{run['id']}", token)
        if run["status"] in ("COMPLETED", "FAILED"):
            break
        time.sleep(0.5)
    print(f"analysis {run['id']}: {run['status']} | model {run['modelName']} {run['modelVersion']} | metrics {run['metrics']}"
          + (f" | error: {run['error']}" if run.get("error") else ""))
    if run["status"] != "COMPLETED":
        return 1

    _, an = call("GET", f"{base}/api/v1/flights/{flight['id']}/anomalies", token)
    worst = 0.0
    for e, i in zip(an["events"], idx):
        diff = abs(e["anomalyScore"] - float(offline["scores_hybrid"][i]))
        worst = max(worst, diff)
        top = e["evidence"]["supporting_features"][0]
        print(f"  window {e['windowIndex']} (dataset #{i}, label={LABELS[int(y[i])]:18s}) score={e['anomalyScore']:.4f} "
              f"{e['severityLabel']:15s} top: {top['feature']}.{top['statistic']}")
    print(f"max |backend - offline| score difference: {worst:.2e}")
    return 0 if worst < 1e-4 else 1


if __name__ == "__main__":
    sys.exit(main())
