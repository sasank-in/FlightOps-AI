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
- **Variables:** all 20 are required. `selected_course`, `selected_heading` and `true_heading` are not
  model inputs (input set v2), but they are used for the quality flags.
- **Batch size:** 1–64 windows (configurable).

**Response `200`**

```json
{
  "request_id": "3f2b…",
  "model_name": "isolation_forest",
  "model_version": "0.2.0",
  "events": [
    {
      "flight_id": "example-flight-001",
      "window_start_seconds": 0,
      "window_end_seconds": 159,
      "model_name": "isolation_forest",
      "model_version": "0.2.0",
      "anomaly_score": 0.5088,
      "threshold": 0.4724,
      "is_anomaly": true,
      "supporting_features": [
        {"feature": "flap", "statistic": "median", "observed_value": 2452.0,
         "z_score_vs_nominal_training": -18.3, "unit": "raw count (not degrees)"}
      ],
      "quality_flags": {"pressure_invalid": false, "flap_jump": false, "heading_out_of_range": true,
                        "course_mismatch": false, "vert_accel_spike_count": 0},
      "interpretation": "Experimental statistical anomaly relative to nominal training approaches; engineering review required. Not a confirmed fault or a safety determination."
    }
  ]
}
```

**Semantics**

| Field | Meaning |
|-------|---------|
| `anomaly_score` | Negated Isolation Forest `score_samples` on the 170 v2 window features. **Higher = more anomalous.** Not a probability |
| `threshold` | Alerts on the top 5% of nominal validation windows (5% target false-positive rate on nominal approaches) |
| `is_anomaly` | `anomaly_score >= threshold` |
| `supporting_features` | The 3 channels whose window statistic deviates most from the **nominal training** distribution (z-score from the model's scaler). This describes what is unusual; it is **not** causal and not the model's internal attribution |
| `quality_flags` | Data-quality checks from `flightops.data.quality`. Review flagged windows before interpreting the score |

Measured performance (test split, `docs/evaluation-report.md`): precision 0.414, recall 0.317,
PR-AUC 0.352. Detection is strong for Path High (76%), moderate for Flaps Late (39%) and weak for
Speed High (17%).

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

## Application backend (Phase 5, proposed)
See documentation.md §17. Not implemented yet.
