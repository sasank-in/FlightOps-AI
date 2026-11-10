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
    assert "flap_rel_end" in ch and "flap" not in ch
    assert {"aileron_lh_rel_median", "aileron_rh_rel_median", "elevator_lh_rel_median", "rudder_rel_median",
            "vert_accel_rel_median"} <= set(ch)
    assert len(feature_names()) == 17 * len(STATS)


def test_per_aircraft_sensor_offsets_do_not_change_features():
    # v3: a constant calibration offset on flap / elevator / ailerons / rudder (differs per aircraft)
    # must not change any feature; real movement within the window still must.
    X = _windows(2, 12)
    X[1] = X[0]
    for name, offset in (("flap", 95.0), ("elevator_lh", -42.0), ("aileron_lh", 5.3), ("aileron_rh", -3.1),
                         ("rudder", 1.8), ("vert_accel", -0.12)):
        X[1, :, IDX[name]] += offset
    f = build_window_features(X)
    np.testing.assert_allclose(f.iloc[0], f.iloc[1], rtol=1e-4, atol=1e-3)
    X[1, 6:, IDX["flap"]] += 500.0                      # flaps actually move: must be visible
    assert not np.allclose(build_window_features(X).iloc[1], f.iloc[0], atol=1e-3)


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
    va = channel_names().index("vert_accel_rel_median")
    np.testing.assert_allclose(ch[0, :, channel_names().index("altitude_rel_end")], [400, 300, 200, 100, 0])
    np.testing.assert_allclose(ch[0, :, va], [0, 0, 0, 0, 0])       # spike filtered, then median (1 g) removed
    raw = preprocess_batch(X, median_filter_vert_accel=False)
    np.testing.assert_allclose(raw[0, :, va], [0, 0, -5, 0, 0])     # unfiltered: spike kept, relative to median


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
