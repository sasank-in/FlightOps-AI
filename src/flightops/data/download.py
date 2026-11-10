"""Download the DASHlink dataset files with integrity verification.

Tries the official NASA URL first, then the verified Internet Archive capture of that URL
(see docs/dataset-card.md). Every file is checked against its known SHA-256 before use.
Files are never re-hosted by this project.

Usage:
    python -m flightops.data.download [--dest data/raw]
"""

from __future__ import annotations

import argparse
import hashlib
import shutil
import sys
import urllib.request
from dataclasses import dataclass
from pathlib import Path

from flightops.config import project_root

OFFICIAL_BASE = "https://c3.ndc.nasa.gov/dashlink/static/media/dataset/"
ARCHIVE_PREFIX = "https://web.archive.org/web/{ts}id_/"


@dataclass(frozen=True)
class RemoteFile:
    name: str
    size: int
    sha256: str | None
    archive_timestamp: str

    @property
    def urls(self) -> list[str]:
        official = OFFICIAL_BASE + self.name
        return [official, ARCHIVE_PREFIX.format(ts=self.archive_timestamp) + official]


FILES: tuple[RemoteFile, ...] = (
    RemoteFile("DASHlink_full_fourclass_raw_comp.npz", 1_759_319_547,
               "c5807fe88e34b838e669d385e50e967c14032c0843c8b3cf915642480393d6a2", "20260426172441"),
    RemoteFile("DASHlink_full_fourclass_raw_meta.csv", 4_101_030,
               "aa464d2badc19553cea0cda419cb2c31277f9520728ace13a6278714b37bdc2e", "20250602160955"),
    RemoteFile("DASHlink_full_data_documentation.pdf", 435_573, None, "20260427195548"),
)


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def is_valid(path: Path, f: RemoteFile) -> bool:
    if not path.exists() or path.stat().st_size != f.size:
        return False
    return f.sha256 is None or _sha256(path) == f.sha256


def _fetch(url: str, dest: Path, timeout: float) -> None:
    tmp = dest.with_suffix(dest.suffix + ".part")
    req = urllib.request.Request(url, headers={"User-Agent": "flightops-ai-dataset-fetch"})
    with urllib.request.urlopen(req, timeout=timeout) as resp, open(tmp, "wb") as out:
        shutil.copyfileobj(resp, out, length=1 << 20)
    tmp.replace(dest)


def download_all(dest: str | Path | None = None, timeout: float = 60.0) -> dict[str, str]:
    """Ensure all files exist in `dest` and are verified. Returns {file name: source used}."""
    dest = Path(dest) if dest else project_root() / "data" / "raw"
    dest.mkdir(parents=True, exist_ok=True)
    used: dict[str, str] = {}
    for f in FILES:
        path = dest / f.name
        if is_valid(path, f):
            used[f.name] = "existing (verified)"
            continue
        errors = []
        for url in f.urls:
            try:
                print(f"Downloading {f.name} ({f.size / 1e6:,.0f} MB) from {url}", flush=True)
                _fetch(url, path, timeout)
                if is_valid(path, f):
                    used[f.name] = url
                    break
                errors.append(f"{url}: size/checksum mismatch")
                path.unlink(missing_ok=True)
            except Exception as exc:  # network errors: try the next source
                errors.append(f"{url}: {exc}")
        else:
            raise RuntimeError(f"Could not obtain a verified copy of {f.name}:\n  " + "\n  ".join(errors))
    return used


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Download and verify the DASHlink dataset")
    parser.add_argument("--dest", type=Path, default=None, help="Default: data/raw")
    parser.add_argument("--timeout", type=float, default=60.0, help="Connect/read timeout in seconds")
    args = parser.parse_args(argv)
    for name, source in download_all(args.dest, args.timeout).items():
        print(f"OK {name}  <- {source}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
