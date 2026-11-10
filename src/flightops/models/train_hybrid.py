"""Train, select and evaluate the hybrid detector (Isolation Forest + per-feature tail rule).

Data roles (no anomaly labels used for fitting or calibration):
    fit          85% of nominal training-split windows (excl. pressure_invalid)
    calibration  other 15%: nominal percentiles + 5% false-alarm threshold
    validation   method SELECTION only (forest vs tail vs hybrid, by validation PR-AUC)
    test         final numbers, reported once for every method
Plus 5 aircraft-held-out folds for the same three methods.

Usage:
    python -m flightops.models.train_hybrid
"""

from __future__ import annotations

import argparse
import json
import platform
import sys
from datetime import datetime, timezone

import numpy as np
import sklearn
import yaml

from flightops import __version__
from flightops.config import project_root
from flightops.data.splits import TEST, TRAIN, VAL, aircraft_folds
from flightops.evaluation.metrics import threshold_at_fpr
from flightops.features.build_features import FEATURE_SET_VERSION, load_or_build_features
from flightops.models.hybrid import MODEL_NAME, MODEL_VERSION, HybridDetector, _percentile
from flightops.models.isolation_forest import IForestDetector
from flightops.pipeline import evaluate, evaluate_with_and_without_concern, load_experiment_data

METHODS = ("forest", "tail", "hybrid")


def _method_scores(det: HybridDetector, F: np.ndarray) -> dict[str, np.ndarray]:
    c = det.components(F)
    return {"forest": c["forest"], "tail": c["tail"], "hybrid": det.score(F)}


def _fit(F_fit, F_cal, names, cfg, target_fpr) -> tuple[HybridDetector, dict[str, float]]:
    ifc = cfg["isolation_forest"]
    det = HybridDetector(forest=IForestDetector(n_estimators=ifc["n_estimators"], max_samples=ifc["max_samples"],
                                                random_state=cfg["random_seed"]))
    det.fit(F_fit, names).calibrate(F_cal, target_fpr)
    cal = _method_scores(det, F_cal)
    thresholds = {m: threshold_at_fpr(cal[m], target_fpr) for m in METHODS}
    det.forest.threshold = thresholds["forest"]
    return det, thresholds


def run(cfg: dict, log=print) -> tuple[dict, HybridDetector, dict]:
    root = project_root()
    seed, target_fpr = cfg["random_seed"], cfg["threshold"]["target_fpr"]
    data = load_experiment_data(cfg)
    F = load_or_build_features(data.X, root / "data" / "processed")
    names, F = list(F.columns), F.to_numpy()
    y, split = data.y, data.split
    rng = np.random.default_rng(seed)
    nominal_ok = (y == 0) & ~data.pressure_invalid

    nom_train = rng.permutation(np.flatnonzero((split == TRAIN) & nominal_ok))
    n_cal = int(0.15 * len(nom_train))
    cal_idx, fit_idx = np.sort(nom_train[:n_cal]), np.sort(nom_train[n_cal:])
    log(f"fit {len(fit_idx)} | calibration {len(cal_idx)} nominal windows")
    det, thresholds = _fit(F[fit_idx], F[cal_idx], names, cfg, target_fpr)

    scores = _method_scores(det, F)
    val, test = split == VAL, split == TEST
    validation = {m: evaluate(y[val], scores[m][val], thresholds[m]) for m in METHODS}
    selected = max(METHODS, key=lambda m: validation[m]["binary"]["pr_auc"])
    log("validation PR-AUC: " + ", ".join(f"{m}={validation[m]['binary']['pr_auc']:.3f}" for m in METHODS)
        + f" -> selected: {selected}")
    test_results = {m: evaluate_with_and_without_concern(data, test, scores[m], thresholds[m]) for m in METHODS}

    folds = []
    for k, (tr, te) in enumerate(aircraft_folds(y, data.aircraft, data.duplicate, cfg["split"]["aircraft_cv_folds"], seed)):
        nom = rng.permutation(tr[nominal_ok[tr]])
        c = int(0.15 * len(nom))
        fdet, fthr = _fit(F[np.sort(nom[c:])], F[np.sort(nom[:c])], names, cfg, target_fpr)
        fs = _method_scores(fdet, F[te])
        folds.append({"fold": k, "test_aircraft": sorted(set(data.aircraft[te].tolist())),
                      **{m: evaluate(y[te], fs[m], fthr[m]) for m in METHODS}})
        log(f"aircraft fold {k}: " + ", ".join(f"{m} PR-AUC {folds[-1][m]['binary']['pr_auc']:.3f}" for m in METHODS))

    def summary(m):
        out = {}
        for key in ("precision", "recall", "f1", "fpr", "pr_auc", "roc_auc"):
            v = np.array([f[m]["binary"][key] for f in folds])
            out[key] = {"mean": float(v.mean()), "std": float(v.std())}
        return out

    det.threshold = thresholds["hybrid"]
    report = {
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "model": {"name": MODEL_NAME, "version": MODEL_VERSION, "components": "IsolationForest + top-3 feature tail",
                  **cfg["isolation_forest"]},
        "feature_set": {"version": FEATURE_SET_VERSION, "n_features": len(names)},
        "split_fingerprint": data.split_fingerprint,
        "data_roles": {"fit": int(len(fit_idx)), "calibration": int(len(cal_idx)),
                       "selection": "validation split", "final": "test split"},
        "threshold_policy": f"alert on top {target_fpr:.0%} of nominal calibration scores (per method)",
        "thresholds": thresholds,
        "selection": {"metric": "validation PR-AUC", "selected": selected,
                      "validation": {m: validation[m] for m in METHODS}},
        "test": test_results,
        "aircraft_held_out": {"folds": folds, "summary": {m: summary(m) for m in METHODS}},
        "environment": {"flightops": __version__, "python": platform.python_version(),
                        "numpy": np.__version__, "sklearn": sklearn.__version__, "seed": seed},
    }
    arrays = {f"scores_{m}": scores[m].astype(np.float64) for m in METHODS}
    arrays.update(split=split.astype(str), labels=y, aircraft=data.aircraft.astype(str))
    return report, det, arrays


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--config", default=None)
    args = p.parse_args(argv)
    root = project_root()
    with open(args.config or root / "configs" / "model.yaml", encoding="utf-8") as fh:
        cfg = yaml.safe_load(fh)
    report, det, arrays = run(cfg, log=lambda *a: print(*a, flush=True))
    model_path = det.save(root / "artifacts" / "models" / f"{MODEL_NAME}_v{MODEL_VERSION}.joblib")
    reports = root / "artifacts" / "reports"
    (reports / "hybrid.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    np.savez_compressed(reports / "hybrid_scores.npz", **arrays)
    print(f"Model saved: {model_path}")
    for m in METHODS:
        t = report["test"][m]["all"]
        s = report["aircraft_held_out"]["summary"][m]["pr_auc"]
        print(f"TEST {m:7s} P={t['binary']['precision']:.3f} R={t['binary']['recall']:.3f} "
              f"PR-AUC={t['binary']['pr_auc']:.3f} FPR={t['binary']['fpr']:.3f} | aircraft-CV PR-AUC {s['mean']:.3f}±{s['std']:.3f} | "
              + ", ".join(f"{k}={v:.2f}" for k, v in t["alert_rate_by_class"].items()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
