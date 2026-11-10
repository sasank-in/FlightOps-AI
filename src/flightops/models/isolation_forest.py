"""Isolation Forest baseline on window features.

Score convention: `score()` returns higher = more anomalous (negated sklearn score_samples).
The decision threshold is set from nominal validation data (an alert budget), not from
`contamination`, which only shifts sklearn's built-in threshold and is not a prevalence estimate.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import joblib
import numpy as np
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler

MODEL_NAME = "isolation_forest"
MODEL_VERSION = "0.1.0"


@dataclass
class IForestDetector:
    n_estimators: int = 200
    max_samples: int | str = "auto"
    random_state: int = 42
    feature_names: list[str] = field(default_factory=list)
    threshold: float | None = None
    scaler: StandardScaler | None = None
    model: IsolationForest | None = None

    def fit(self, features_nominal: np.ndarray, feature_names: list[str] | None = None) -> "IForestDetector":
        self.feature_names = list(feature_names or [])
        self.scaler = StandardScaler().fit(features_nominal)
        self.model = IsolationForest(
            n_estimators=self.n_estimators, max_samples=self.max_samples,
            random_state=self.random_state, n_jobs=-1,
        ).fit(self.scaler.transform(features_nominal))
        return self

    def score(self, features: np.ndarray) -> np.ndarray:
        if self.model is None or self.scaler is None:
            raise RuntimeError("Model is not fitted")
        if self.feature_names and features.shape[1] != len(self.feature_names):
            raise ValueError(f"Expected {len(self.feature_names)} features, got {features.shape[1]}")
        return -self.model.score_samples(self.scaler.transform(features))

    def predict(self, features: np.ndarray) -> np.ndarray:
        if self.threshold is None:
            raise RuntimeError("Threshold not set; calibrate on validation data first")
        return self.score(features) >= self.threshold

    def save(self, path: str | Path) -> Path:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump({"name": MODEL_NAME, "version": MODEL_VERSION, "detector": self}, path)
        return path

    @staticmethod
    def load(path: str | Path) -> "IForestDetector":
        """Load a model artifact. joblib uses pickle: only load files this project produced."""
        bundle = joblib.load(path)
        if bundle.get("name") != MODEL_NAME:
            raise ValueError(f"Not an {MODEL_NAME} artifact: {path}")
        return bundle["detector"]
