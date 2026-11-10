"""Preprocessing and window-level features, following the decisions recorded in
docs/dataset-card.md.

Channel set v3 (current) = v2 + per-aircraft offsets removed:
- Channels whose level differs systematically between aircraft (offset ratio > 1: spread of
  per-aircraft nominal medians / typical within-aircraft spread) are made relative, so a model
  judges how the signal MOVES during the approach, not each aircraft's sensor calibration:
    flap         -> flap_rel_end       (minus its value at the window end; ratio 47: full-flap count
                                        differs per aircraft, 3,586-3,745)
    elevator_lh  -> elevator_lh_rel_median  (ratio 4.6: some aircraft read ~-40 deg)
    aileron_lh/rh-> *_rel_median       (ratio 2.2 / 1.7)
    rudder       -> rudder_rel_median  (ratio 1.4)
    vert_accel   -> vert_accel_rel_median (ratio 0.81, but aircraft 685's accelerometer bias caused
                                        65% false alarms on its nominal windows under the tail rule)
  Without this, a per-feature tail rule flagged up to 31% of nominal windows of unseen aircraft.

Channel set v2:
- Absolute heading/course channels (true heading, selected heading, selected course) are
  NOT model inputs. They encode which runway is in use rather than how the approach is
  flown, and selected course is faulty on aircraft 657 in 2001-2002. v1 encoded them as
  sin/cos; models used them as a shortcut (docs/evaluation-report.md).
- No heading-derived replacement: near ±180° the true-heading recording is corrupted (sign
  flips such as -162, -185, -159, -208, -45, 208, 159), so a heading-based turn rate produced
  impossible spikes (>30 deg/s in ~11% of windows) that dominated the autoencoder. Turning is
  still represented by roll angle (turn rate follows from bank angle and speed) and drift angle.
- Altitude is expressed relative to the window's last second (raw is barometric MSL).
- Vertical acceleration optionally gets a 3-sample median filter (1-2 sample spikes).
- Every other variable is used as recorded.

Features are generic per-channel statistics. No feature is hand-built from the label
definitions, so the unsupervised baseline is not given the answer.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd

from flightops.data.schema import CIRCULAR_FEATURES, FEATURE_NAMES, IDX

FEATURE_SET_VERSION = "v3"
STATS: tuple[str, ...] = (
    "mean", "std", "min", "max", "median", "iqr", "first", "last", "slope", "mean_abs_diff",
)
# Absolute direction channels excluded from model inputs (v2). Kept in the data for quality checks.
EXCLUDED_INPUTS: tuple[str, ...] = CIRCULAR_FEATURES
# Expressed relative to the window's last value (altitude: MSL; flap: per-aircraft full-flap count).
RELATIVE_TO_END: tuple[str, ...] = ("altitude", "flap")
# Expressed relative to the window median (per-aircraft sensor offsets; v3). vert_accel: offset ratio
# 0.81, but aircraft 685's accelerometer bias alone produced 65% false alarms under the tail rule.
RELATIVE_TO_MEDIAN: tuple[str, ...] = ("aileron_lh", "aileron_rh", "elevator_lh", "rudder", "vert_accel")


def definition_fingerprint(median_filter_vert_accel: bool = True) -> str:
    """Hash of everything that defines the channels/features. Caches are reused only on an exact match,
    so changing a transformation can never silently reuse stale cached data (even with equal shapes)."""
    spec = json.dumps({
        "version": FEATURE_SET_VERSION, "excluded": EXCLUDED_INPUTS, "rel_end": RELATIVE_TO_END,
        "rel_median": RELATIVE_TO_MEDIAN, "stats": STATS, "median3_vert_accel": median_filter_vert_accel,
    }, sort_keys=True)
    return hashlib.sha256(spec.encode()).hexdigest()[:16]


def channel_names() -> list[str]:
    names: list[str] = []
    for name in FEATURE_NAMES:
        if name in EXCLUDED_INPUTS:
            continue
        if name in RELATIVE_TO_END:
            names.append(f"{name}_rel_end")
        elif name in RELATIVE_TO_MEDIAN:
            names.append(f"{name}_rel_median")
        else:
            names.append(name)
    return names


def base_variable(channel: str) -> str:
    """'flap_rel_end' -> 'flap'; plain channel names are returned unchanged."""
    return channel.split("_rel_")[0]


def feature_names() -> list[str]:
    return [f"{c}__{s}" for c in channel_names() for s in STATS]


def _median3(a: np.ndarray) -> np.ndarray:
    """3-sample median filter along axis 1 with edge replication."""
    padded = np.concatenate([a[:, :1], a, a[:, -1:]], axis=1)
    return np.median(np.stack([padded[:, :-2], padded[:, 1:-1], padded[:, 2:]]), axis=0)


def preprocess_batch(batch: np.ndarray, median_filter_vert_accel: bool = True) -> np.ndarray:
    """(n, T, 20) raw -> (n, T, C) preprocessed channels in `channel_names()` order."""
    b = np.asarray(batch, dtype=np.float64)
    channels: list[np.ndarray] = []
    for name in FEATURE_NAMES:
        x = b[:, :, IDX[name]]
        if name in EXCLUDED_INPUTS:
            continue
        if name == "vert_accel" and median_filter_vert_accel:
            x = _median3(x)                                  # remove 1-2 sample spikes first
        if name in RELATIVE_TO_END:
            x = x - x[:, -1:]
        elif name in RELATIVE_TO_MEDIAN:
            x = x - np.median(x, axis=1, keepdims=True)
        channels.append(x)
    return np.stack(channels, axis=2)


def window_stats(channels: np.ndarray) -> np.ndarray:
    """(n, T, C) -> (n, C * len(STATS)), stats grouped per channel in STATS order."""
    n, T, C = channels.shape
    q25, med, q75 = np.percentile(channels, [25, 50, 75], axis=1)
    t = np.arange(T, dtype=np.float64) - (T - 1) / 2
    slope = np.einsum("t,ntc->nc", t, channels) / np.sum(t**2)
    stats = np.stack(
        [
            channels.mean(axis=1),
            channels.std(axis=1),
            channels.min(axis=1),
            channels.max(axis=1),
            med,
            q75 - q25,
            channels[:, 0],
            channels[:, -1],
            slope,
            np.abs(np.diff(channels, axis=1)).mean(axis=1),
        ],
        axis=2,
    )  # (n, C, S)
    return stats.reshape(n, C * len(STATS))


def build_window_features(
    X: np.ndarray, batch_size: int = 4096, median_filter_vert_accel: bool = True
) -> pd.DataFrame:
    """Compute window features for X of shape (windows, time, 20). Works on memmaps."""
    parts = [
        window_stats(preprocess_batch(X[s : s + batch_size], median_filter_vert_accel)).astype(np.float32)
        for s in range(0, X.shape[0], batch_size)
    ]
    return pd.DataFrame(np.concatenate(parts), columns=feature_names())


def _data_fingerprint(X: np.ndarray) -> str:
    """Cheap fingerprint of the input telemetry: shape plus a few sampled windows."""
    h = hashlib.sha256(repr(tuple(X.shape)).encode())
    for i in sorted({0, X.shape[0] // 3, X.shape[0] // 2, (2 * X.shape[0]) // 3, X.shape[0] - 1}):
        h.update(np.ascontiguousarray(X[i], dtype=np.float32).tobytes())
    return h.hexdigest()[:16]


def _cache_key(X: np.ndarray, median_filter_vert_accel: bool, kind: str) -> dict:
    return {"kind": kind, "definition": definition_fingerprint(median_filter_vert_accel),
            "data": _data_fingerprint(X), "columns": channel_names() if kind == "channels" else feature_names()}


def _cache_valid(meta_path: Path, key: dict) -> bool:
    try:
        return json.loads(meta_path.read_text(encoding="utf-8")) == key
    except (OSError, ValueError):
        return False


def save_features(df: pd.DataFrame, out_dir: str | Path, key: dict | None = None) -> Path:
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"window_features_{FEATURE_SET_VERSION}.npy"
    np.save(path, df.to_numpy(dtype=np.float32))
    meta = key or {"kind": "features", "definition": definition_fingerprint(), "columns": list(df.columns)}
    path.with_suffix(".json").write_text(json.dumps(meta, indent=1), encoding="utf-8")
    return path


def load_or_build_channels(
    X: np.ndarray, out_dir: str | Path, batch_size: int = 4096, median_filter_vert_accel: bool = True
) -> np.ndarray:
    """Preprocessed per-second channels (windows, time, C) as a cached float32 memmap.

    Built in batches so peak memory stays small (~1.1 GB on disk for the full dataset). The cache is
    reused only if its recorded definition and data fingerprints match exactly.
    """
    path = Path(out_dir) / f"channels_{FEATURE_SET_VERSION}.npy"
    meta_path = path.with_suffix(".json")
    key = _cache_key(X, median_filter_vert_accel, "channels")
    shape = (X.shape[0], X.shape[1], len(channel_names()))
    if path.exists() and _cache_valid(meta_path, key):
        arr = np.load(path, mmap_mode="r", allow_pickle=False)
        if arr.shape == shape:
            return arr
        del arr  # release the mapping: Windows cannot replace a file that is still memory-mapped
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp.npy")
    out = np.lib.format.open_memmap(tmp, mode="w+", dtype=np.float32, shape=shape)
    for s in range(0, X.shape[0], batch_size):
        out[s : s + batch_size] = preprocess_batch(X[s : s + batch_size], median_filter_vert_accel)
    out.flush()
    del out
    tmp.replace(path)
    meta_path.write_text(json.dumps(key, indent=1), encoding="utf-8")   # written last: marks cache complete
    return np.load(path, mmap_mode="r", allow_pickle=False)


def load_or_build_features(X: np.ndarray, out_dir: str | Path) -> pd.DataFrame:
    """Load cached features only if definition and data fingerprints match exactly, else build and cache."""
    path = Path(out_dir) / f"window_features_{FEATURE_SET_VERSION}.npy"
    key = _cache_key(X, True, "features")
    if path.exists() and _cache_valid(path.with_suffix(".json"), key):
        arr = np.load(path, allow_pickle=False)
        if arr.shape == (X.shape[0], len(feature_names())):
            return pd.DataFrame(arr, columns=feature_names())
    df = build_window_features(X)
    save_features(df, out_dir, key)
    return df
