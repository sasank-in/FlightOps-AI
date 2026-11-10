"""Train and evaluate the convolutional autoencoder on the same splits as the baseline.

Usage:
    python -m flightops.models.train_autoencoder                     # full run (GPU recommended)
    python -m flightops.models.train_autoencoder --smoke              # quick CPU check
    python -m flightops.models.train_autoencoder --aircraft-cv        # + 5 aircraft-held-out folds

Writes:
    artifacts/models/conv_autoencoder_v<version>.pt
    artifacts/reports/autoencoder.json
    artifacts/reports/autoencoder_scores.npz
"""

from __future__ import annotations

import argparse
import functools
import json
import platform
import sys
from dataclasses import asdict
from datetime import datetime, timezone

import numpy as np
import sklearn
import torch
import yaml

from flightops import __version__
from flightops.config import project_root
from flightops.data.schema import LABELS
from flightops.data.splits import TEST, TRAIN, VAL, aircraft_folds, split_summary
from flightops.evaluation.metrics import threshold_at_fpr
from flightops.features.build_features import FEATURE_SET_VERSION, channel_names, load_or_build_channels
from flightops.models.autoencoder import MODEL_NAME, MODEL_VERSION, AEConfig, AEDetector, resolve_device
from flightops.pipeline import evaluate, evaluate_with_and_without_concern, load_experiment_data


def _top_channels(per_channel: np.ndarray, labels: np.ndarray, names: list[str], k: int = 5) -> dict:
    """Channels whose mean reconstruction error rises most vs nominal, per class (supporting evidence only)."""
    nominal = per_channel[labels == 0].mean(axis=0)
    out = {}
    for c in (1, 2, 3):
        if np.any(labels == c):
            ratio = per_channel[labels == c].mean(axis=0) / np.maximum(nominal, 1e-9)
            top = np.argsort(-ratio)[:k]
            out[LABELS[c]] = {names[i]: round(float(ratio[i]), 2) for i in top}
    return out


