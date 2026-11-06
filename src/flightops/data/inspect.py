"""Inspect raw dataset files without loading the full telemetry array.

Usage:
    python -m flightops.data.inspect
    python -m flightops.data.inspect --json-out artifacts/reports/dataset_inspection.json
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from flightops.config import load_data_config
from flightops.data.loaders import describe_npz, sha256_file


def inspect_files(config_path: str | None = None, checksum: bool = True) -> dict:
    cfg = load_data_config(config_path)
    report: dict = {
        "inspected_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "files": {},
    }

    for label, path in (("npz", cfg.npz_path), ("metadata", cfg.metadata_path)):
        entry: dict = {"path": str(path), "exists": path.exists()}
        if path.exists():
            entry["size_bytes"] = path.stat().st_size
            if checksum:
                entry["sha256"] = sha256_file(path)
        report["files"][label] = entry

    if cfg.npz_path.exists():
        report["npz_arrays"] = [info.to_dict() for info in describe_npz(cfg.npz_path)]

    if cfg.metadata_path.exists():
        head = pd.read_csv(cfg.metadata_path, nrows=5)
        # Count parsed rows (not raw lines) so quoted newlines are handled correctly.
        n_rows = sum(len(chunk) for chunk in pd.read_csv(cfg.metadata_path, chunksize=100_000))
        report["metadata"] = {
            "n_rows": n_rows,
            "columns": head.columns.tolist(),
            "dtypes_first_rows": {c: str(t) for c, t in head.dtypes.items()},
        }

    return report


def _print_report(report: dict) -> None:
    for label, entry in report["files"].items():
        if not entry["exists"]:
            print(f"[missing] {label}: {entry['path']}")
            continue
        size_mb = entry["size_bytes"] / 1024**2
        print(f"[found]   {label}: {entry['path']} ({size_mb:,.1f} MB)")
        if "sha256" in entry:
            print(f"          sha256 {entry['sha256']}")

    for arr in report.get("npz_arrays", []):
        gb = arr["nbytes"] / 1024**3
        print(f"  array '{arr['name']}': shape={tuple(arr['shape'])} dtype={arr['dtype']} ({gb:.3f} GB in memory)")

    meta = report.get("metadata")
    if meta:
        print(f"  metadata: {meta['n_rows']} rows, columns={meta['columns']}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--config", help="Path to data.yaml (default: configs/data.yaml)")
    parser.add_argument("--json-out", type=Path, help="Write the report as JSON to this path")
    parser.add_argument("--no-checksum", action="store_true", help="Skip SHA-256 (faster)")
    args = parser.parse_args(argv)

    report = inspect_files(args.config, checksum=not args.no_checksum)
    _print_report(report)

    if args.json_out:
        args.json_out.parent.mkdir(parents=True, exist_ok=True)
        args.json_out.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(f"Report written to {args.json_out}")

    return 0 if all(f["exists"] for f in report["files"].values()) else 1


if __name__ == "__main__":
    sys.exit(main())
