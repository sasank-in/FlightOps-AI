import hashlib

import numpy as np
import pytest

from flightops.config import load_data_config
from flightops.data.loaders import describe_npz, load_arrays, sha256_file


def test_describe_npz_reads_headers_only(synthetic_dataset):
    infos = {i.name: i for i in describe_npz(synthetic_dataset["npz"])}
    assert set(infos) == {"data", "label"}
    assert infos["data"].shape == (12, 8, 3)
    assert infos["data"].dtype == "float32"
    assert infos["data"].nbytes == 12 * 8 * 3 * 4
    assert infos["label"].shape == (12,)


def test_load_arrays_round_trip(synthetic_dataset):
    X, y = load_arrays(synthetic_dataset["npz"], "data", "label")
    np.testing.assert_array_equal(X, synthetic_dataset["X"])
    np.testing.assert_array_equal(y, synthetic_dataset["y"])


def test_load_arrays_unknown_key_lists_available(synthetic_dataset):
    with pytest.raises(KeyError, match="available"):
        load_arrays(synthetic_dataset["npz"], "telemetry", "label")


def test_load_arrays_refuses_pickled_objects(tmp_path):
    path = tmp_path / "obj.npz"
    np.savez(path, data=np.array([{"a": 1}], dtype=object), label=np.array([0]))
    with pytest.raises(ValueError):
        load_arrays(path, "data", "label")


def test_sha256_matches_hashlib(synthetic_dataset):
    path = synthetic_dataset["npz"]
    assert sha256_file(path, chunk_size=7) == hashlib.sha256(path.read_bytes()).hexdigest()


def test_config_resolves_paths_relative_to_root(synthetic_dataset):
    cfg = load_data_config(synthetic_dataset["config"], root=synthetic_dataset["root"])
    assert cfg.npz_path == synthetic_dataset["npz"]
    assert cfg.require_verified_keys() == ("data", "label")


def test_config_rejects_unverified_keys(tmp_path):
    path = tmp_path / "data.yaml"
    path.write_text("npz_file: a.npz\nmetadata_file: b.csv\ndata_key: null\n", encoding="utf-8")
    cfg = load_data_config(path, root=tmp_path)
    with pytest.raises(ValueError, match="inspect"):
        cfg.require_verified_keys()
