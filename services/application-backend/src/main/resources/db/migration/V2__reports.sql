-- Phase 7: evidence-grounded engineering reports (documentation.md §16, §18 "reports").
-- The report is stored in the database rather than behind a report_uri: it is small (a few KB),
-- must follow the flight's access rules, and is deleted with the flight.
-- evidence_json is the exact evidence package the writer saw, so every statement can be traced.

create table reports (
    id              bigserial primary key,
    analysis_run_id bigint       not null references analysis_runs (id) on delete cascade,
    flight_id       bigint       not null references flights (id) on delete cascade,
    requested_by    bigint       not null references users (id),
    status          varchar(16)  not null check (status in ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED')),
    -- 'llm' (language-model narrative, validated) or 'deterministic' (template only)
    generator       varchar(16)  check (generator in ('llm', 'deterministic')),
    llm_provider    varchar(32),
    llm_model       varchar(128),
    prompt_version  varchar(16),
    evidence_json   jsonb,
    content_json    jsonb,
    content_md      text,
    fallback_reason varchar(300),
    error_message   varchar(500),
    created_at      timestamptz  not null default now(),
    completed_at    timestamptz
);
create index reports_flight_created_idx on reports (flight_id, created_at desc);
create index reports_run_idx on reports (analysis_run_id);
