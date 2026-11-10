"""Reusable data-quality checks and per-window quality flags.

Thresholds are dataset-specific heuristics chosen during Phase 1 EDA
(notebooks/02_data_quality.ipynb). Flags mark windows for review; nothing is dropped here.
"""

from __future__ import annotations

import hashlib

import numpy as np
import pandas as pd

from flightops.data.schema import IDX

# A window whose median total pressure is below this is physically implausible
# near the ground (sea-level pressure ~1013 mbar; highest airports in data ~770 mbar).
PRESSURE_INVALID_MBAR = 500.0
# One-second flap changes above this are discontinuities, not deployment steps (typical step ~110-125).
FLAP_JUMP_COUNTS = 1000.0
# Vertical acceleration outside this band (g) on final approach is treated as a spike.
VERT_ACCEL_RANGE_G = (-1.0, 2.5)


def parse_flight_record(flight_record: pd.Series) -> pd.DataFrame:
    """Split `flight_record` into aircraft id and record timestamp.

    Inferred (undocumented) layout: 3-digit aircraft id + YYYYMMDDHHMM. All 99,837
    records match this layout. Unparseable values become NaT rather than raising.
    """
    s = flight_record.astype(str).str.strip()
    return pd.DataFrame(
        {
            "aircraft_id": s.str[:3],
            "record_time": pd.to_datetime(s.str[3:], format="%Y%m%d%H%M", errors="coerce"),
        },
        index=flight_record.index,
    )


def window_hashes(X: np.ndarray, batch_size: int = 4096) -> np.ndarray:
    """SHA-1 of each window's bytes (axis 0). Works on memory-mapped arrays."""
    out = []
    for start in range(0, X.shape[0], batch_size):
        batch = np.ascontiguousarray(X[start : start + batch_size])
        out.extend(hashlib.sha1(w.tobytes()).hexdigest() for w in batch)
    return np.array(out)


def duplicate_mask(X: np.ndarray, keep: str = "first") -> np.ndarray:
    """Boolean mask of windows that exactly duplicate an earlier (keep='first') window."""
    return pd.Series(window_hashes(X)).duplicated(keep=keep).to_numpy()


def wrap_degrees(angle: np.ndarray) -> np.ndarray:
    """Wrap angles in degrees to [-180, 180)."""
    return (np.asarray(angle) + 180.0) % 360.0 - 180.0


def window_quality_flags(X: np.ndarray, batch_size: int = 8192) -> pd.DataFrame:
    """Compute per-window quality flags for X of shape (windows, time, 20 features)."""
    cols: dict[str, list] = {k: [] for k in (
        "pressure_invalid", "flap_jump", "heading_out_of_range", "vert_accel_spikes"
    )}
    lo, hi = VERT_ACCEL_RANGE_G
    for start in range(0, X.shape[0], batch_size):
        b = np.asarray(X[start : start + batch_size])
        cols["pressure_invalid"].append(np.median(b[:, :, IDX["total_pressure"]], axis=1) < PRESSURE_INVALID_MBAR)
        cols["flap_jump"].append((np.abs(np.diff(b[:, :, IDX["flap"]], axis=1)) > FLAP_JUMP_COUNTS).any(axis=1))
        cols["heading_out_of_range"].append((np.abs(b[:, :, IDX["true_heading"]]) > 180).any(axis=1))
        va = b[:, :, IDX["vert_accel"]]
        cols["vert_accel_spikes"].append(((va < lo) | (va > hi)).sum(axis=1))
    return pd.DataFrame({k: np.concatenate(v) for k, v in cols.items()})
