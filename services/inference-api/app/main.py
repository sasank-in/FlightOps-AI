"""FlightOps AI inference API (Phase 4).

Serves the selected detector (Isolation Forest v2) behind validated endpoints.
Experimental analytics only: not a flight-safety, dispatch, or maintenance system.

Run (from the repo root, conda env `environ`):
    uvicorn app.main:app --app-dir services/inference-api --port 8000
Then open http://127.0.0.1:8000/docs

Configuration (environment variables):
    FLIGHTOPS_MODEL_PATH   model artifact (default: artifacts/models/isolation_forest_v<version>.joblib)
    FLIGHTOPS_MAX_BATCH    max windows per request (default 64)
    FLIGHTOPS_MAX_BODY_MB  max request body size in MB (default 16)
"""

from __future__ import annotations

import logging
import os
import time
import uuid
from contextlib import asynccontextmanager
from typing import Annotated

import numpy as np
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, FiniteFloat, model_validator

from flightops.data.schema import FEATURE_NAMES
from flightops.inference.predict import INTERPRETATION, N_TIMESTEPS, Predictor

MAX_BATCH = int(os.environ.get("FLIGHTOPS_MAX_BATCH", "64"))
MAX_BODY_BYTES = int(float(os.environ.get("FLIGHTOPS_MAX_BODY_MB", "16")) * 1024 * 1024)

log = logging.getLogger("flightops.api")
STATE: dict = {"predictor": None, "load_error": None}


# --- Schemas -------------------------------------------------------------------------
Series = Annotated[list[FiniteFloat], Field(min_length=N_TIMESTEPS, max_length=N_TIMESTEPS)]


class TelemetryWindow(BaseModel):
    model_config = ConfigDict(extra="forbid")

    flight_id: str = Field(..., min_length=1, max_length=64, pattern=r"^[A-Za-z0-9._:-]+$")
    window_start_seconds: int = Field(0, ge=0, le=10_000_000)
    telemetry: dict[str, Series] = Field(
        ..., description=f"Exactly these {len(FEATURE_NAMES)} variables, each {N_TIMESTEPS} values at 1 Hz: "
                         + ", ".join(FEATURE_NAMES))

    @model_validator(mode="after")
    def _check_variables(self):
        missing = sorted(set(FEATURE_NAMES) - set(self.telemetry))
        unknown = sorted(set(self.telemetry) - set(FEATURE_NAMES))
        if missing or unknown:
            raise ValueError(f"telemetry variables mismatch: missing={missing} unknown={unknown}")
        return self

    def to_array(self) -> np.ndarray:
        return np.stack([self.telemetry[name] for name in FEATURE_NAMES], axis=1)  # (160, 20)


class ScoreRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    windows: list[TelemetryWindow] = Field(..., min_length=1, max_length=MAX_BATCH)


class SupportingFeature(BaseModel):
    feature: str
    statistic: str
    observed_value: float
    z_score_vs_nominal_training: float
    unit: str


class QualityFlags(BaseModel):
    pressure_invalid: bool
    flap_jump: bool
    heading_out_of_range: bool
    course_mismatch: bool
    vert_accel_spike_count: int


class AnomalyEvent(BaseModel):
    """documentation.md §15 anomaly event contract."""
    flight_id: str
    window_start_seconds: int
    window_end_seconds: int
    model_name: str
    model_version: str
    anomaly_score: float
    threshold: float
    is_anomaly: bool
    supporting_features: list[SupportingFeature]
    quality_flags: QualityFlags
    interpretation: str


class ScoreResponse(BaseModel):
    request_id: str
    model_name: str
    model_version: str
    events: list[AnomalyEvent]


# --- App -----------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        STATE["predictor"] = Predictor.load()
        log.info("model loaded: %s", STATE["predictor"].metadata()["model_version"])
    except Exception as exc:  # keep serving /health so the failure is visible
        STATE["load_error"] = f"{type(exc).__name__}: {exc}"
        log.error("model failed to load: %s", STATE["load_error"])
    yield
    STATE["predictor"] = None


app = FastAPI(
    title="FlightOps AI Inference API",
    version="0.1.0",
    description="Experimental flight-telemetry anomaly scoring. " + INTERPRETATION,
    lifespan=lifespan,
)


@app.middleware("http")
async def limits_and_request_id(request: Request, call_next):
    supplied = request.headers.get("x-request-id", "")
    request_id = supplied if supplied.isalnum() and len(supplied) <= 64 else uuid.uuid4().hex
    request.state.request_id = request_id
    length = request.headers.get("content-length")
    if length is not None and (not length.isdigit() or int(length) > MAX_BODY_BYTES):
        return JSONResponse(status_code=413, content={"error": "payload_too_large",
                                                      "detail": f"max body size is {MAX_BODY_BYTES} bytes",
                                                      "request_id": request_id})
    start = time.perf_counter()
    response = await call_next(request)
    response.headers["x-request-id"] = request_id
    # Log metadata only: never the telemetry payload.
    log.info("%s %s %s %.1fms id=%s", request.method, request.url.path, response.status_code,
             (time.perf_counter() - start) * 1000, request_id)
    return response


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError):
    # Report where and why, but never echo input values: they can be large, sensitive,
    # or non-JSON-serialisable (e.g. Infinity), which would turn a 422 into a server error.
    errors = [{"loc": [str(p) for p in e.get("loc", ())], "msg": e.get("msg", ""), "type": e.get("type", "")}
              for e in exc.errors()[:20]]
    return JSONResponse(status_code=422, content={"error": "invalid_request", "detail": errors,
                                                  "request_id": getattr(request.state, "request_id", None)})


def _predictor() -> Predictor:
    if STATE["predictor"] is None:
        raise HTTPException(status_code=503, detail={"error": "model_unavailable", "detail": STATE["load_error"]})
    return STATE["predictor"]


@app.get("/health")
def health():
    ok = STATE["predictor"] is not None
    return JSONResponse(status_code=200 if ok else 503,
                        content={"status": "ok" if ok else "degraded", "model_loaded": ok,
                                 "load_error": None if ok else STATE["load_error"]})


@app.get("/v1/model")
def model_info():
    return _predictor().metadata()


@app.post("/v1/score", response_model=ScoreResponse)
def score(req: ScoreRequest, request: Request):
    predictor = _predictor()
    X = np.stack([w.to_array() for w in req.windows])
    try:
        results = predictor.score_windows(X)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail={"error": "invalid_telemetry", "detail": str(exc)}) from exc
    events = [
        AnomalyEvent(
            flight_id=w.flight_id,
            window_start_seconds=w.window_start_seconds,
            window_end_seconds=w.window_start_seconds + N_TIMESTEPS - 1,
            model_name=predictor.model_name,
            model_version=predictor.model_version,
            threshold=predictor.threshold,
            interpretation=INTERPRETATION,
            **r,
        )
        for w, r in zip(req.windows, results)
    ]
    return ScoreResponse(request_id=request.state.request_id, model_name=predictor.model_name,
                         model_version=predictor.model_version, events=events)
