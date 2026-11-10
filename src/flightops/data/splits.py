"""Leakage-aware train/validation/test splits.

Rules (docs/dataset-card.md):
- The second copy of each exact-duplicate window is excluded before any split.
- Primary split: stratified by label (the smallest class is ~1%).
- Robustness: grouped by aircraft, so no aircraft appears in both training and test
  (aircraft 657 holds ~32% of Speed High labels).
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.model_selection import StratifiedGroupKFold, train_test_split

TRAIN, VAL, TEST, EXCLUDED = "train", "val", "test", "excluded"


def stratified_split(
    y: np.ndarray,
    exclude: np.ndarray | None = None,
    val_fraction: float = 0.15,
    test_fraction: float = 0.15,
    seed: int = 42,
) -> np.ndarray:
    """Return an array of 'train'/'val'/'test'/'excluded' per window."""
    y = np.asarray(y)
    exclude = np.zeros(len(y), bool) if exclude is None else np.asarray(exclude, bool)
    out = np.full(len(y), EXCLUDED, dtype=object)
    idx = np.flatnonzero(~exclude)
    rest, test = train_test_split(idx, test_size=test_fraction, stratify=y[idx], random_state=seed)
    train, val = train_test_split(
        rest, test_size=val_fraction / (1 - test_fraction), stratify=y[rest], random_state=seed
    )
    out[train], out[val], out[test] = TRAIN, VAL, TEST
    return out


def aircraft_folds(
    y: np.ndarray, groups: np.ndarray, exclude: np.ndarray | None = None, n_splits: int = 5, seed: int = 42
) -> list[tuple[np.ndarray, np.ndarray]]:
    """Folds of (train_idx, test_idx) with whole aircraft held out, stratified where possible."""
    y, groups = np.asarray(y), np.asarray(groups)
    exclude = np.zeros(len(y), bool) if exclude is None else np.asarray(exclude, bool)
    idx = np.flatnonzero(~exclude)
    cv = StratifiedGroupKFold(n_splits=n_splits, shuffle=True, random_state=seed)
    return [(idx[tr], idx[te]) for tr, te in cv.split(idx, y[idx], groups[idx])]


def split_summary(split: np.ndarray, y: np.ndarray, labels: dict[int, str]) -> pd.DataFrame:
    table = pd.crosstab(pd.Series(split, name="split"), pd.Series(y, name="label").map(labels))
    return table.reindex([s for s in (TRAIN, VAL, TEST, EXCLUDED) if s in table.index])
