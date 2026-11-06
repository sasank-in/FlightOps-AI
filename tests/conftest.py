from pathlib import Path

import numpy as np
import pandas as pd
import pytest


@pytest.fixture
def synthetic_dataset(tmp_path: Path) -> dict:
    """Tiny stand-in for the real dataset: (samples, time, features) + labels + metadata."""
    rng = np.random.default_rng(0)
    X = rng.normal(size=(12, 8, 3)).astype(np.float32)
    y = np.array([0, 1, 2, 3] * 3)

    raw_dir = tmp_path / "data" / "raw"
    raw_dir.mkdir(parents=True)
    npz_path = raw_dir / "sample.npz"
    np.savez_compressed(npz_path, data=X, label=y)

    meta_path = raw_dir / "sample_meta.csv"
    pd.DataFrame({"label": y, "flight": np.arange(12) // 2}).to_csv(meta_path, index=False)

    config_path = tmp_path / "data.yaml"
    config_path.write_text(
        "raw_dir: data/raw\n"
        "npz_file: sample.npz\n"
        "metadata_file: sample_meta.csv\n"
        "data_key: data\n"
        "label_key: label\n"
        "time_axis: 1\n"
        "feature_axis: 2\n"
        "expected:\n  n_timesteps: 8\n  n_features: 3\n  n_classes: 4\n",
        encoding="utf-8",
    )
    return {"root": tmp_path, "config": config_path, "npz": npz_path, "meta": meta_path, "X": X, "y": y}
