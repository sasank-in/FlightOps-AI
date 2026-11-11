"""Guard: committed files must not contain real credentials (the repository is public)."""

import re
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
PATTERNS = {
    "Groq API key": re.compile(r"gsk_[A-Za-z0-9]{20,}"),
    "OpenAI-style key": re.compile(r"sk-[A-Za-z0-9_-]{20,}"),
    "Anthropic key": re.compile(r"sk-ant-[A-Za-z0-9_-]{20,}"),
    "GitHub token": re.compile(r"gh[pousr]_[A-Za-z0-9]{30,}"),
    "AWS access key": re.compile(r"AKIA[0-9A-Z]{16}"),
    # the literal placeholder "password" (any case) is allowed, e.g. postgresql://user:password@host/db
    "DB URL with password": re.compile(r"postgres(?:ql)?://[^:\s/\"']+:(?!(?i:password)@)[^@\s\"']+@"),
}
# Deliberate fake values in tests must be marked on the same line with this comment.
ALLOW_MARKER = "secret-scan: allow"


def _tracked_text_files():
    try:
        out = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    except (OSError, subprocess.CalledProcessError):
        pytest.skip("git not available")
    for name in out.splitlines():
        path = ROOT / name
        if path.suffix in {".ipynb", ".png", ".npz", ".npy", ".joblib", ".pt", ".pdf"} or not path.is_file():
            continue
        yield name, path.read_text(encoding="utf-8", errors="ignore")


def test_env_is_git_ignored():
    result = subprocess.run(["git", "check-ignore", "-q", ".env"], cwd=ROOT)
    assert result.returncode == 0, ".env must be listed in .gitignore"


def test_no_credentials_in_tracked_files():
    hits = [f"{name}:{lineno}: {label}"
            for name, text in _tracked_text_files()
            for lineno, line in enumerate(text.splitlines(), start=1) if ALLOW_MARKER not in line
            for label, rx in PATTERNS.items() if rx.search(line)]
    assert not hits, "Possible secrets in tracked files (move them to .env): " + "; ".join(hits)
