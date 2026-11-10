"""Preprocessing and window-level features, following the Phase 1 decisions
recorded in docs/dataset-card.md:

- Circular angles (true heading, selected course/heading) are wrapped to [-180, 180)
  and encoded as sin/cos channels. Raw angle values are never differenced.
- Altitude is expressed relative to the window's last second (raw is barometric MSL).
- Vertical acceleration optionally gets a 3-sample median filter (1-2 sample spikes).
- Every other variable is used as recorded, including flap (raw counts) and ailerons.

Features are generic per-channel statistics. No feature is hand-built from the label
definitions, so the unsupervised baseline is not given the answer.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from flightops.data.quality import wrap_degrees
from flightops.data.schema import CIRCULAR_FEATURES, FEATURE_NAMES, IDX

FEATURE_SET_VERSION = "v1"
STATS: tuple[str, ...] = (
    "mean", "std", "min", "max", "median", "iqr", "first", "last", "slope", "mean_abs_diff",
)


def channel_names() -> list[str]:
    names: list[str] = []
    for name in FEATURE_NAMES:
        if name in CIRCULAR_FEATURES:
            names += [f"{name}_sin", f"{name}_cos"]
        elif name == "altitude":
            names.append("altitude_rel_end")
        else:
            names.append(name)
    return names


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
        if name in CIRCULAR_FEATURES:
            rad = np.deg2rad(wrap_degrees(x))
            channels += [np.sin(rad), np.cos(rad)]
        elif name == "altitude":
            channels.append(x - x[:, -1:])
        elif name == "vert_accel" and median_filter_vert_accel:
            channels.append(_median3(x))
        else:
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


def save_features(df: pd.DataFrame, out_dir: str | Path) -> Path:
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"window_features_{FEATURE_SET_VERSION}.npy"
    np.save(path, df.to_numpy(dtype=np.float32))
    path.with_suffix(".json").write_text(
        json.dumps({"version": FEATURE_SET_VERSION, "columns": list(df.columns)}, indent=1), encoding="utf-8"
    )
    return path


def load_or_build_channels(
    X: np.ndarray, out_dir: str | Path, batch_size: int = 4096, median_filter_vert_accel: bool = True
) -> np.ndarray:
    """Preprocessed per-second channels (windows, time, C) as a cached float32 memmap.

    Built in batches so peak memory stays small. About 1.5 GB on disk for the full dataset.
    """
    path = Path(out_dir) / f"channels_{FEATURE_SET_VERSION}.npy"
    shape = (X.shape[0], X.shape[1], len(channel_names()))
    if path.exists():
        arr = np.load(path, mmap_mode="r", allow_pickle=False)
        if arr.shape == shape:
            return arr
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp.npy")
    out = np.lib.format.open_memmap(tmp, mode="w+", dtype=np.float32, shape=shape)
    for s in range(0, X.shape[0], batch_size):
        out[s : s + batch_size] = preprocess_batch(X[s : s + batch_size], median_filter_vert_accel)
    out.flush()
    del out
    tmp.replace(path)
    return np.load(path, mmap_mode="r", allow_pickle=False)


def load_or_build_features(X: np.ndarray, out_dir: str | Path) -> pd.DataFrame:
    """Load cached features if they match the current feature set, else build and cache."""
    path = Path(out_dir) / f"window_features_{FEATURE_SET_VERSION}.npy"
    meta_path = path.with_suffix(".json")
    if path.exists() and meta_path.exists():
        cols = json.loads(meta_path.read_text(encoding="utf-8"))["columns"]
        arr = np.load(path, allow_pickle=False)
        if cols == feature_names() and arr.shape[0] == X.shape[0]:
            return pd.DataFrame(arr, columns=cols)
    df = build_window_features(X)
    save_features(df, out_dir)
    return df
