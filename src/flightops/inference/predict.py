"""Score telemetry windows with the selected detector (Isolation Forest v2) and build anomaly
events in the contract of documentation.md §15.

Supporting features are the window features that deviate most from the model's *nominal
training* distribution (standardised z-scores). They describe what is unusual about the window;
they are not causal explanations and not attributions of the model's internal decision.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from flightops.config import project_root
from flightops.data.quality import window_quality_flags
from flightops.data.schema import FEATURE_NAMES, FEATURES
from flightops.features.build_features import FEATURE_SET_VERSION, build_window_features, feature_names
from flightops.models.isolation_forest import MODEL_NAME, MODEL_VERSION, IForestDetector

N_TIMESTEPS = 160
INTERPRETATION = (
    "Experimental statistical anomaly relative to nominal training approaches; "
    "engineering review required. Not a confirmed fault or a safety determination."
)
UNITS = {short: unit for _, short, unit in FEATURES}


def default_model_path() -> Path:
    env = os.environ.get("FLIGHTOPS_MODEL_PATH")
    if env:
        return Path(env)
    return project_root() / "artifacts" / "models" / f"{MODEL_NAME}_v{MODEL_VERSION}.joblib"


@dataclass
class Predictor:
    detector: IForestDetector
    model_name: str = MODEL_NAME
    model_version: str = MODEL_VERSION
    evaluation: dict = field(default_factory=dict)

    @classmethod
    def load(cls, path: str | Path | None = None, report_path: str | Path | None = None) -> "Predictor":
        path = Path(path) if path else default_model_path()
        if not path.is_file():
            raise FileNotFoundError(f"Model artifact not found: {path}. Run `python -m flightops.models.train_baseline`.")
        det = IForestDetector.load(path)
        if det.threshold is None:
            raise ValueError("Model artifact has no calibrated threshold")
        if det.feature_names != feature_names():
            raise ValueError(
                f"Model was trained on a different feature set than this code ({FEATURE_SET_VERSION}). "
                "Retrain or load a matching artifact."
            )
        evaluation = {}
        report = Path(report_path) if report_path else project_root() / "artifacts" / "reports" / "baseline_isolation_forest.json"
        if report.is_file():
            r = json.loads(report.read_text(encoding="utf-8"))
            if r.get("model", {}).get("version") == MODEL_VERSION:
                test = r["primary_stratified"]["test_at_budget"]["binary"]
                evaluation = {
                    "threshold_policy": r.get("threshold_policy"),
                    "test_precision": round(test["precision"], 3),
                    "test_recall": round(test["recall"], 3),
                    "test_pr_auc": round(test["pr_auc"], 3),
                    "aircraft_held_out_pr_auc_mean": round(r["aircraft_held_out"]["summary"]["pr_auc"]["mean"], 3),
                    "report_created_at": r.get("created_at"),
                }
        return cls(detector=det, evaluation=evaluation)

    @property
    def threshold(self) -> float:
        return float(self.detector.threshold)

    def metadata(self) -> dict:
        return {
            "model_name": self.model_name,
            "model_version": self.model_version,
            "feature_set_version": FEATURE_SET_VERSION,
            "n_features": len(self.detector.feature_names),
            "input": {"timesteps": N_TIMESTEPS, "sampling_hz": 1, "variables": FEATURE_NAMES, "units": UNITS},
            "threshold": self.threshold,
            "score_direction": "higher = more anomalous",
            "evaluation": self.evaluation,
            "interpretation": INTERPRETATION,
        }

    def score_windows(self, X: np.ndarray, top_k: int = 3) -> list[dict]:
        """X: (n, 160, 20) raw telemetry in schema order. Returns one result dict per window."""
        X = np.asarray(X, dtype=np.float32)
        if X.ndim != 3 or X.shape[1:] != (N_TIMESTEPS, len(FEATURE_NAMES)):
            raise ValueError(f"Expected shape (n, {N_TIMESTEPS}, {len(FEATURE_NAMES)}), got {X.shape}")
        if not np.isfinite(X).all():
            raise ValueError("Telemetry contains NaN or infinite values")

        F = build_window_features(X)
        scores = self.detector.score(F.to_numpy())
        z = self.detector.scaler.transform(F.to_numpy())
        flags = window_quality_flags(X)
        names = list(F.columns)

        results = []
        for i in range(X.shape[0]):
            # strongest deviation per channel, then top-k channels
            best: dict[str, tuple[float, str]] = {}
            for j in np.argsort(-np.abs(z[i])):
                channel, stat = names[j].split("__")
                if channel not in best:
                    best[channel] = (float(z[i, j]), stat)
                if len(best) >= top_k:
                    break
            supporting = [
                {
                    "feature": channel,
                    "statistic": stat,
                    "observed_value": round(float(F.iat[i, names.index(f"{channel}__{stat}")]), 4),
                    "z_score_vs_nominal_training": round(zv, 2),
                    "unit": UNITS.get(channel.replace("_rel_end", ""), ""),
                }
                for channel, (zv, stat) in best.items()
            ]
            row = flags.iloc[i]
            results.append({
                "anomaly_score": round(float(scores[i]), 6),
                "is_anomaly": bool(scores[i] >= self.threshold),
                "supporting_features": supporting,
                "quality_flags": {
                    "pressure_invalid": bool(row.pressure_invalid),
                    "flap_jump": bool(row.flap_jump),
                    "heading_out_of_range": bool(row.heading_out_of_range),
                    "course_mismatch": bool(row.course_mismatch),
                    "vert_accel_spike_count": int(row.vert_accel_spikes),
                },
            })
        return results