def run_autoencoder(model_cfg: dict, ae_cfg: AEConfig, device: str = "auto", max_train: int | None = None,
                    aircraft_cv: bool = False, log=print) -> tuple[dict, AEDetector, dict]:
    root = project_root()
    seed = model_cfg["random_seed"]
    target_fpr = model_cfg["threshold"]["target_fpr"]
    data = load_experiment_data(model_cfg)
    log(f"device: {resolve_device(device)} | building/loading channel cache ...")
    channels = load_or_build_channels(data.X, root / "data" / "processed")
    names = channel_names()
    rng = np.random.default_rng(seed)
    y, split = data.y, data.split

    nominal_ok = (y == 0) & ~data.pressure_invalid
    train_idx = np.flatnonzero((split == TRAIN) & nominal_ok)
    val_nominal_idx = np.flatnonzero((split == VAL) & nominal_ok)
    if max_train:
        train_idx = np.sort(rng.choice(train_idx, min(max_train, len(train_idx)), replace=False))
        val_nominal_idx = np.sort(rng.choice(val_nominal_idx, min(max_train // 4, len(val_nominal_idx)), replace=False))

    det = AEDetector(config=ae_cfg).fit(channels, train_idx, val_nominal_idx, names, device=device, log=log)
    log("scoring all windows ...")
    scores, per_channel = det.score(channels)
    val, test = split == VAL, split == TEST
    det.threshold = threshold_at_fpr(scores[val & (y == 0)], target_fpr)

    report = {
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "model": {"name": MODEL_NAME, "version": MODEL_VERSION, **asdict(ae_cfg)},
        "input": {"channels_version": FEATURE_SET_VERSION, "n_channels": len(names), "timesteps": int(channels.shape[1])},
        "device": det.device,
        "smoke_run": bool(max_train),
        "threshold_policy": f"alert on top {target_fpr:.0%} of nominal validation scores",
        "score_direction": "higher = more anomalous (mean squared reconstruction error, standardised channels)",
        "split_fingerprint": data.split_fingerprint,
        "split_counts": split_summary(split, y, LABELS).to_dict(orient="index"),
        "n_fit_windows": int(len(train_idx)),
        "history": det.history,
        "validation_at_budget": evaluate(y[val], scores[val], det.threshold),
        "test_at_budget": evaluate_with_and_without_concern(data, test, scores, det.threshold),
        "top_error_channels_by_class_test": _top_channels(per_channel[test], y[test], names),
        "environment": {"flightops": __version__, "python": platform.python_version(), "numpy": np.__version__,
                        "torch": torch.__version__, "sklearn": sklearn.__version__,
                        "cuda_device": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None},
    }

    if aircraft_cv:
        folds = []
        for k, (tr, te) in enumerate(aircraft_folds(y, data.aircraft, data.duplicate,
                                                     model_cfg["split"]["aircraft_cv_folds"], seed)):
            nom = rng.permutation(tr[nominal_ok[tr]])
            n_cal = int(len(nom) * 0.15)
            cal, fit = np.sort(nom[:n_cal]), np.sort(nom[n_cal:])
            if max_train:
                fit = np.sort(rng.choice(fit, min(max_train, len(fit)), replace=False))
            log(f"--- aircraft fold {k}")
            fold_det = AEDetector(config=ae_cfg).fit(channels, fit, cal, names, device=device, log=log)
            thr = threshold_at_fpr(fold_det.score(channels, cal)[0], target_fpr)
            te_scores = fold_det.score(channels, te)[0]
            res = evaluate(y[te], te_scores, thr)
            res.update({"fold": k, "test_aircraft": sorted(set(data.aircraft[te].tolist())), "n_test": int(len(te))})
            folds.append(res)
        vals = {m: np.array([f["binary"][m] for f in folds]) for m in ("precision", "recall", "f1", "fpr", "pr_auc", "roc_auc")}
        report["aircraft_held_out"] = {
            "folds": folds,
            "summary": {m: {"mean": float(v.mean()), "std": float(v.std()), "min": float(v.min()), "max": float(v.max())}
                        for m, v in vals.items()},
        }

    arrays = {"scores": scores.astype(np.float32), "per_channel_error": per_channel.astype(np.float16),
              "split": split.astype(str), "labels": y, "aircraft": data.aircraft.astype(str)}
    return report, det, arrays


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Train and evaluate the convolutional autoencoder")
    p.add_argument("--config", default=None, help="Default: configs/model.yaml")
    p.add_argument("--device", default="auto", help="auto | cpu | cuda | mps")
    p.add_argument("--epochs", type=int, default=None)
    p.add_argument("--batch-size", type=int, default=None)
    p.add_argument("--aircraft-cv", action="store_true", help="Also run 5 aircraft-held-out folds")
    p.add_argument("--smoke", action="store_true", help="Tiny run (2,000 windows, 2 epochs) to check the pipeline")
    args = p.parse_args(argv)

    root = project_root()
    with open(args.config or root / "configs" / "model.yaml", encoding="utf-8") as fh:
        model_cfg = yaml.safe_load(fh)
    ae_cfg = AEConfig(**{**model_cfg.get("autoencoder", {}), "seed": model_cfg["random_seed"]})
    if args.epochs:
        ae_cfg.epochs = args.epochs
    if args.batch_size:
        ae_cfg.batch_size = args.batch_size
    max_train = None
    if args.smoke:
        ae_cfg.epochs, max_train = 2, 2000

    log = functools.partial(print, flush=True)  # show progress live even when output is redirected
    report, det, arrays = run_autoencoder(model_cfg, ae_cfg, args.device, max_train, args.aircraft_cv, log=log)
    suffix = "_smoke" if args.smoke else ""
    model_path = det.save(root / "artifacts" / "models" / f"{MODEL_NAME}_v{MODEL_VERSION}{suffix}.pt")
    reports = root / "artifacts" / "reports"
    reports.mkdir(parents=True, exist_ok=True)
    (reports / f"autoencoder{suffix}.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    np.savez_compressed(reports / f"autoencoder{suffix}_scores.npz", **arrays)

    t = report["test_at_budget"]["all"]["binary"]
    print(f"Model saved: {model_path}")
    print(f"Test @ budget: precision={t['precision']:.3f} recall={t['recall']:.3f} PR-AUC={t['pr_auc']:.3f} ROC-AUC={t['roc_auc']:.3f}")
    print("Detection by class:", {k: round(v, 3) for k, v in report["test_at_budget"]["all"]["alert_rate_by_class"].items()})
    return 0


if __name__ == "__main__":
    sys.exit(main())
