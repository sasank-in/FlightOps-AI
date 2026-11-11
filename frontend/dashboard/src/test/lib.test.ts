import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, api, setToken, setUnauthorizedHandler } from "../api/client";
import { formatClock, formatCount, formatFeature, formatPercent, formatProbability, formatScore } from "../lib/format";
import {
  SIGNAL_GROUPS, TIMESTEPS, VARIABLES, signalLabel, statisticLabel, uploadTemplate, validateUpload,
} from "../lib/telemetry";

function telemetry(fill = 1): Record<string, number[]> {
  return Object.fromEntries(VARIABLES.map((v) => [v, Array.from({ length: TIMESTEPS }, () => fill)]));
}

describe("telemetry contract", () => {
  it("matches the Python schema (src/flightops/data/schema.py)", () => {
    const py = readFileSync(resolve(__dirname, "../../../../src/flightops/data/schema.py"), "utf8");
    const block = py.slice(py.indexOf("FEATURES:"), py.indexOf("\n]", py.indexOf("FEATURES:")));
    const names = [...block.matchAll(/\("[^"]+",\s*"([a-z_]+)",\s*"[^"]*"\)/g)].map((m) => m[1]);
    expect(names).toEqual([...VARIABLES]);
  });

  it("accepts a valid upload", () => {
    const r = validateUpload({ externalFlightReference: "F-1", windows: [{ windowStartSeconds: 0, telemetry: telemetry() }] });
    expect(r.ok).toBe(true);
    expect(r.body?.windows).toHaveLength(1);
  });

  it("rejects bad references, missing variables, wrong lengths and non-finite values", () => {
    expect(validateUpload({ externalFlightReference: "bad ref", windows: [] }).errors).toHaveLength(2);
    const missing = telemetry();
    delete missing.flap;
    expect(validateUpload({ externalFlightReference: "F", windows: [{ windowStartSeconds: 0, telemetry: missing }] }).errors[0])
      .toContain("missing 1 of 20 signals (flap)");
    const many = validateUpload({ externalFlightReference: "F", windows: [{ windowStartSeconds: 0, telemetry: { flap: [] } }] }).errors[0];
    expect(many).toContain("missing 19 of 20 signals");
    expect(many).toContain("and 16 more");                     // long lists are summarised, not dumped
    const short = telemetry();
    short.airspeed = [1, 2, 3];
    expect(validateUpload({ externalFlightReference: "F", windows: [{ windowStartSeconds: 0, telemetry: short }] }).errors[0])
      .toContain("'airspeed' must have exactly 160 values");
    const nan = telemetry();
    nan.pitch![7] = Number.NaN;
    expect(validateUpload({ externalFlightReference: "F", windows: [{ windowStartSeconds: 0, telemetry: nan }] }).errors[0])
      .toContain("'pitch' has a missing or non-finite value at second 7");
    expect(validateUpload([1, 2]).ok).toBe(false);
    expect(validateUpload({ externalFlightReference: "F", windows: [{ windowStartSeconds: -1, telemetry: telemetry() }] }).ok).toBe(false);
  });
});

describe("readable names and templates", () => {
  it("turns model channels and statistics into analyst-facing labels", () => {
    expect(signalLabel("flap_rel_end")).toEqual({ label: "Trailing-edge flap", qualifier: "relative to window end" });
    expect(signalLabel("aileron_rh_rel_median")).toEqual({ label: "Aileron position (RH)", qualifier: "relative to window median" });
    expect(signalLabel("airspeed")).toEqual({ label: "Computed airspeed", qualifier: null });
    expect(statisticLabel("iqr")).toBe("Interquartile range");
    expect(statisticLabel("mean_abs_diff")).toBe("Mean change per second");
  });

  it("groups every signal exactly once", () => {
    const grouped = SIGNAL_GROUPS.flatMap((g) => g.variables);
    expect([...grouped].sort()).toEqual([...VARIABLES].sort());
  });

  it("offers a template that passes validation", () => {
    expect(validateUpload(uploadTemplate()).ok).toBe(true);
  });

  it("formats time in flight as a clock", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(800)).toBe("13:20");
    expect(formatClock(3725)).toBe("1:02:05");
  });
});

describe("formatting", () => {
  it("formats counts, scores, percentages and probabilities", () => {
    expect(formatCount(1284)).toBe("1,284");
    expect(formatCount(12900)).toMatch(/12\.9K/i);
    expect(formatCount(null)).toBe("—");
    expect(formatScore(0.97127, 3)).toBe("0.971");
    expect(formatPercent(0.375)).toBe("37.5%");
    expect(formatProbability(1.88e-5)).toBe("1.9e-5");
    expect(formatProbability(0.0132)).toBe("0.013");
    expect(formatFeature("flap_rel_end")).toBe("flap (rel. end)");
    expect(formatFeature("aileron_rh_rel_median")).toBe("aileron rh (rel. median)");
  });
});

describe("api client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setToken(null);
    setUnauthorizedHandler(() => {});
  });

  it("sends the bearer token and parses JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    setToken("tok");
    await expect(api("/api/v1/x")).resolves.toEqual({ ok: 1 });
    expect(fetchMock.mock.calls[0]![1].headers.Authorization).toBe("Bearer tok");
  });

  it("turns problem JSON into ApiError with field errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ detail: "Request validation failed", errors: [{ field: "username", message: "bad" }] }), { status: 400 })));
    const err = await api("/api/v1/x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(400);
    expect((err as ApiError).fieldErrors[0]?.field).toBe("username");
  });

  it("calls the unauthorized handler on 401 for authenticated calls only", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 401 })));
    await api("/api/v1/x").catch(() => undefined);
    expect(handler).toHaveBeenCalledTimes(1);
    await api("/api/v1/auth/login", { method: "POST", body: {}, auth: false }).catch(() => undefined);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("reports an unreachable backend clearly", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(api("/api/v1/x")).rejects.toThrow("Cannot reach the FlightOps backend");
  });
});
