"""Build a memory-mappable float32 working copy of the raw dataset.

The raw archive stores telemetry as float64 inside a compressed .npz, which cannot be
memory-mapped and needs ~2.4 GB of RAM to load. This module streams the array out of
the archive chunk by chunk, so peak memory stays small, and writes:

    data/processed/telemetry_float32.npy   (memory-mappable)
    data/processed/labels_int8.npy
    data/processed/manifest.json           (provenance + conversion error)

Raw files are never modified.

Usage:
    python -m flightops.data.processed
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from flightops import __version__
from flightops.config import DataConfig, load_data_config, project_root
from flightops.data.loaders import sha256_file

TELEMETRY_FILE = "telemetry_float32.npy"
LABELS_FILE = "labels_int8.npy"
MANIFEST_FILE = "manifest.json"


def _read_exact(fh, n_bytes: int) -> bytes:
    parts, remaining = [], n_bytes
    while remaining:
        chunk = fh.read(remaining)
        if not chunk:
            raise EOFError(f"Archive member ended {remaining} bytes early (truncated file?)")
        parts.append(chunk)
        remaining -= len(chunk)
    return b"".join(parts)


def convert_npz_member(
    npz_path: str | Path,
    key: str,
    out_path: str | Path,
    dtype: np.dtype | type = np.float32,
    chunk_rows: int = 2048,
) -> dict:
    """Stream one array from an .npz into a .npy of `dtype`, along axis 0.

    Returns conversion statistics, including the max absolute and relative
    round-trip error. Raises if the cast overflows to inf.
    """
    out_path = Path(out_path)
    tmp_path = out_path.with_suffix(".tmp.npy")
    dtype = np.dtype(dtype)
    max_abs_err = 0.0
    max_rel_err = 0.0

    with zipfile.ZipFile(npz_path) as zf, zf.open(f"{key}.npy") as fh:
        version = np.lib.format.read_magic(fh)
        if version == (1, 0):
            shape, fortran, src_dtype = np.lib.format.read_array_header_1_0(fh)
        else:
            shape, fortran, src_dtype = np.lib.format.read_array_header_2_0(fh)
        if fortran:
            raise ValueError("Fortran-ordered arrays are not supported for streaming conversion")
        if src_dtype.hasobject:
            raise ValueError("Object arrays are not supported (would require pickle)")

        row_shape = tuple(shape[1:])
        row_bytes = int(np.prod(row_shape, dtype=np.int64)) * src_dtype.itemsize
        out = np.lib.format.open_memmap(tmp_path, mode="w+", dtype=dtype, shape=tuple(shape))
        try:
            for start in range(0, shape[0], chunk_rows):
                n = min(chunk_rows, shape[0] - start)
                src = np.frombuffer(_read_exact(fh, n * row_bytes), dtype=src_dtype).reshape((n, *row_shape))
                with np.errstate(over="ignore", invalid="ignore"):  # overflow is checked explicitly below
                    dst = src.astype(dtype)
                finite_src = np.isfinite(src)
                if np.any(finite_src & ~np.isfinite(dst)):
                    raise OverflowError(f"Values in rows {start}..{start + n} overflow {dtype}")
                if np.issubdtype(src_dtype, np.floating) or np.issubdtype(dtype, np.floating):
                    with np.errstate(invalid="ignore"):  # inf - inf on non-finite entries, masked out
                        err = np.abs(dst.astype(np.float64) - src.astype(np.float64))[finite_src]
                    if err.size:
                        max_abs_err = max(max_abs_err, float(err.max()))
                        denom = np.abs(src.astype(np.float64))[finite_src]
                        nz = denom > 0
                        if nz.any():
                            max_rel_err = max(max_rel_err, float((err[nz] / denom[nz]).max()))
                out[start : start + n] = dst
            out.flush()
        finally:
            del out

    os.replace(tmp_path, out_path)
    return {
        "key": key,
        "shape": [int(s) for s in shape],
        "source_dtype": str(src_dtype),
        "dtype": str(dtype),
        "max_abs_error": max_abs_err,
        "max_rel_error": max_rel_err,
    }


def convert_labels(npz_path: str | Path, key: str, out_path: str | Path) -> dict:
    """Convert float labels to int8 after checking they are small non-negative integers."""
    with np.load(npz_path, allow_pickle=False) as archive:
        y = archive[key]
    if not np.all(np.isfinite(y)) or not np.array_equal(y, np.round(y)):
        raise ValueError("Labels are not integer-valued; refusing to cast")
    if y.min() < 0 or y.max() > np.iinfo(np.int8).max:
        raise ValueError(f"Label range {y.min()}..{y.max()} does not fit int8")
    np.save(out_path, y.astype(np.int8))
    values, counts = np.unique(y.astype(np.int8), return_counts=True)
    return {
        "key": key,
        "shape": [int(s) for s in y.shape],
        "source_dtype": str(y.dtype),
        "dtype": "int8",
        "counts": {int(v): int(c) for v, c in zip(values, counts)},
    }


def build_processed(cfg: DataConfig, out_dir: str | Path, chunk_rows: int = 2048) -> dict:
    data_key, label_key = cfg.require_verified_keys()
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    telemetry = convert_npz_member(cfg.npz_path, data_key, out_dir / TELEMETRY_FILE, np.float32, chunk_rows)
    labels = convert_labels(cfg.npz_path, label_key, out_dir / LABELS_FILE)

    manifest = {
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "flightops_version": __version__,
        "source": {"file": cfg.npz_path.name, "sha256": sha256_file(cfg.npz_path)},
        "axes": {"time_axis": cfg.time_axis, "feature_axis": cfg.feature_axis},
        "telemetry": {"file": TELEMETRY_FILE, **telemetry},
        "labels": {"file": LABELS_FILE, **labels},
    }
    (out_dir / MANIFEST_FILE).write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


def load_processed(processed_dir: str | Path | None = None, mmap: bool = True) -> tuple[np.ndarray, np.ndarray]:
    """Load (X float32, y int8). With mmap=True, X is read lazily from disk."""
    processed_dir = Path(processed_dir) if processed_dir else project_root() / "data" / "processed"
    X = np.load(processed_dir / TELEMETRY_FILE, mmap_mode="r" if mmap else None, allow_pickle=False)
    y = np.load(processed_dir / LABELS_FILE, allow_pickle=False)
    return X, y


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build float32 working copy of the dataset")
    parser.add_argument("--config", help="Path to data.yaml (default: configs/data.yaml)")
    parser.add_argument("--out-dir", type=Path, default=None, help="Default: data/processed")
    args = parser.parse_args(argv)

    cfg = load_data_config(args.config)
    out_dir = args.out_dir or project_root() / "data" / "processed"
    manifest = build_processed(cfg, out_dir)
    t = manifest["telemetry"]
    print(f"Wrote {out_dir / TELEMETRY_FILE}: shape={tuple(t['shape'])} {t['source_dtype']} -> {t['dtype']}")
    print(f"  max abs error {t['max_abs_error']:.3g}, max rel error {t['max_rel_error']:.3g}")
    print(f"Wrote {out_dir / LABELS_FILE}: counts={manifest['labels']['counts']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
