"""Train and evaluate the Isolation Forest baseline.

Usage:
    python -m flightops.models.train_baseline

Writes:
    artifacts/models/isolation_forest_v<version>.joblib
    artifacts/reports/baseline_isolation_forest.json
    artifacts/reports/baseline_isolation_forest_scores.npz   (per-window scores + split)
"""

from __future__ import annotations

import argparse
import json
import platform
import sys
import time
from datetime import datetime, timezone

import numpy as np
import pandas as pd
import sklearn
import yaml

from flightops import __version__
from flightops.config import load_data_config, project_root
from flightops.data.processed import load_processed
from flightops.data.quality import duplicate_mask, parse_flight_record, window_quality_flags
from flightops.data.schema import LABELS
from flightops.data.splits import TEST, TRAIN, VAL, aircraft_folds, split_summary, stratified_split
from flightops.evaluation.metrics import best_f1_threshold, binary_metrics, per_class_alert_rate, threshold_at_fpr
from flightops.features.build_features import FEATURE_SET_VERSION, load_or_build_features
from flightops.models.isolation_forest import MODEL_NAME, MODEL_VERSION, IForestDetector


def _evaluate(labels, scores, threshold) -> dict:
    return {
        "binary": binary_metrics(labels, scores, threshold),
        "alert_rate_by_class": per_class_alert_rate(labels, scores, threshold, LABELS),
    }


def run_baseline(model_cfg: dict) -> tuple[dict, IForestDetector, dict]:
    seed = model_cfg["random_seed"]
    target_fpr = model_cfg["threshold"]["target_fpr"]
    if_cfg = model_cfg["isolation_forest"]
    root = project_root()

    cfg = load_data_config()
    X, y = load_processed()
    meta = pd.read_csv(cfg.metadata_path, dtype={"flight_record": str})
    aircraft = parse_flight_record(meta["flight_record"])["aircraft_id"].to_numpy()
    F = load_or_build_features(X, root / "data" / "processed")
    names = list(F.columns)
    F = F.to_numpy()
    duplicate = duplicate_mask(X)
    pressure_invalid = window_quality_flags(X)["pressure_invalid"].to_numpy()

    def detector():
        return IForestDetector(n_estimators=if_cfg["n_estimators"], max_samples=if_cfg["max_samples"], random_state=seed)

    # --- Primary: stratified split -------------------------------------------------
    split = stratified_split(y, duplicate, model_cfg["split"]["validation_fraction"],
                             model_cfg["split"]["test_fraction"], seed)
    fit_mask = (split == TRAIN) & (y == 0) & ~pressure_invalid
    t0 = time.perf_counter()
    det = detector().fit(F[fit_mask], names)
    fit_seconds = time.perf_counter() - t0
    scores = det.score(F)

    val, test = split == VAL, split == TEST
    det.threshold = threshold_at_fpr(scores[val & (y == 0)], target_fpr)
    f1_threshold = best_f1_threshold(y[val] > 0, scores[val])

    primary = {
        "split_counts": split_summary(split, y, LABELS).to_dict(orient="index"),
        "n_fit_windows": int(fit_mask.sum()),
        "fit_seconds": round(fit_seconds, 2),
        "validation_at_budget": _evaluate(y[val], scores[val], det.threshold),
        "test_at_budget": _evaluate(y[test], scores[test], det.threshold),
        "test_at_val_best_f1_threshold": _evaluate(y[test], scores[test], f1_threshold),
    }

    # --- Robustness: aircraft held out -------------------------------------------
    rng = np.random.default_rng(seed)
    folds = []
    for k, (tr, te) in enumerate(aircraft_folds(y, aircraft, duplicate, model_cfg["split"]["aircraft_cv_folds"], seed)):
        nominal_tr = tr[(y[tr] == 0) & ~pressure_invalid[tr]]
        perm = rng.permutation(nominal_tr)
        n_cal = int(len(perm) * 0.15)
        cal, fit = perm[:n_cal], perm[n_cal:]
        fold_det = detector().fit(F[fit], names)
        thr = threshold_at_fpr(fold_det.score(F[cal]), target_fpr)
        te_scores = fold_det.score(F[te])
        result = _evaluate(y[te], te_scores, thr)
        result.update({
            "fold": k,
            "test_aircraft": sorted(set(aircraft[te].tolist())),
            "n_test": int(len(te)),
        })
        folds.append(result)

    def agg(key):
        vals = np.array([f["binary"][key] for f in folds])
        return {"mean": float(vals.mean()), "std": float(vals.std()), "min": float(vals.min()), "max": float(vals.max())}

    report = {
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "model": {"name": MODEL_NAME, "version": MODEL_VERSION, **if_cfg},
        "feature_set": {"version": FEATURE_SET_VERSION, "n_features": len(names)},
        "threshold_policy": f"alert on top {target_fpr:.0%} of nominal validation scores",
        "score_direction": "higher = more anomalous (negated IsolationForest.score_samples)",
        "excluded_duplicates": int(duplicate.sum()),
        "excluded_from_fit_pressure_invalid": int(pressure_invalid.sum()),
        "primary_stratified": primary,
        "aircraft_held_out": {
            "folds": folds,
            "summary": {k: agg(k) for k in ("precision", "recall", "f1", "fpr", "pr_auc", "roc_auc")},
        },
        "environment": {"flightops": __version__, "python": platform.python_version(),
                        "numpy": np.__version__, "sklearn": sklearn.__version__, "seed": seed},
    }
    arrays = {"scores": scores.astype(np.float32), "split": split.astype(str), "labels": y,
              "aircraft": aircraft.astype(str), "duplicate": duplicate, "f1_threshold": np.float64(f1_threshold)}
    return report, det, arrays


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Train and evaluate the Isolation Forest baseline")
    parser.add_argument("--config", default=None, help="Default: configs/model.yaml")
    args = parser.parse_args(argv)

    root = project_root()
    with open(args.config or root / "configs" / "model.yaml", encoding="utf-8") as fh:
        model_cfg = yaml.safe_load(fh)

    report, det, arrays = run_baseline(model_cfg)
    reports = root / "artifacts" / "reports"
    reports.mkdir(parents=True, exist_ok=True)
    model_path = det.save(root / "artifacts" / "models" / f"{MODEL_NAME}_v{MODEL_VERSION}.joblib")
    (reports / "baseline_isolation_forest.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    np.savez_compressed(reports / "baseline_isolation_forest_scores.npz", **arrays)

    t = report["primary_stratified"]["test_at_budget"]["binary"]
    s = report["aircraft_held_out"]["summary"]
    print(f"Model saved: {model_path}")
    print(f"Stratified test @ {model_cfg['threshold']['target_fpr']:.0%} nominal budget: "
          f"precision={t['precision']:.3f} recall={t['recall']:.3f} f1={t['f1']:.3f} "
          f"fpr={t['fpr']:.3f} PR-AUC={t['pr_auc']:.3f} ROC-AUC={t['roc_auc']:.3f}")
    print("Detection rate by class:", {k: round(v, 3) for k, v in report["primary_stratified"]["test_at_budget"]["alert_rate_by_class"].items()})
    print(f"Aircraft held out ({len(report['aircraft_held_out']['folds'])} folds): "
          f"PR-AUC {s['pr_auc']['mean']:.3f}±{s['pr_auc']['std']:.3f}, recall {s['recall']['mean']:.3f}±{s['recall']['std']:.3f}, "
          f"fpr {s['fpr']['mean']:.3f}±{s['fpr']['std']:.3f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
