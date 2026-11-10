import json

import numpy as np
import pytest

from flightops.config import load_data_config
from flightops.data.processed import (
    build_processed,
    convert_labels,
    convert_npz_member,
    load_processed,
)


def test_streaming_conversion_matches_direct_cast_across_chunks(synthetic_dataset, tmp_path):
    X64 = synthetic_dataset["X"].astype(np.float64) * 1000.123
    npz = tmp_path / "f64.npz"
    np.savez_compressed(npz, data=X64)

    stats = convert_npz_member(npz, "data", tmp_path / "out.npy", np.float32, chunk_rows=5)

    out = np.load(tmp_path / "out.npy", mmap_mode="r")
    assert out.dtype == np.float32 and out.shape == X64.shape
    np.testing.assert_array_equal(out, X64.astype(np.float32))
    assert 0 < stats["max_rel_error"] < 1e-6
    assert not (tmp_path / "out.tmp.npy").exists()


def test_overflow_is_rejected(tmp_path):
    npz = tmp_path / "big.npz"
    np.savez(npz, data=np.array([[1e300, 1.0]]))
    with pytest.raises(OverflowError):
        convert_npz_member(npz, "data", tmp_path / "out.npy", np.float32)


def test_nonfinite_values_pass_through(tmp_path):
    npz = tmp_path / "nan.npz"
    np.savez(npz, data=np.array([[np.nan, 1.0], [np.inf, 2.0]]))
    convert_npz_member(npz, "data", tmp_path / "out.npy", np.float32)
    out = np.load(tmp_path / "out.npy")
    assert np.isnan(out[0, 0]) and np.isinf(out[1, 0])


def test_fortran_order_rejected(tmp_path):
    npz = tmp_path / "f.npz"
    np.savez(npz, data=np.asfortranarray(np.ones((3, 4))))
    with pytest.raises(ValueError, match="Fortran"):
        convert_npz_member(npz, "data", tmp_path / "out.npy")


def test_non_integer_labels_rejected(tmp_path):
    npz = tmp_path / "l.npz"
    np.savez(npz, label=np.array([0.0, 1.5]))
    with pytest.raises(ValueError, match="integer"):
        convert_labels(npz, "label", tmp_path / "y.npy")


def test_build_and_load_processed(synthetic_dataset, tmp_path):
    cfg = load_data_config(synthetic_dataset["config"], root=synthetic_dataset["root"])
    out_dir = tmp_path / "processed"

    manifest = build_processed(cfg, out_dir, chunk_rows=4)

    X, y = load_processed(out_dir)
    assert isinstance(X, np.memmap)
    np.testing.assert_array_equal(X, synthetic_dataset["X"])
    assert y.dtype == np.int8 and y.tolist() == synthetic_dataset["y"].tolist()
    assert manifest["labels"]["counts"] == {0: 3, 1: 3, 2: 3, 3: 3}
    saved = json.loads((out_dir / "manifest.json").read_text(encoding="utf-8"))
    assert len(saved["source"]["sha256"]) == 64
