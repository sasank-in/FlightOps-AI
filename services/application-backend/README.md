# FlightOps AI: Application Backend (Phase 5)

Spring Boot service providing **authentication, flight and telemetry storage, analysis jobs and an
audit trail**. Scoring is delegated to the inference API (`services/inference-api`).

> Experimental analytics only. Results are statistical deviations from nominal approaches, not inputs
> to flight-safety, dispatch or maintenance decisions.

**Stack:** Java 21, Spring Boot 4.0.9 (Spring Security 7, Hibernate 7.2), PostgreSQL 16, Flyway,
HS256 JWT bearer tokens.

## Run locally (Windows)

Prerequisites:

- PostgreSQL running, with the `flightops` database created.
- The inference API running (see [services/inference-api/README.md](../inference-api/README.md)).

The repo-root `.env` (git-ignored) must contain:

```text
DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/flightops
FLIGHTOPS_JWT_SECRET=<at least 32 random bytes>
FLIGHTOPS_ADMIN_USERNAME=admin
FLIGHTOPS_ADMIN_PASSWORD=<at least 12 characters>   # first admin, created only if no users exist
```

```powershell
cd C:\Users\shash\FlightOps-AI\services\application-backend
mvn -B package                                   # builds and runs all tests (needs flightops_test DB, below)
java -jar target\application-backend-0.1.0.jar   # http://127.0.0.1:8080, schema migrated by Flyway
```

Run it from this folder: it reads `../../.env` (the repo-root `.env`). End-to-end demo with real
dataset windows, in a second terminal from the repo root with `conda activate environ`:

```powershell
python services/application-backend/examples/e2e_demo.py --per-class 2
```

## API (all under `/api/v1`; bearer token required except login)

| Method | Path | Who | Purpose |
|--------|------|-----|---------|
| POST | `/auth/login` | anyone | `{username, password}` → `{access_token, token_type, expires_in}` (1 h) |
| POST | `/flights/upload` | analyst/admin | Upload a flight: 1–500 windows of the 20 variables × 160 s (inference API contract) |
| GET | `/flights?page=&size=` | analyst/admin | Own flights (admins: all), newest first, max 100 per page |
| GET | `/flights/{id}` | owner/admin | Metadata and window list |
| GET | `/flights/{id}/telemetry?window=k` | owner/admin | Telemetry of one window |
| DELETE | `/flights/{id}` | owner/admin | Delete flight, windows, analyses and events |
| POST | `/flights/{id}/analyses` | owner/admin | Start an analysis → **202** + `Location: /api/v1/analyses/{id}` |
| GET | `/analyses/{id}` | owner/admin | Status `PENDING` / `RUNNING` / `COMPLETED` / `FAILED`, model, metrics |
| GET | `/flights/{id}/analyses` | owner/admin | All runs of a flight |
| GET | `/flights/{id}/anomalies?analysisId=&onlyAboveThreshold=` | owner/admin | Scored windows of the latest (or given) completed run, with evidence |
| GET/POST | `/users`, PATCH `/users/{id}` | admin | List, create, enable or disable users |
| GET | `/audit?limit=` | admin | Latest audit events |
| GET | `/actuator/health` | anyone | Liveness and readiness |

Errors are RFC 9457 problem JSON (`title`, `status`, `detail`). Full schemas:
[docs/api-contracts.md](../../docs/api-contracts.md).

## Design and safety

- **Authorization:** analysts can only see their own flights. Other users' flights return **404**
  (existence is not revealed), and the attempt is audited as `DENIED`. Every request re-checks that
  the user still exists and is enabled, so disabling a user revokes access immediately, not when the
  token expires.
- **Login:** passwords are hashed with BCrypt (cost 12). After 5 failed attempts the account is locked
  for 15 minutes. The same message is returned for an unknown user or a wrong password, with
  equalised timing.
- **Validation:** exactly the 20 variables, 160 finite values each, at most 500 windows, a 32 MB body
  limit, and a restricted character set for `externalFlightReference`. Error messages name the
  variable and position but **never echo values**.
- **Analyses:** run on a bounded worker pool (2 threads, queue of 100), with up to 64 windows per
  inference call and timeouts. Results are saved all-or-nothing; a failure stores a safe message only.
  Runs interrupted by a restart are marked `FAILED` at startup. Rate limit: 30 starts per user per minute.
- **`severity_label`** is only `ABOVE_THRESHOLD` / `BELOW_THRESHOLD`, a position relative to the model
  threshold. It is deliberately not a safety severity.
- **Secrets** come only from the environment or `.env`. The DB password, JWT secret and passwords are
  never logged. Telemetry is never logged.
- **Storage:** one JSONB document per 160-second window (always read and scored per window) instead of
  3,200 rows per window.

**Limitations:** the login lockout and rate limit are in-memory, so they apply per instance. There is no
retention job yet; use `DELETE /flights/{id}`. Report generation (documentation.md §17) belongs to Phase 7.

## Tests

`mvn -B test` runs **20 tests**:

- **Unit tests:** DATABASE_URL parsing, the login limiter, safe failure messages, and a check that the
  20-variable list matches the Python schema.
- **Full-stack integration tests (`*IT`):** real HTTP, real PostgreSQL and a stub inference server.
  They cover auth, lockout, roles, revocation, ownership, validation, limits, cascade delete, the
  analysis lifecycle and inference failures.

The integration tests use a **separate database `flightops_test`** on the same server (credentials
from `DATABASE_URL`). Create it once:

```powershell
psql -U postgres -c "create database flightops_test;"
```
