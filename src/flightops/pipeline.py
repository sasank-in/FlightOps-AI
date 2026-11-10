"""Shared experiment setup so every model is trained and evaluated on identical data and splits."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

import numpy as np
import pandas as pd

from flightops.config import load_data_config
from flightops.data.processed import load_processed
from flightops.data.quality import duplicate_mask, parse_flight_record, window_quality_flags
from flightops.data.schema import LABELS
from flightops.data.splits import stratified_split
from flightops.evaluation.metrics import binary_metrics, per_class_alert_rate

LABEL_CONCERN_AIRCRAFT = "657"  # Speed High labels look nominal (docs/dataset-card.md)


@dataclass
class ExperimentData:
    X: np.ndarray                  # (windows, 160, 20) float32 memmap
    y: np.ndarray                  # (windows,) int8
    meta: pd.DataFrame
    aircraft: np.ndarray           # aircraft id per window
    duplicate: np.ndarray          # second copy of an exact duplicate (excluded everywhere)
    pressure_invalid: np.ndarray   # excluded from nominal training only
    split: np.ndarray              # 'train' / 'val' / 'test' / 'excluded'

    @property
    def split_fingerprint(self) -> str:
        """SHA-256 of the split assignment; equal fingerprints mean identical splits."""
        return hashlib.sha256("\n".join(self.split.astype(str)).encode()).hexdigest()


def load_experiment_data(model_cfg: dict) -> ExperimentData:
    cfg = load_data_config()
    X, y = load_processed()
    meta = pd.read_csv(cfg.metadata_path, dtype={"flight_record": str})
    aircraft = parse_flight_record(meta["flight_record"])["aircraft_id"].to_numpy()
    duplicate = duplicate_mask(X)
    pressure_invalid = window_quality_flags(X)["pressure_invalid"].to_numpy()
    split = stratified_split(
        y, duplicate, model_cfg["split"]["validation_fraction"], model_cfg["split"]["test_fraction"],
        model_cfg["random_seed"],
    )
    return ExperimentData(X, y, meta, aircraft, duplicate, pressure_invalid, split)


def evaluate(labels: np.ndarray, scores: np.ndarray, threshold: float) -> dict:
    return {
        "binary": binary_metrics(labels, scores, threshold),
        "alert_rate_by_class": per_class_alert_rate(labels, scores, threshold, LABELS),
    }


def evaluate_with_and_without_concern(data: ExperimentData, mask: np.ndarray, scores_full: np.ndarray,
                                      threshold: float) -> dict:
    """Evaluate on `mask` windows, and again excluding the label-concern aircraft."""
    without = mask & (data.aircraft != LABEL_CONCERN_AIRCRAFT)
    return {
        "all": evaluate(data.y[mask], scores_full[mask], threshold),
        f"without_aircraft_{LABEL_CONCERN_AIRCRAFT}": evaluate(data.y[without], scores_full[without], threshold),
    }
