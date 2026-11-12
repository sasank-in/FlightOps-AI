# API Contracts

## Inference API (Phase 4, implemented)

Service: `services/inference-api` (FastAPI). Base URL when running locally: `http://127.0.0.1:8000`.
The OpenAPI schema is served at `/openapi.json`, and interactive docs at `/docs`.

### `POST /v1/score`

**Request**

```json
{
  "windows": [
    {
      "flight_id": "example-flight-001",
      "window_start_seconds": 0,
      "telemetry": {
        "aileron_lh": [160 numbers], "aileron_rh": [...], "aoa": [...], "altitude": [...],
        "airspeed": [...], "selected_course": [...], "drift_angle": [...], "elevator_lh": [...],
        "flap": [...], "glideslope_dev": [...], "selected_heading": [...], "localizer_dev": [...],
        "core_speed": [...], "total_pressure": [...], "pitch": [...], "roll": [...],
        "rudder": [...], "true_heading": [...], "vert_accel": [...], "wind_speed": [...]
      }
    }
  ]
}
```

- **Window:** 160 seconds at 1 Hz, raw values in the units of `docs/data-dictionary.md`.
- **Variables:** all 20 are required, in raw units. `selected_course`, `selected_heading` and
  `true_heading` are not model inputs (input set v3), but they are used for the quality flags. Flap,
  elevator, ailerons, rudder and vertical acceleration are converted internally to values relative to
  each window's final value or median.
- **Batch size:** 1–64 windows (configurable).

**Response `200`**

Real response from the served model for a dataset window labelled Flaps Late Setting
(window 99411, scored locally on 2026-11-10):

```json
{
  "request_id": "3f2b…",
  "model_name": "if_tail_hybrid",
  "model_version": "0.4.0",
  "events": [
    {
      "flight_id": "window-99411",
      "window_start_seconds": 0,
      "window_end_seconds": 159,
      "model_name": "if_tail_hybrid",
      "model_version": "0.4.0",
      "anomaly_score": 0.99819192,
      "threshold": 0.97127979,
      "is_anomaly": true,
      "supporting_features": [
        {"feature": "flap_rel_end", "statistic": "median", "observed_value": -1218.0,
         "z_score_vs_nominal_training": -261.87, "unit": "raw count (not degrees)",
         "tail_probability_vs_nominal": 1.88e-05},
        {"feature": "airspeed", "statistic": "median", "observed_value": 159.0894,
         "z_score_vs_nominal_training": 8.05, "unit": "kt", "tail_probability_vs_nominal": 1.88e-05},
        {"feature": "vert_accel_rel_median", "statistic": "mean", "observed_value": -0.2245,
         "z_score_vs_nominal_training": -3.64, "unit": "g", "tail_probability_vs_nominal": 0.00132}
      ],
      "quality_flags": {"pressure_invalid": false, "flap_jump": false, "heading_out_of_range": true,
                        "course_mismatch": false, "vert_accel_spike_count": 0},
      "score_components": {"forest_percentile": 0.938943, "tail_percentile": 0.998192},
      "interpretation": "Experimental statistical anomaly relative to nominal training approaches; engineering review required. Not a confirmed fault or a safety determination."
    }
  ]
}
```

In this example the forest component alone (0.939) is below the threshold. The tail rule raises the
alert: the window's median flap position, relative to its final setting, is more extreme than all
nominal training windows.

**Semantics**

| Field | Meaning |
|-------|---------|
| `anomaly_score` | **Higher = more anomalous**, range 0–1. Max of two percentiles among nominal calibration windows: the Isolation Forest score and the tail score (sum of the 3 largest −log10 per-feature tail probabilities). Not a probability of a fault. With a plain `isolation_forest` artifact, it is the negated `score_samples` instead |
| `threshold` | Alerts on the top 5% of nominal calibration windows (5% target false-alarm rate on nominal approaches of aircraft seen in training; measured 5.5–6.5% on unseen aircraft) |
| `is_anomaly` | `anomaly_score >= threshold` |
| `score_components` | The two percentiles behind the score (hybrid model only; `null` otherwise) |
| `supporting_features` | The 3 channels whose statistics are rarest among **nominal training** windows (hybrid: ranked by tail probability; forest: by \|z\|). Channels ending `_rel_end` / `_rel_median` are relative to the window's final value or median (per-aircraft offsets removed). This describes what is unusual; it is **not** causal and not the model's internal attribution |
| `tail_probability_vs_nominal` | Share of nominal training windows at least this extreme (two-sided). Floor ≈ 1.9×10⁻⁵ (1 / number of training windows). Hybrid only |
| `quality_flags` | Data-quality checks from `flightops.data.quality`. Review flagged windows before interpreting the score |

