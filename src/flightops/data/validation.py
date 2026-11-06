"""Data-quality checks. Problems are reported, never silently fixed or dropped."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field

import numpy as np
import pandas as pd


@dataclass
class ArrayValidationReport:
    shape: tuple[int, ...]
    dtype: str
    n_samples: int
    n_nonfinite: int | None
    nonfinite_by_feature: list[int] | None
    label_counts: dict[str, int]
    issues: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.issues

    def to_dict(self) -> dict:
        return asdict(self)


def _count_nonfinite(
    X: np.ndarray, feature_axis: int | None, batch_size: int
) -> tuple[int, list[int] | None]:
    """Count non-finite values in batches along axis 0 to bound extra memory."""
    total = 0
    per_feature = None
    if feature_axis is not None:
        per_feature = np.zeros(X.shape[feature_axis], dtype=np.int64)
        other_axes = tuple(a for a in range(X.ndim) if a != feature_axis)

    for start in range(0, X.shape[0], batch_size):
        bad = ~np.isfinite(X[start : start + batch_size])
        total += int(np.count_nonzero(bad))
        if per_feature is not None:
            per_feature += bad.sum(axis=other_axes)

    return total, (per_feature.tolist() if per_feature is not None else None)


def validate_snapshot_arrays(
    X: np.ndarray,
    y: np.ndarray,
    *,
    feature_axis: int | None = None,
    time_axis: int | None = None,
    expected: dict | None = None,
    batch_size: int = 4096,
) -> ArrayValidationReport:
    """Check a (samples, ..., ...) telemetry array against its labels.

    `expected` holds soft candidate values (n_features, n_timesteps, n_classes);
    mismatches are reported as issues, not raised.
    """
    expected = expected or {}
    issues: list[str] = []

    if X.ndim < 2:
        raise ValueError(f"Telemetry array must have >= 2 dims, got shape {X.shape}")
    for name, axis in (("feature_axis", feature_axis), ("time_axis", time_axis)):
        if axis is not None and not (0 < axis < X.ndim):
            raise ValueError(f"{name}={axis} is invalid for shape {X.shape} (axis 0 is samples)")
    if feature_axis is not None and feature_axis == time_axis:
        raise ValueError("feature_axis and time_axis must differ")

    if y.ndim != 1:
        issues.append(f"Labels are not 1-D (shape {y.shape})")
    if y.shape[0] != X.shape[0]:
        issues.append(f"Label count {y.shape[0]} != sample count {X.shape[0]}")

    n_nonfinite = per_feature = None
    if np.issubdtype(X.dtype, np.number):
        n_nonfinite, per_feature = _count_nonfinite(X, feature_axis, batch_size)
        if n_nonfinite:
            issues.append(f"{n_nonfinite} non-finite values (NaN/inf)")
    else:
        issues.append(f"Telemetry dtype {X.dtype} is not numeric")

    labels, counts = np.unique(y, return_counts=True)
    label_counts = {str(k): int(v) for k, v in zip(labels, counts)}

    if feature_axis is not None and "n_features" in expected:
        if X.shape[feature_axis] != expected["n_features"]:
            issues.append(
                f"Feature axis size {X.shape[feature_axis]} != expected {expected['n_features']}"
            )
    if time_axis is not None and "n_timesteps" in expected:
        if X.shape[time_axis] != expected["n_timesteps"]:
            issues.append(
                f"Time axis size {X.shape[time_axis]} != expected {expected['n_timesteps']}"
            )
    if "n_classes" in expected and len(labels) != expected["n_classes"]:
        issues.append(f"Found {len(labels)} classes, expected {expected['n_classes']}")

    return ArrayValidationReport(
        shape=tuple(int(s) for s in X.shape),
        dtype=str(X.dtype),
        n_samples=int(X.shape[0]),
        n_nonfinite=n_nonfinite,
        nonfinite_by_feature=per_feature,
        label_counts=label_counts,
        issues=issues,
    )


def check_metadata_alignment(
    metadata: pd.DataFrame,
    n_samples: int,
    *,
    y: np.ndarray | None = None,
    label_column: str | None = None,
) -> list[str]:
    """Return a list of alignment problems between metadata rows and array samples."""
    issues: list[str] = []
    if len(metadata) != n_samples:
        issues.append(f"Metadata has {len(metadata)} rows but arrays have {n_samples} samples")
        return issues

    if label_column is not None:
        if label_column not in metadata.columns:
            issues.append(f"Label column '{label_column}' not in metadata")
        elif y is not None:
            mismatches = int(np.count_nonzero(metadata[label_column].to_numpy() != y))
            if mismatches:
                issues.append(f"{mismatches} rows where metadata label != array label")
    return issues
