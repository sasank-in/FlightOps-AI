"""Send real dataset windows to a running inference API and compare with offline scores.

Usage (server already running on port 8000, conda env `environ`):
    python services/inference-api/examples/demo_client.py
    python services/inference-api/examples/demo_client.py --url http://127.0.0.1:8000 --per-class 2

Reads the local processed data (never sent anywhere except the URL you give, default localhost).
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.request

import numpy as np

from flightops.config import project_root
from flightops.data.processed import load_processed
from flightops.data.schema import FEATURE_NAMES, LABELS


OFFLINE_SCORES = {  # model name -> (offline score file, array key) written by the training scripts
    "if_tail_hybrid": ("hybrid_scores.npz", "scores_hybrid"),
    "isolation_forest": ("baseline_isolation_forest_scores.npz", "scores"),
}


def get(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=30) as resp:
        return json.loads(resp.read())


def post(url: str, payload: dict) -> dict:
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), method="POST",
                                 headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read())


def main(argv=None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--url", default="http://127.0.0.1:8000")
    p.add_argument("--per-class", type=int, default=1)
    args = p.parse_args(argv)

    base = args.url.rstrip("/")
    info = get(base + "/v1/model")
    file_name, key = OFFLINE_SCORES[info["model_name"]]
    print(f"server model: {info['model_name']} {info['model_version']} (input set {info['feature_set_version']})")
    X, y = load_processed()
    offline = np.load(project_root() / "artifacts" / "reports" / file_name)
    offline_scores = offline[key]
    test = offline["split"] == "test"
    rng = np.random.default_rng(0)
    idx = np.concatenate([rng.choice(np.flatnonzero(test & (y == k)), args.per_class, replace=False) for k in LABELS])

    payload = {"windows": [
        {"flight_id": f"window-{i}", "telemetry": {n: X[i, :, k].astype(float).tolist() for k, n in enumerate(FEATURE_NAMES)}}
        for i in idx
    ]}
    events = post(base + "/v1/score", payload)["events"]
    worst = 0.0
    for i, e in zip(idx, events):
        diff = abs(e["anomaly_score"] - float(offline_scores[i]))
        worst = max(worst, diff)
        top = ", ".join(
            f"{s['feature']}.{s['statistic']} z={s['z_score_vs_nominal_training']:+.1f}"
            + (f" p={s['tail_probability_vs_nominal']:.1e}" if s.get("tail_probability_vs_nominal") is not None else "")
            for s in e["supporting_features"])
        flags = [k for k, v in e["quality_flags"].items() if v]
        print(f"{e['flight_id']:13s} label={LABELS[int(y[i])]:18s} score={e['anomaly_score']:.4f} "
              f"alert={str(e['is_anomaly']):5s} | {top}" + (f" | flags: {flags}" if flags else ""))
    print(f"threshold={events[0]['threshold']:.4f} | max |API - offline| score difference: {worst:.2e}")
    return 0 if worst < 1e-4 else 1


if __name__ == "__main__":
    sys.exit(main())