Measured performance (test split, `docs/evaluation-report.md`): precision 0.468, recall 0.391,
PR-AUC 0.410. Aircraft held out: PR-AUC 0.402 ± 0.036. Detection: Flaps Late 97%, Path High 70%,
Speed High 22% (weak; part of this class has questionable labels).

**Errors** (never echo input values)

| Status | Body `error` | When |
|--------|--------------|------|
| 422 | `invalid_request` | Schema violation (missing or unknown variable, wrong length, non-finite value, bad `flight_id`, extra field, batch size). `detail` lists `loc`, `msg`, `type` |
| 413 | `payload_too_large` | Body over the configured limit |
| 503 | `model_unavailable` | Model artifact missing or incompatible (see `/health`) |

### `GET /v1/model`
Model name and version, feature-set version, threshold, input variables and units, score direction,
and the evaluation summary read from the matching report.

### `GET /health`
`{"status": "ok", "model_loaded": true, "load_error": null}` (200), or `degraded` (503) with the load error.

## Application backend (Phase 5, implemented)

Service: `services/application-backend` (Spring Boot 4, Java 21, PostgreSQL). Base URL when running
locally: `http://127.0.0.1:8080`. All endpoints are under `/api/v1` and require
`Authorization: Bearer <token>`, except login. Errors are RFC 9457 problem JSON
(`{"title", "status", "detail"}`; validation errors add `errors: [{field, message}]`). Request values
are never echoed.

### Authentication

`POST /api/v1/auth/login` `{"username": "...", "password": "..."}`
→ `200 {"access_token": "<JWT>", "token_type": "Bearer", "expires_in": 3600}`

- `401`: invalid credentials (identical for an unknown user and a wrong password).
- `429`: locked for 15 minutes after 5 consecutive failures.
- The token carries `sub` (username) and `roles` (`ANALYST` or `ADMIN`), issuer `flightops-backend`,
  HS256. The user is re-checked on every request, so a disabled user is refused immediately.

### Flights

`POST /api/v1/flights/upload` → `201` + `Location`

```json
{
  "externalFlightReference": "DASHLINK-DEMO-1",
  "datasetId": "dashlink-4class",
  "metadata": {"any": "JSON object, max 16 KB"},
  "windows": [
    {"windowStartSeconds": 0, "telemetry": {"aileron_lh": [160 numbers], "...": "all 20 variables"}}
  ]
}
```

| Rule | Limit |
|------|-------|
| Windows | 1–500 (`flightops.upload.max-windows`) |
| Telemetry | Exactly the 20 variables of the inference API, 160 finite numbers each |
| `externalFlightReference` | `[A-Za-z0-9._:/-]{1,128}` |
| Body | ≤ 32 MB, with `Content-Length` |

Response: `{"id", "externalFlightReference", "datasetId", "nWindows", "ownerId", "createdAt"}`.

| Method | Path | Response |
|--------|------|----------|
| GET | `/flights?page=0&size=20&q=` | `{"items": [flight...], "page", "size", "totalItems", "totalPages"}`. Own flights; admins see all. Optional `q` (≤128 chars, otherwise `400`) is a case-insensitive substring match on `externalFlightReference`; `%` and `_` match literally. Each list item also has `latestAnalysis`: `{"id", "status", "nAboveThreshold", "nWindows"}` for the flight's newest run, or `null` if the flight has never been analysed. The counts are `null` until the run completes |
| GET | `/flights/{id}` | `{"flight": {...}, "metadata": {...}, "windows": [{"windowIndex", "windowStartSeconds", "windowEndSeconds"}]}` |
| GET | `/flights/{id}/telemetry?window=k` | `{"flightId", "windowIndex", "windowStartSeconds", "windowEndSeconds", "telemetry": {20 variables}}` |
| DELETE | `/flights/{id}` | `204`. Windows, analyses and events are deleted too |

