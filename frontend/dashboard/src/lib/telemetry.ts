import type { UploadBody } from "../api/types";

/**
 * Telemetry contract shared with the backend and inference API: exactly these 20 variables,
 * 160 finite samples each (1 Hz). Must match src/flightops/data/schema.py (a test checks this).
 */
export const TIMESTEPS = 160;

export const VARIABLES = [
  "aileron_lh", "aileron_rh", "aoa", "altitude", "airspeed", "selected_course", "drift_angle",
  "elevator_lh", "flap", "glideslope_dev", "selected_heading", "localizer_dev", "core_speed",
  "total_pressure", "pitch", "roll", "rudder", "true_heading", "vert_accel", "wind_speed",
] as const;

export type Variable = (typeof VARIABLES)[number];

/** Display names and units (docs/data-dictionary.md). */
export const VARIABLE_INFO: Record<Variable, { label: string; unit: string }> = {
  aileron_lh: { label: "Aileron position (LH)", unit: "deg*" },
  aileron_rh: { label: "Aileron position (RH)", unit: "deg*" },
  aoa: { label: "Angle of attack", unit: "deg" },
  altitude: { label: "Barometric altitude", unit: "ft MSL" },
  airspeed: { label: "Computed airspeed", unit: "kt" },
  selected_course: { label: "Selected course", unit: "deg" },
  drift_angle: { label: "Drift angle", unit: "deg" },
  elevator_lh: { label: "Elevator position (LH)", unit: "deg" },
  flap: { label: "Trailing-edge flap", unit: "raw count" },
  glideslope_dev: { label: "Glideslope deviation", unit: "DDM" },
  selected_heading: { label: "Selected heading", unit: "deg" },
  localizer_dev: { label: "Localizer deviation", unit: "DDM" },
  core_speed: { label: "Core speed (avg)", unit: "%" },
  total_pressure: { label: "Total pressure", unit: "mbar" },
  pitch: { label: "Pitch angle", unit: "deg" },
  roll: { label: "Roll angle", unit: "deg" },
  rudder: { label: "Rudder position", unit: "deg" },
  true_heading: { label: "True heading", unit: "deg" },
  vert_accel: { label: "Vertical acceleration", unit: "g" },
  wind_speed: { label: "Wind speed", unit: "kt" },
};

export const DEFAULT_VARIABLES: Variable[] = ["airspeed", "altitude", "flap", "glideslope_dev"];

/** Signals grouped the way an analyst reads an approach (used by pickers). */
export const SIGNAL_GROUPS: { label: string; variables: Variable[] }[] = [
  { label: "Speed & energy", variables: ["airspeed", "core_speed", "altitude", "vert_accel", "total_pressure", "wind_speed"] },
  { label: "Flight path", variables: ["glideslope_dev", "localizer_dev", "aoa", "pitch", "roll", "drift_angle"] },
  { label: "Configuration & controls", variables: ["flap", "elevator_lh", "aileron_lh", "aileron_rh", "rudder"] },
  { label: "Heading & course", variables: ["true_heading", "selected_heading", "selected_course"] },
];

const STAT_LABELS: Record<string, string> = {
  mean: "Mean", std: "Std. deviation", min: "Minimum", max: "Maximum", median: "Median", iqr: "Interquartile range",
  first: "Value at start", last: "Value at end", slope: "Trend (slope)", mean_abs_diff: "Mean change per second",
};

/** Model channel ("flap_rel_end") -> readable signal name ("Trailing-edge flap", relative to window end). */
export function signalLabel(channel: string): { label: string; qualifier: string | null } {
  const base = channel.split("_rel_")[0] as Variable;
  const label = VARIABLE_INFO[base]?.label ?? channel.replaceAll("_", " ");
  const qualifier = channel.endsWith("_rel_end") ? "relative to window end"
    : channel.endsWith("_rel_median") ? "relative to window median" : null;
  return { label, qualifier };
}

export function statisticLabel(stat: string): string {
  return STAT_LABELS[stat] ?? stat;
}

export const MAX_WINDOWS = 500;
const REF_PATTERN = /^[A-Za-z0-9._:/-]{1,128}$/;

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  body?: UploadBody;
}

/** A valid one-window upload file (all signals zero) for users to start from. */
export function uploadTemplate(): UploadBody {
  return {
    externalFlightReference: "MY-FLIGHT-001",
    datasetId: "my-dataset",
    metadata: { note: "Replace the zero series with recorded telemetry (160 samples at 1 Hz per signal)." },
    windows: [{ windowStartSeconds: 0, telemetry: Object.fromEntries(VARIABLES.map((v) => [v, Array(TIMESTEPS).fill(0)])) }],
  };
}

/** Client-side mirror of the backend's upload validation, so problems are shown before sending. */
export function validateUpload(raw: unknown): ValidationResult {
  const errors: string[] = [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: ["The file must contain a JSON object."] };
  }
  const obj = raw as Record<string, unknown>;
  const ref = obj.externalFlightReference;
  if (typeof ref !== "string" || !REF_PATTERN.test(ref)) {
    errors.push("externalFlightReference is required (letters, digits and . _ : / - only, max 128).");
  }
  const windows = obj.windows;
  if (!Array.isArray(windows) || windows.length === 0) {
    errors.push("windows must be a non-empty array.");
  } else if (windows.length > MAX_WINDOWS) {
    errors.push(`At most ${MAX_WINDOWS} windows per upload (found ${windows.length}).`);
  } else {
    windows.forEach((w, i) => {
      if (errors.length >= 8) return;
      const win = w as Record<string, unknown>;
      const start = win?.windowStartSeconds;
      if (typeof start !== "number" || !Number.isInteger(start) || start < 0) {
        errors.push(`Window ${i}: windowStartSeconds must be a non-negative integer.`);
      }
      const tel = win?.telemetry as Record<string, unknown> | undefined;
      if (typeof tel !== "object" || tel === null) {
        errors.push(`Window ${i}: telemetry object is missing.`);
        return;
      }
      const missing = VARIABLES.filter((v) => !(v in tel));
      const unknown = Object.keys(tel).filter((k) => !(VARIABLES as readonly string[]).includes(k));
      if (missing.length || unknown.length) {
        const list = (xs: string[]) => (xs.length > 3 ? `${xs.slice(0, 3).join(", ")} and ${xs.length - 3} more` : xs.join(", "));
        const parts = [
          missing.length ? `missing ${missing.length} of ${VARIABLES.length} signals (${list(missing)})` : "",
          unknown.length ? `${unknown.length} unknown key${unknown.length === 1 ? "" : "s"} (${list(unknown)})` : "",
        ].filter(Boolean);
        errors.push(`Window ${i}: ${parts.join("; ")}.`);
        return;
      }
      for (const v of VARIABLES) {
        const series = tel[v];
        if (!Array.isArray(series) || series.length !== TIMESTEPS) {
          errors.push(`Window ${i}: '${v}' must have exactly ${TIMESTEPS} values.`);
          return;
        }
        const bad = series.findIndex((x) => typeof x !== "number" || !Number.isFinite(x));
        if (bad >= 0) {
          errors.push(`Window ${i}: '${v}' has a missing or non-finite value at second ${bad}.`);
          return;
        }
      }
    });
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, errors: [], body: raw as UploadBody };
}
