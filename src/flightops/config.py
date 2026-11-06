"""Project paths and configuration loading."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml


def project_root() -> Path:
    """Return the repository root (override with FLIGHTOPS_PROJECT_ROOT)."""
    override = os.environ.get("FLIGHTOPS_PROJECT_ROOT")
    if override:
        return Path(override).resolve()
    # src/flightops/config.py -> parents[2] is the repository root
    return Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class DataConfig:
    raw_dir: Path
    npz_file: str
    metadata_file: str
    data_key: str | None = None
    label_key: str | None = None
    time_axis: int | None = None
    feature_axis: int | None = None
    expected: dict[str, Any] = field(default_factory=dict)

    @property
    def npz_path(self) -> Path:
        return self.raw_dir / self.npz_file

    @property
    def metadata_path(self) -> Path:
        return self.raw_dir / self.metadata_file

    def require_verified_keys(self) -> tuple[str, str]:
        """Return (data_key, label_key), failing loudly if they are still unverified."""
        if not self.data_key or not self.label_key:
            raise ValueError(
                "data_key and label_key are not set in configs/data.yaml. "
                "Run `python -m flightops.data.inspect` and fill them in from the "
                "archive keys it reports."
            )
        return self.data_key, self.label_key


def load_data_config(path: str | Path | None = None, root: Path | None = None) -> DataConfig:
    root = root or project_root()
    path = Path(path) if path else root / "configs" / "data.yaml"
    with open(path, encoding="utf-8") as fh:
        raw = yaml.safe_load(fh) or {}

    raw_dir = Path(raw.get("raw_dir", "data/raw"))
    if not raw_dir.is_absolute():
        raw_dir = root / raw_dir

    return DataConfig(
        raw_dir=raw_dir,
        npz_file=raw["npz_file"],
        metadata_file=raw["metadata_file"],
        data_key=raw.get("data_key"),
        label_key=raw.get("label_key"),
        time_axis=raw.get("time_axis"),
        feature_axis=raw.get("feature_axis"),
        expected=raw.get("expected") or {},
    )
