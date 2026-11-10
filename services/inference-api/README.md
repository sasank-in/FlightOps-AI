# FlightOps AI: Inference API

FastAPI service that scores 160-second telemetry windows with the selected detector
**`if_tail_hybrid` 0.4.0**, i.e. Isolation Forest + per-feature tail rule on input set v3
(`artifacts/models/if_tail_hybrid_v0.4.0.joblib`). Selection evidence is in
[docs/evaluation-report.md](../../docs/evaluation-report.md).

> Experimental analytics only. A high score is a statistical deviation from nominal training
> approaches. It is not a confirmed fault, and it is not an input to any flight-safety, dispatch or
> maintenance decision.

## Run locally (Windows, conda env `environ`)

```powershell
conda activate environ
cd C:\Users\shash\FlightOps-AI
python -m pip install -e ".[api]"            # fastapi, uvicorn (once)
uvicorn app.main:app --app-dir services/inference-api --host 127.0.0.1 --port 8000
```

- Interactive docs: http://127.0.0.1:8000/docs
- Demo with real dataset windows (in a second terminal):
  `python services/inference-api/examples/demo_client.py --per-class 2`

The model artifact must exist. Create it with `python -m flightops.models.train_hybrid` (about 2
minutes on CPU; it also writes `artifacts/reports/hybrid.json`). An `isolation_forest_v0.4.0.joblib`
from `train_baseline` can be served instead via `FLIGHTOPS_MODEL_PATH`.

## Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `FLIGHTOPS_MODEL_PATH` | `artifacts/models/if_tail_hybrid_v0.4.0.joblib` | Model artifact (set by the operator, never by a request) |
| `FLIGHTOPS_MAX_BATCH` | 64 | Max windows per request |
| `FLIGHTOPS_MAX_BODY_MB` | 16 | Max request body size |

## Endpoints

See [docs/api-contracts.md](../../docs/api-contracts.md) for full request and response schemas.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | `200 ok` when the model is loaded, `503 degraded` otherwise |
| GET | `/v1/model` | Model name, version, threshold, input variables and units, evaluation summary |
| POST | `/v1/score` | Score 1–64 windows; returns one anomaly event per window |

## Safety and robustness

- Strict validation:
  - exactly the 20 documented variables, each 160 finite values;
  - unknown fields rejected;
  - `flight_id` limited to `[A-Za-z0-9._:-]{1,64}`.
- Validation errors report the location and reason but **never echo input values**.
- Request size and batch limits; every response carries an `x-request-id`.
- Logs contain method, path, status, latency and request id. **Telemetry is never logged.**
- The model path comes only from server configuration. A model trained on a different feature set,
  or an unknown artifact type, is refused at startup (`/health` reports why).
- Joblib artifacts use pickle, so only load artifacts this project produced.
