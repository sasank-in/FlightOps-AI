import numpy as np
import pandas as pd

from flightops.data.quality import (
    duplicate_mask,
    parse_flight_record,
    window_hashes,
    window_quality_flags,
    wrap_degrees,
)
from flightops.data.schema import FEATURE_NAMES, IDX


def test_schema_has_20_unique_features():
    assert len(FEATURE_NAMES) == 20 == len(set(FEATURE_NAMES))
    assert IDX["flap"] == 8 and IDX["true_heading"] == 17


def test_parse_flight_record():
    out = parse_flight_record(pd.Series(["652200101120916", "667200911040852", "bad"]))
    assert out.aircraft_id.tolist() == ["652", "667", "bad"]
    assert out.record_time[0] == pd.Timestamp("2001-01-12 09:16")
    assert pd.isna(out.record_time[2])


def test_duplicates_detected_and_first_kept():
    X = np.arange(4 * 3 * 2, dtype=np.float32).reshape(4, 3, 2)
    X[3] = X[1]
    assert duplicate_mask(X).tolist() == [False, False, False, True]
    assert len(set(window_hashes(X))) == 3


def test_wrap_degrees():
    np.testing.assert_allclose(wrap_degrees([190, -190, 180, 0, 540]), [-170, 170, -180, 0, -180])


def test_window_quality_flags():
    X = np.zeros((3, 5, 20), dtype=np.float32)
    X[:, :, IDX["total_pressure"]] = 1000
    X[:, :, IDX["vert_accel"]] = 1.0
    X[0, :, IDX["total_pressure"]] = 60          # invalid pressure
    X[1, 3, IDX["flap"]] = 3700                  # flap jump 0 -> 3700 -> 0
    X[2, 2, IDX["true_heading"]] = 200           # out of range heading
    X[2, 1, IDX["vert_accel"]] = -3.0            # one spike
    X[0, :, IDX["true_heading"]] = 178.0
    X[0, :, IDX["selected_course"]] = -178.0     # 4 deg apart across the wrap: consistent
    X[1, :, IDX["selected_course"]] = 95.0       # heading 0 vs course 95: mismatch

    flags = window_quality_flags(X, batch_size=2)

    assert flags.course_mismatch.tolist() == [False, True, False]

    assert flags.pressure_invalid.tolist() == [True, False, False]
    assert flags.flap_jump.tolist() == [False, True, False]
    assert flags.heading_out_of_range.tolist() == [False, False, True]
    assert flags.vert_accel_spikes.tolist() == [0, 0, 1]
