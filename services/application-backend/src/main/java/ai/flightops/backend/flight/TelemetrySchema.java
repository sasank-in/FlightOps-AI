package ai.flightops.backend.flight;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

import ai.flightops.backend.common.ApiException;

/**
 * Telemetry window contract shared with the inference API: exactly these 20 variables, each
 * {@value #TIMESTEPS} finite samples at 1 Hz. Must match src/flightops/data/schema.py
 * (FEATURE_NAMES); a test checks this.
 */
public final class TelemetrySchema {

    public static final int TIMESTEPS = 160;

    public static final List<String> VARIABLES = List.of(
            "aileron_lh", "aileron_rh", "aoa", "altitude", "airspeed", "selected_course", "drift_angle",
            "elevator_lh", "flap", "glideslope_dev", "selected_heading", "localizer_dev", "core_speed",
            "total_pressure", "pitch", "roll", "rudder", "true_heading", "vert_accel", "wind_speed");

    private static final Set<String> VARIABLE_SET = Set.copyOf(VARIABLES);

    private TelemetrySchema() {}

    /** Throws a 400 with a safe message (variable names and positions only, never values). */
    public static void validate(Map<String, List<Double>> telemetry, int windowIndex) {
        if (telemetry == null) {
            throw ApiException.badRequest("window " + windowIndex + ": telemetry is required");
        }
        Set<String> missing = new TreeSet<>(VARIABLE_SET);
        missing.removeAll(telemetry.keySet());
        Set<String> unknown = new TreeSet<>(telemetry.keySet());
        unknown.removeAll(VARIABLE_SET);
        if (!missing.isEmpty() || !unknown.isEmpty()) {
            throw ApiException.badRequest("window " + windowIndex + ": telemetry variables mismatch (missing="
                    + missing + ", unknown=" + unknown.size() + ")");
        }
        for (String name : VARIABLES) {
            List<Double> series = telemetry.get(name);
            if (series == null || series.size() != TIMESTEPS) {
                throw ApiException.badRequest("window " + windowIndex + ": '" + name + "' must have exactly "
                        + TIMESTEPS + " values");
            }
            for (int t = 0; t < TIMESTEPS; t++) {
                Double v = series.get(t);
                if (v == null || !Double.isFinite(v)) {
                    throw ApiException.badRequest("window " + windowIndex + ": '" + name + "' has a missing or non-finite value at second " + t);
                }
            }
        }
    }
}
