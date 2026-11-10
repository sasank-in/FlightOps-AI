"""Verified dataset schema (source: DASHlink_full_data_documentation.pdf)."""

from __future__ import annotations

# Index -> (official name, short name, documented unit)
FEATURES: list[tuple[str, str, str]] = [
    ("AILERON POSITION LH", "aileron_lh", "degree (encoding unclear)"),
    ("AILERON POSITION RH", "aileron_rh", "degree (encoding unclear)"),
    ("CORRECTED ANGLE OF ATTACK", "aoa", "degree"),
    ("BARO CORRECT ALTITUDE LSP", "altitude", "ft (MSL)"),
    ("COMPUTED AIRSPEED LSP", "airspeed", "kt"),
    ("SELECTED COURSE", "selected_course", "degree"),
    ("DRIFT ANGLE", "drift_angle", "degree"),
    ("ELEVATOR POSITION LEFT", "elevator_lh", "degree"),
    ("T.E. FLAP POSITION", "flap", "raw count (not degrees)"),
    ("GLIDESLOPE DEVIATION", "glideslope_dev", "DDM"),
    ("SELECTED HEADING", "selected_heading", "degree"),
    ("LOCALIZER DEVIATION", "localizer_dev", "DDM"),
    ("CORE SPEED AVG", "core_speed", "%"),
    ("TOTAL PRESSURE LSP", "total_pressure", "mbar"),
    ("PITCH ANGLE LSP", "pitch", "degree"),
    ("ROLL ANGLE LSP", "roll", "degree"),
    ("RUDDER POSITION", "rudder", "degree"),
    ("TRUE HEADING LSP", "true_heading", "degree"),
    ("VERTICAL ACCELERATION", "vert_accel", "g"),
    ("WIND SPEED", "wind_speed", "kt"),
]

FEATURE_NAMES: list[str] = [short for _, short, _ in FEATURES]
IDX: dict[str, int] = {name: i for i, name in enumerate(FEATURE_NAMES)}

# Angles that wrap at +/-180 degrees.
CIRCULAR_FEATURES: tuple[str, ...] = ("selected_course", "selected_heading", "true_heading")

LABELS: dict[int, str] = {0: "Nominal", 1: "Speed High", 2: "Path High", 3: "Flaps Late Setting"}