A flight owned by another analyst returns `404`, not `403`, so its existence is not revealed.

### Analyses (asynchronous)

`POST /api/v1/flights/{id}/analyses` → `202` + `Location: /api/v1/analyses/{runId}`. Poll
`GET /api/v1/analyses/{runId}`:

```json
{"id": 1, "flightId": 1, "status": "COMPLETED", "modelName": "if_tail_hybrid", "modelVersion": "0.4.0",
 "threshold": 0.9713, "startedAt": "...", "completedAt": "...",
 "metrics": {"n_windows": 8, "n_above_threshold": 3, "max_score": 0.9938, "mean_score": 0.687},
 "error": null}
```

- **Status:** `PENDING` → `RUNNING` → `COMPLETED` | `FAILED`.
- **`error`:** a safe summary only, e.g. "Inference service unavailable or timed out".
- **`429`:** more than 30 starts per user per minute.

`GET /api/v1/flights/{id}/anomalies?analysisId=&onlyAboveThreshold=false` uses the latest completed run
by default. It returns `409` if the given run is not completed, and `404` if there is none:

```json
{"flightId": 1, "analysisId": 1, "modelName": "if_tail_hybrid", "modelVersion": "0.4.0", "threshold": 0.9713,
 "nWindows": 8, "nAboveThreshold": 3,
 "events": [{"windowIndex": 6, "windowStartSeconds": 960, "windowEndSeconds": 1119, "anomalyScore": 0.9929,
             "threshold": 0.9713, "isAnomaly": true, "severityLabel": "ABOVE_THRESHOLD",
             "evidence": {"supporting_features": [...], "quality_flags": {...}, "score_components": {...},
                          "interpretation": "..."}}]}
```

`severityLabel` is only the position relative to the model threshold, **not a safety severity**.
`evidence` is the inference API's per-window output, stored unchanged.

### Dashboard support

| Method | Path | Response |
|--------|------|----------|
| GET | `/me` | `{"id", "username", "role"}` |
| GET | `/model` | The inference API's model card (`GET /v1/model`), passed through; `503` if the inference service is down |
| GET | `/stats` | Statistics over the user's visible flights (admins: all). Counts: `flights`, `windows`, `analysesCompleted`, `analysesFailed`, `analysesInProgress`, `lastAnalysisAt`. Scores: `windowsScored` and `windowsAboveThreshold`, from each flight's **latest** completed run, so re-runs are not double-counted. Lists: `recentAnalyses` (latest 8) and `flightsByAlerts` (top 10) |

### Administration (ADMIN role)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/users` | List users (no password hashes) |
| POST | `/users` | `{"username": "[A-Za-z0-9._-]{3,64}", "password": "≥12 chars", "role": "ANALYST" or "ADMIN"}` → `201`; `409` if the user exists |
| PATCH | `/users/{id}` | `{"enabled": false}` disables a user immediately (an admin cannot disable themselves) |
| GET | `/audit?limit=100` | `[{"id", "at", "username", "action", "entityType", "entityId", "outcome", "detail"}]` |

Audited actions: `LOGIN`, `USER_CREATE`, `USER_ENABLE`/`USER_DISABLE`, `FLIGHT_UPLOAD`, `FLIGHT_ACCESS`
(denied), `FLIGHT_DELETE`, `ANALYSIS_START`, `ANALYSIS_ACCESS` (denied). Outcomes are `SUCCESS`,
`DENIED` and `FAILURE`. Details never contain passwords, tokens or telemetry.

### Not yet implemented

`POST /api/v1/reports` and `GET /api/v1/reports/{id}` (documentation.md §17) depend on the AI assistant
and are planned for Phase 7.
