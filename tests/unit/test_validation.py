import numpy as np
import pandas as pd
import pytest

from flightops.data.validation import check_metadata_alignment, validate_snapshot_arrays

EXPECTED = {"n_timesteps": 8, "n_features": 3, "n_classes": 4}


def test_clean_data_has_no_issues(synthetic_dataset):
    report = validate_snapshot_arrays(
        synthetic_dataset["X"], synthetic_dataset["y"], time_axis=1, feature_axis=2, expected=EXPECTED
    )
    assert report.ok, report.issues
    assert report.n_nonfinite == 0
    assert report.label_counts == {"0": 3, "1": 3, "2": 3, "3": 3}


def test_nonfinite_counted_per_feature_across_batches(synthetic_dataset):
    X = synthetic_dataset["X"].copy()
    X[0, 0, 1] = np.nan
    X[11, 7, 1] = np.inf
    X[5, 3, 2] = -np.inf
    report = validate_snapshot_arrays(X, synthetic_dataset["y"], feature_axis=2, batch_size=5)
    assert report.n_nonfinite == 3
    assert report.nonfinite_by_feature == [0, 2, 1]
    assert not report.ok


def test_label_length_mismatch_reported(synthetic_dataset):
    report = validate_snapshot_arrays(synthetic_dataset["X"], synthetic_dataset["y"][:-1])
    assert any("Label count" in issue for issue in report.issues)


def test_expected_shape_mismatch_reported(synthetic_dataset):
    report = validate_snapshot_arrays(
        synthetic_dataset["X"], synthetic_dataset["y"], feature_axis=2,
        expected={"n_features": 20, "n_classes": 5},
    )
    assert len(report.issues) == 2


@pytest.mark.parametrize("axes", [{"feature_axis": 0}, {"feature_axis": 3}, {"feature_axis": 1, "time_axis": 1}])
def test_invalid_axes_raise(synthetic_dataset, axes):
    with pytest.raises(ValueError):
        validate_snapshot_arrays(synthetic_dataset["X"], synthetic_dataset["y"], **axes)


def test_metadata_alignment(synthetic_dataset):
    meta = pd.read_csv(synthetic_dataset["meta"])
    y = synthetic_dataset["y"]
    assert check_metadata_alignment(meta, 12, y=y, label_column="label") == []
    assert check_metadata_alignment(meta, 13)  # row count mismatch

    shuffled = y.copy()
    shuffled[[0, 1]] = shuffled[[1, 0]]
    issues = check_metadata_alignment(meta, 12, y=shuffled, label_column="label")
    assert issues == ["2 rows where metadata label != array label"]
