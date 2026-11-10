"""Hybrid detector: Isolation Forest + per-feature tail probability.

Motivation (docs/evaluation-report.md): the Isolation Forest spreads attention over 170
features, so a single extreme feature (e.g. flap median at z = -18) can be averaged away.
A plain "max |z|" rule fails because several features are heavy-tailed even on nominal
approaches. Instead each feature is judged against its OWN nominal distribution:

    tail_j(x) = two-sided empirical tail mass of feature j among nominal training windows
    tail score = sum of the 3 largest -log10(2 * tail_j)

Both component scores are mapped to percentiles of nominal *calibration* windows, and the
hybrid score is their maximum: a window alerts if EITHER component is unusual. All fitting and
calibration uses nominal windows only (no anomaly labels).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import joblib
import numpy as np

from flightops.models.isolation_forest import IForestDetector

MODEL_NAME = "if_tail_hybrid"
# 0.3.0: feature set v2 (did not transfer to unseen aircraft); 0.4.0: feature set v3
MODEL_VERSION = "0.4.0"
TOP_K = 3


@dataclass
class TailScorer:
    """Per-feature two-sided tail probability against nominal data (compact quantile grid)."""
    n_levels: int = 256
    levels: np.ndarray | None = None      # (L,) ascending cumulative probabilities
    quantiles: np.ndarray | None = None   # (L, n_features)
    n_ref: int = 0

    def fit(self, F: np.ndarray) -> "TailScorer":
        n = F.shape[0]
        tails = np.logspace(np.log10(1.0 / n), np.log10(0.5), self.n_levels)
        self.levels = np.concatenate([tails, 1.0 - tails[::-1][1:]])
        self.quantiles = np.quantile(F, self.levels, axis=0).astype(np.float64)
        self.n_ref = n
        return self

    def neg_log_tail(self, F: np.ndarray) -> np.ndarray:
        """(n, d) -> (n, d) values of -log10(two-sided tail probability), floored at 1/n_ref."""
        # Tie-aware: many flight statistics repeat exactly (e.g. 41% of nominal windows share one
        # flap IQR value). P(X <= x) and P(X >= x) are looked up separately, so a common tied value
        # gets a large tail mass on both sides (little evidence), never the edge of the tied run.
        F = np.asarray(F, dtype=np.float64)
        out = np.empty_like(F)
        floor = 1.0 / self.n_ref
        L = self.levels.size
        for j in range(F.shape[1]):
            q, x = self.quantiles[:, j], F[:, j]
            i_left = np.searchsorted(q, x, side="left")     # first grid point with q >= x
            i_right = np.searchsorted(q, x, side="right")   # number of grid points with q <= x
            p_le = np.where(i_right > 0, self.levels[np.maximum(i_right - 1, 0)], 0.0)
            p_ge = np.where(i_left >= L, 0.0, np.where(i_left > 0, 1.0 - self.levels[np.maximum(i_left - 1, 0)], 1.0))
            tail = np.minimum(p_le, p_ge)
            out[:, j] = -np.log10(np.clip(2.0 * tail, floor, 1.0))
        return out

    def score(self, F: np.ndarray, top_k: int = TOP_K) -> np.ndarray:
        e = self.neg_log_tail(F)
        return np.sort(e, axis=1)[:, -top_k:].sum(axis=1)


def _percentile(reference_sorted: np.ndarray, s: np.ndarray) -> np.ndarray:
    return np.searchsorted(reference_sorted, s, side="right") / reference_sorted.size


@dataclass
class HybridDetector:
    forest: IForestDetector = field(default_factory=IForestDetector)
    tail: TailScorer = field(default_factory=TailScorer)
    feature_names: list[str] = field(default_factory=list)
    ref_forest: np.ndarray | None = None   # sorted nominal-calibration scores
    ref_tail: np.ndarray | None = None
    threshold: float | None = None

    def fit(self, F_nominal: np.ndarray, feature_names: list[str]) -> "HybridDetector":
        self.feature_names = list(feature_names)
        self.forest.fit(F_nominal, feature_names)
        self.tail.fit(F_nominal)
        return self

    def calibrate(self, F_nominal_cal: np.ndarray, target_fpr: float) -> "HybridDetector":
        """Percentile references and threshold from held-out NOMINAL windows only."""
        self.ref_forest = np.sort(self.forest.score(F_nominal_cal)).astype(np.float64)
        self.ref_tail = np.sort(self.tail.score(F_nominal_cal)).astype(np.float64)
        self.threshold = float(np.quantile(self.score(F_nominal_cal), 1 - target_fpr))
        return self

    def components(self, F: np.ndarray) -> dict[str, np.ndarray]:
        return {"forest": self.forest.score(F), "tail": self.tail.score(F)}

    def score(self, F: np.ndarray) -> np.ndarray:
        """Hybrid score in [0, ~1]: max of the two nominal percentiles (higher = more anomalous).
        A tiny tail-based tie-break orders windows that are beyond every calibration window."""
        c = self.components(F)
        p = np.maximum(_percentile(self.ref_forest, c["forest"]), _percentile(self.ref_tail, c["tail"]))
        return p + 1e-6 * np.tanh(c["tail"] / 50.0)

    def predict(self, F: np.ndarray) -> np.ndarray:
        if self.threshold is None:
            raise RuntimeError("Not calibrated")
        return self.score(F) >= self.threshold

    def save(self, path: str | Path) -> Path:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump({"name": MODEL_NAME, "version": MODEL_VERSION, "detector": self}, path)
        return path

    @staticmethod
    def load(path: str | Path) -> "HybridDetector":
        """joblib uses pickle: only load artifacts this project produced."""
        bundle = joblib.load(path)
        if bundle.get("name") != MODEL_NAME:
            raise ValueError(f"Not an {MODEL_NAME} artifact: {path}")
        return bundle["detector"]
