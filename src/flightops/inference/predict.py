"""Score telemetry windows with the served detector and build anomaly events in the contract of
documentation.md §15.

Served model (docs/evaluation-report.md): `if_tail_hybrid` 0.4.0, i.e. Isolation Forest +
per-feature tail rule on input set v3. A plain Isolation Forest artifact can also be served
(set FLIGHTOPS_MODEL_PATH); the artifact's own name decides how it is scored.

Supporting features describe what is unusual about the window relative to *nominal training*
windows (tail probability and z-score). They are not causal explanations and not attributions
of the model's internal decision.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path

import joblib
import numpy as np

from flightops.config import project_root
from flightops.data.quality import window_quality_flags
from flightops.data.schema import FEATURE_NAMES, FEATURES
from flightops.features.build_features import FEATURE_SET_VERSION, base_variable, build_window_features, feature_names
from flightops.models import hybrid as hybrid_mod
from flightops.models import isolation_forest as forest_mod
from flightops.models.hybrid import HybridDetector, _percentile
from flightops.models.isolation_forest import IForestDetector

N_TIMESTEPS = 160
INTERPRETATION = (
    "Experimental statistical anomaly relative to nominal training approaches; "
    "engineering review required. Not a confirmed fault or a safety determination."
)
UNITS = {short: unit for _, short, unit in FEATURES}
SERVED_MODEL = f"{hybrid_mod.MODEL_NAME}_v{hybrid_mod.MODEL_VERSION}.joblib"
REPORTS = {hybrid_mod.MODEL_NAME: "hybrid.json", forest_mod.MODEL_NAME: "baseline_isolation_forest.json"}


def default_model_path() -> Path:
    env = os.environ.get("FLIGHTOPS_MODEL_PATH")
    return Path(env) if env else project_root() / "artifacts" / "models" / SERVED_MODEL


def _evaluation_summary(model_name: str, version: str) -> dict:
    report = project_root() / "artifacts" / "reports" / REPORTS[model_name]
    if not report.is_file():
        return {}
    r = json.loads(report.read_text(encoding="utf-8"))
    if r.get("model", {}).get("version") != version:
        return {}
    if model_name == hybrid_mod.MODEL_NAME:
        test, cv = r["test"]["hybrid"]["all"]["binary"], r["aircraft_held_out"]["summary"]["hybrid"]["pr_auc"]
    else:
        test, cv = r["primary_stratified"]["test_at_budget"]["binary"], r["aircraft_held_out"]["summary"]["pr_auc"]
    return {
        "threshold_policy": r.get("threshold_policy"),
        "test_precision": round(test["precision"], 3),
        "test_recall": round(test["recall"], 3),
        "test_pr_auc": round(test["pr_auc"], 3),
        "aircraft_held_out_pr_auc_mean": round(cv["mean"], 3),
        "report_created_at": r.get("created_at"),
    }


@dataclass
class Predictor:
    detector: HybridDetector | IForestDetector
    model_name: str
    model_version: str
    evaluation: dict = field(default_factory=dict)

    @classmethod
    def load(cls, path: str | Path | None = None) -> "Predictor":
        path = Path(path) if path else default_model_path()
        if not path.is_file():
            raise FileNotFoundError(f"Model artifact not found: {path}. Run `python -m flightops.models.train_hybrid`.")
        bundle = joblib.load(path)  # pickle: only load artifacts produced by this project
        name, version, det = bundle.get("name"), bundle.get("version"), bundle.get("detector")
        expected = {hybrid_mod.MODEL_NAME: HybridDetector, forest_mod.MODEL_NAME: IForestDetector}
        if name not in expected or not isinstance(det, expected[name]):
            raise ValueError(f"Unsupported model artifact {name!r} in {path}")
        if det.threshold is None:
            raise ValueError("Model artifact has no calibrated threshold")
        if det.feature_names != feature_names():
            raise ValueError(
                f"Model was trained on a different feature set than this code ({FEATURE_SET_VERSION}). "
                "Retrain or load a matching artifact."
            )
        return cls(detector=det, model_name=name, model_version=version, evaluation=_evaluation_summary(name, version))

    @property
    def is_hybrid(self) -> bool:
        return isinstance(self.detector, HybridDetector)

    @property
    def threshold(self) -> float:
        return float(self.detector.threshold)

    def metadata(self) -> dict:
        direction = ("higher = more anomalous; max of the forest and tail-rule percentiles among nominal "
                     "calibration windows (0-1)" if self.is_hybrid else "higher = more anomalous")
        return {
            "model_name": self.model_name,
            "model_version": self.model_version,
            "feature_set_version": FEATURE_SET_VERSION,
            "n_features": len(self.detector.feature_names),
            "input": {"timesteps": N_TIMESTEPS, "sampling_hz": 1, "variables": FEATURE_NAMES, "units": UNITS},
            "threshold": self.threshold,
            "score_direction": direction,
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

        F_df = build_window_features(X)
        F, names = F_df.to_numpy(), list(F_df.columns)
        forest = self.detector.forest if self.is_hybrid else self.detector
        z = forest.scaler.transform(F)
        scores = self.detector.score(F)
        if self.is_hybrid:
            comps = self.detector.components(F)
            pct_forest = _percentile(self.detector.ref_forest, comps["forest"])
            pct_tail = _percentile(self.detector.ref_tail, comps["tail"])
            evidence = self.detector.tail.neg_log_tail(F)          # -log10 two-sided tail probability
            rank_key = evidence + 1e-6 * np.abs(z)                 # rarest first; |z| breaks ties
        else:
            rank_key = np.abs(z)
        flags = window_quality_flags(X)

        results = []
        for i in range(X.shape[0]):
            best: dict[str, int] = {}
            for j in np.argsort(-rank_key[i]):
                channel = names[j].split("__")[0]
                if channel not in best:
                    best[channel] = int(j)
                if len(best) >= top_k:
                    break
            supporting = []
            for channel, j in best.items():
                item = {
                    "feature": channel,
                    "statistic": names[j].split("__")[1],
                    "observed_value": round(float(F[i, j]), 4),
                    "z_score_vs_nominal_training": round(float(z[i, j]), 2),
                    "unit": UNITS.get(base_variable(channel), ""),
                }
                if self.is_hybrid:
                    item["tail_probability_vs_nominal"] = float(f"{10 ** -evidence[i, j]:.3g}")
                supporting.append(item)
            row = flags.iloc[i]
            result = {
                "anomaly_score": round(float(scores[i]), 8),
                "is_anomaly": bool(scores[i] >= self.threshold),
                "supporting_features": supporting,
                "quality_flags": {
                    "pressure_invalid": bool(row.pressure_invalid),
                    "flap_jump": bool(row.flap_jump),
                    "heading_out_of_range": bool(row.heading_out_of_range),
                    "course_mismatch": bool(row.course_mismatch),
                    "vert_accel_spike_count": int(row.vert_accel_spikes),
                },
            }
            if self.is_hybrid:
                result["score_components"] = {"forest_percentile": round(float(pct_forest[i]), 6),
                                              "tail_percentile": round(float(pct_tail[i]), 6)}
            results.append(result)
        return results
