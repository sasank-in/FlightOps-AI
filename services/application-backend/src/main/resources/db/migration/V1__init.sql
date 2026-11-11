-- FlightOps AI application schema (documentation.md §18).
-- Telemetry is stored as one JSONB document per 160-second window: it is always read and scored
-- per window, so a wide record avoids 3,200 rows per window (20 variables x 160 samples).

create table users (
    id            bigserial primary key,
    username      varchar(64)  not null unique,
    password_hash varchar(100) not null,
    role          varchar(16)  not null check (role in ('ANALYST', 'ADMIN')),
    enabled       boolean      not null default true,
    created_at    timestamptz  not null default now()
);

create table flights (
    id                        bigserial primary key,
    external_flight_reference varchar(128) not null,
    dataset_id                varchar(128),
    owner_id                  bigint       not null references users (id),
    metadata_json             jsonb        not null default '{}'::jsonb,
    n_windows                 integer      not null check (n_windows > 0),
    created_at                timestamptz  not null default now()
);
create index flights_owner_created_idx on flights (owner_id, created_at desc);

create table telemetry_windows (
    id                   bigserial primary key,
    flight_id            bigint  not null references flights (id) on delete cascade,
    window_index         integer not null check (window_index >= 0),
    window_start_seconds integer not null check (window_start_seconds >= 0),
    data                 jsonb   not null,
    unique (flight_id, window_index)
);

create table analysis_runs (
    id            bigserial primary key,
    flight_id     bigint      not null references flights (id) on delete cascade,
    requested_by  bigint      not null references users (id),
    status        varchar(16) not null check (status in ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED')),
    model_name    varchar(64),
    model_version varchar(32),
    threshold     double precision,
    started_at    timestamptz not null default now(),
    completed_at  timestamptz,
    metrics_json  jsonb,
    error_message varchar(500)
);
create index analysis_runs_flight_started_idx on analysis_runs (flight_id, started_at desc);

create table anomaly_events (
    id              bigserial primary key,
    analysis_run_id bigint           not null references analysis_runs (id) on delete cascade,
    window_index    integer          not null,
    start_offset    integer          not null,
    end_offset      integer          not null,
    score           double precision not null,
    threshold       double precision not null,
    is_anomaly      boolean          not null,
    -- Statistical position relative to the model threshold only; not a safety severity.
    severity_label  varchar(24)      not null check (severity_label in ('ABOVE_THRESHOLD', 'BELOW_THRESHOLD')),
    evidence_json   jsonb            not null
);
create index anomaly_events_run_idx on anomaly_events (analysis_run_id, window_index);

create table audit_events (
    id          bigserial primary key,
    at          timestamptz not null default now(),
    username    varchar(64),
    action      varchar(64) not null,
    entity_type varchar(32),
    entity_id   varchar(64),
    outcome     varchar(16) not null check (outcome in ('SUCCESS', 'DENIED', 'FAILURE')),
    detail      varchar(500)
);
create index audit_events_at_idx on audit_events (at desc);
