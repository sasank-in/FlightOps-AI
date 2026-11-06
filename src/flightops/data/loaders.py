"""Safe, memory-aware loaders for the raw dataset files."""

from __future__ import annotations

import hashlib
import zipfile
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
import pandas as pd


@dataclass(frozen=True)
class ArrayInfo:
    """Shape/dtype of one array inside an .npz archive, read from its header only."""

    name: str
    shape: tuple[int, ...]
    dtype: str
    nbytes: int
    fortran_order: bool

    def to_dict(self) -> dict:
        return asdict(self)


def sha256_file(path: str | Path, chunk_size: int = 1 << 20) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(chunk_size), b""):
            digest.update(chunk)
    return digest.hexdigest()


def describe_npz(path: str | Path) -> list[ArrayInfo]:
    """List arrays in an .npz archive WITHOUT loading their data.

    Only the .npy headers are read, so this is safe for multi-GB archives.
    """
    infos: list[ArrayInfo] = []
    with zipfile.ZipFile(path) as zf:
        for entry in zf.infolist():
            if not entry.filename.endswith(".npy"):
                continue
            with zf.open(entry) as fh:
                version = np.lib.format.read_magic(fh)
                if version == (1, 0):
                    shape, fortran, dtype = np.lib.format.read_array_header_1_0(fh)
                else:
                    shape, fortran, dtype = np.lib.format.read_array_header_2_0(fh)
            nbytes = int(np.prod(shape, dtype=np.int64)) * dtype.itemsize
            infos.append(
                ArrayInfo(
                    name=entry.filename[: -len(".npy")],
                    shape=tuple(int(s) for s in shape),
                    dtype=str(dtype),
                    nbytes=nbytes,
                    fortran_order=bool(fortran),
                )
            )
    return infos


def load_arrays(path: str | Path, data_key: str, label_key: str) -> tuple[np.ndarray, np.ndarray]:
    """Load the telemetry and label arrays. Pickle loading is always disabled."""
    with np.load(path, allow_pickle=False) as archive:
        missing = [k for k in (data_key, label_key) if k not in archive.files]
        if missing:
            raise KeyError(f"Keys {missing} not in archive; available: {archive.files}")
        return archive[data_key], archive[label_key]


def load_metadata(path: str | Path) -> pd.DataFrame:
    return pd.read_csv(path)
