import numpy as np

from flightops.data.schema import IDX
from flightops.features.build_features import (
    FEATURE_SET_VERSION,
    STATS,
    build_window_features,
    channel_names,
    feature_names,
    load_or_build_features,
    preprocess_batch,
)


def _windows(n=5, T=10):
    rng = np.random.default_rng(1)
    return rng.normal(size=(n, T, 20)).astype(np.float32)


def test_channel_layout_v2_excludes_absolute_directions():
    ch = channel_names()
    assert len(ch) == 17  # 20 vars - 3 absolute direction channels
    for name in ("true_heading", "selected_heading", "selected_course"):
        assert not any(c.startswith(name) for c in ch)
    assert "roll" in ch and "drift_angle" in ch and "altitude_rel_end" in ch
    assert len(feature_names()) == 17 * len(STATS)


def test_absolute_direction_does_not_change_features():
    X = _windows(2, 10)
    X[1] = X[0]
    X[1, :, IDX["true_heading"]] += 90          # same manoeuvre, different runway
    X[1, :, IDX["selected_course"]] += 123      # e.g. faulty course recording
    f = build_window_features(X)
    np.testing.assert_allclose(f.iloc[0], f.iloc[1], rtol=1e-4, atol=1e-4)  # float32 input rounding


def test_altitude_relative_to_end_and_median_filter():
    X = _windows(1, 5)
    X[0, :, IDX["altitude"]] = [500, 400, 300, 200, 100]
    X[0, :, IDX["vert_accel"]] = [1, 1, -4, 1, 1]
    ch = preprocess_batch(X)
    np.testing.assert_allclose(ch[0, :, channel_names().index("altitude_rel_end")], [400, 300, 200, 100, 0])
    np.testing.assert_allclose(ch[0, :, channel_names().index("vert_accel")], [1, 1, 1, 1, 1])
    raw = preprocess_batch(X, median_filter_vert_accel=False)
    assert raw[0, 2, channel_names().index("vert_accel")] == -4


def test_stats_values_for_linear_signal():
    X = _windows(1, 11)
    X[0, :, IDX["airspeed"]] = np.arange(11) * 2.0 + 100
    df = build_window_features(X)
    row = df.iloc[0]
    assert row["airspeed__slope"] == 2.0
    assert row["airspeed__first"] == 100 and row["airspeed__last"] == 120
    assert row["airspeed__mean_abs_diff"] == 2.0 and row["airspeed__median"] == 110


def test_batching_does_not_change_results():
    X = _windows(7, 10)
    np.testing.assert_allclose(build_window_features(X, batch_size=3), build_window_features(X, batch_size=100))


def test_feature_cache_round_trip(tmp_path):
    X = _windows(4, 10)
    first = load_or_build_features(X, tmp_path)
    assert (tmp_path / f"window_features_{FEATURE_SET_VERSION}.npy").exists()
    second = load_or_build_features(X, tmp_path)
    np.testing.assert_array_equal(first.to_numpy(), second.to_numpy())
