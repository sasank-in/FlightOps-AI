import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { ApiError } from "../api/client";
import { endpoints } from "../api/endpoints";
import type { AnomalyEvent } from "../api/types";
import { ChartCard } from "../components/ChartCard";
import { ScoreTimeline, TelemetryLine } from "../components/charts";
import { IconPlay, IconTrash } from "../components/Icons";
import {
  Badge, Card, ConfirmButton, Empty, ErrorBanner, InfoBanner, Loading, StatusBadge, ThresholdBadge,
} from "../components/ui";
import { formatDateTime, formatFeature, formatProbability, formatScore } from "../lib/format";
import { DEFAULT_VARIABLES, VARIABLE_INFO, VARIABLES, type Variable } from "../lib/telemetry";

const MAX_SELECTED = 6;

export function FlightDetailPage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const valid = Number.isInteger(id) && id > 0;

  const flight = useQuery({ queryKey: ["flight", id], queryFn: () => endpoints.flight(id), enabled: valid });
  const analyses = useQuery({
    queryKey: ["analyses", id],
    queryFn: () => endpoints.analyses(id),
    enabled: valid && flight.isSuccess,
    refetchInterval: (q) => (q.state.data?.some((a) => a.status === "PENDING" || a.status === "RUNNING") ? 1500 : false),
  });
  const latestRun = analyses.data?.[0];
  const anomalies = useQuery({
    queryKey: ["anomalies", id, analyses.data?.find((a) => a.status === "COMPLETED")?.id ?? null],
    queryFn: async () => {
      try {
        return await endpoints.anomalies(id);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;   // no completed analysis yet
        throw e;
      }
    },
    enabled: valid && analyses.isSuccess,
  });

  const start = useMutation({
    mutationFn: () => endpoints.startAnalysis(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["analyses", id] });
      void queryClient.invalidateQueries({ queryKey: ["stats"] });
    },
  });
  const remove = useMutation({
    mutationFn: () => endpoints.deleteFlight(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["flights"] });
      void queryClient.invalidateQueries({ queryKey: ["stats"] });
      navigate("/flights");
    },
  });

  // refresh stats once a running analysis finishes
  const running = latestRun?.status === "PENDING" || latestRun?.status === "RUNNING";
  useEffect(() => {
    if (!running) void queryClient.invalidateQueries({ queryKey: ["stats"] });
  }, [running, queryClient]);

  const events = anomalies.data?.events ?? [];
  const [selected, setSelected] = useState<number | null>(null);
  // Default selection waits for the analysis result, so it opens on the first alert (not window 0).
  useEffect(() => {
    if (!anomalies.isSuccess) return;
    const firstAlert = anomalies.data?.events.find((e) => e.isAnomaly);
    setSelected((cur) => cur ?? firstAlert?.windowIndex ?? anomalies.data?.events[0]?.windowIndex ?? 0);
  }, [anomalies.isSuccess, anomalies.data]);
  const selectedEvent = events.find((e) => e.windowIndex === selected);

  if (!valid) return <ErrorBanner error={new ApiError(404, "Flight not found.")} />;
  if (flight.isPending) return <Loading />;
  if (flight.isError) return <ErrorBanner error={flight.error} />;
  const f = flight.data.flight;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{f.externalFlightReference}</h1>
          <div className="row" style={{ marginTop: 8, flexWrap: "wrap" }}>
            {f.datasetId && <Badge>{f.datasetId}</Badge>}
            <Badge>{f.nWindows} windows</Badge>
            <span className="muted" style={{ fontSize: 12.5 }}>Uploaded {formatDateTime(f.createdAt)} · ID #{f.id}</span>
          </div>
        </div>
        <div className="page-actions">
          <ConfirmButton label="Delete" confirmLabel="Confirm delete" icon={<IconTrash size={15} />}
            onConfirm={() => remove.mutate()} disabled={remove.isPending} />
          <button className="btn btn-primary" onClick={() => start.mutate()} disabled={start.isPending || running}>
            <IconPlay size={14} />{running ? "Analysis running…" : anomalies.data ? "Re-run analysis" : "Run analysis"}
          </button>
        </div>
      </div>

      <div className="stack">
        <ErrorBanner error={start.error ?? remove.error} />
        {running && (
          <InfoBanner>
            Analysis #{latestRun?.id} is {latestRun?.status === "PENDING" ? "queued" : "running"}: scoring {f.nWindows} windows
            with the model in service. Results appear here automatically.
          </InfoBanner>
        )}
        {latestRun?.status === "FAILED" && (
          <div className="banner banner-error" role="alert">
            <span>Analysis #{latestRun.id} failed: {latestRun.error ?? "unknown error"}</span>
          </div>
        )}

        <div className="grid grid-main-side">
          <ChartCard
            title="Anomaly score by window"
            subtitle={anomalies.data
              ? `Analysis #${anomalies.data.analysisId} · ${anomalies.data.modelName} ${anomalies.data.modelVersion} · ${anomalies.data.nAboveThreshold} of ${anomalies.data.nWindows} windows above threshold · select a bar to inspect`
              : "Run an analysis to score every window"}
            chart={anomalies.isPending ? <Loading /> : anomalies.data
              ? <ScoreTimeline events={events} threshold={anomalies.data.threshold} selected={selected ?? undefined} onSelect={setSelected} />
              : <Empty title="No completed analysis">Select “Run analysis” to score this flight.</Empty>}
            table={<EventsTable events={events} selected={selected} onSelect={setSelected} />}
          />
          <WindowPanel event={selectedEvent} windowIndex={selected} hasAnalysis={!!anomalies.data} />
        </div>

        <TelemetryCard flightId={id} windows={flight.data.windows.map((w) => w.windowIndex)}
          windowIndex={selected ?? 0} onWindow={setSelected} />

        <Card title="Analysis history" subtitle="Every analysis run for this flight" flush>
          {analyses.isPending && <Loading />}
          {analyses.data && analyses.data.length === 0 && <Empty title="No analyses yet" />}
          {analyses.data && analyses.data.length > 0 && (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Analysis</th><th>Status</th><th>Model</th><th>Started</th><th>Completed</th><th className="right">Above threshold</th><th className="right">Max score</th></tr></thead>
                <tbody>
                  {analyses.data.map((a) => (
                    <tr key={a.id}>
                      <td className="num">#{a.id}</td>
                      <td><StatusBadge status={a.status} /></td>
                      <td className="secondary">{a.modelName ? `${a.modelName} ${a.modelVersion}` : "—"}</td>
                      <td className="secondary">{formatDateTime(a.startedAt)}</td>
                      <td className="secondary">{formatDateTime(a.completedAt)}</td>
                      <td className="right">{a.metrics.n_above_threshold ?? "—"}{a.metrics.n_windows ? ` / ${a.metrics.n_windows}` : ""}</td>
                      <td className="right">{formatScore(a.metrics.max_score)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

function EventsTable({ events, selected, onSelect }: { events: AnomalyEvent[]; selected: number | null; onSelect: (w: number) => void }) {
  if (events.length === 0) return <Empty title="No scored windows" />;
  return (
    <table className="data">
      <thead><tr><th>Window</th><th>Time (s)</th><th className="right">Score</th><th className="right">Threshold</th><th>Status</th><th>Strongest evidence</th></tr></thead>
      <tbody>
        {events.map((e) => {
          const top = e.evidence.supporting_features?.[0];
          return (
            <tr key={e.windowIndex} className={`clickable ${selected === e.windowIndex ? "selected" : ""}`} onClick={() => onSelect(e.windowIndex)}>
              <td className="num">{e.windowIndex}</td>
              <td className="num secondary">{e.windowStartSeconds}–{e.windowEndSeconds}</td>
              <td className="right">{formatScore(e.anomalyScore)}</td>
              <td className="right">{formatScore(e.threshold)}</td>
              <td><ThresholdBadge above={e.isAnomaly} /></td>
              <td className="secondary">{top ? `${formatFeature(top.feature)} · ${top.statistic}` : "—"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

const FLAG_LABELS: Record<string, string> = {
  pressure_invalid: "Total pressure invalid",
  flap_jump: "Flap position glitch",
  heading_out_of_range: "Heading out of range",
  course_mismatch: "Course / heading mismatch",
  vert_accel_spike_count: "Vertical-acceleration spikes",
};

function WindowPanel({ event, windowIndex, hasAnalysis }: { event?: AnomalyEvent; windowIndex: number | null; hasAnalysis: boolean }) {
  if (!hasAnalysis || !event) {
    return (
      <Card title={windowIndex === null ? "Window details" : `Window ${windowIndex}`} subtitle="Evidence for the selected window">
        <Empty title="Not analysed">Scores and evidence appear after an analysis completes.</Empty>
      </Card>
    );
  }
  const flags = Object.entries(event.evidence.quality_flags ?? {}).filter(([, v]) => v === true || (typeof v === "number" && v > 0));
  const comps = event.evidence.score_components;
  return (
    <Card title={`Window ${event.windowIndex}`} subtitle={`Seconds ${event.windowStartSeconds}–${event.windowEndSeconds} of the flight`}>
      <div className="stack" style={{ gap: 14 }}>
        <div className="spread">
          <div>
            <div className="stat-label">Anomaly score</div>
            <div className="stat-value" style={{ fontSize: 26 }}>{formatScore(event.anomalyScore)}</div>
            <div className="stat-note num">Threshold {formatScore(event.threshold)}</div>
          </div>
          <ThresholdBadge above={event.isAnomaly} />
        </div>

        {comps && (
          <dl className="kv">
            <dt>Forest percentile</dt><dd className="num">{formatScore(comps.forest_percentile)}</dd>
            <dt>Tail-rule percentile</dt><dd className="num">{formatScore(comps.tail_percentile)}</dd>
          </dl>
        )}

        <div>
          <h3 style={{ marginBottom: 6 }}>Most unusual signals</h3>
          <table className="data" style={{ fontSize: 12.5 }}>
            <thead><tr><th style={{ paddingLeft: 0 }}>Signal</th><th className="right">Value</th><th className="right">z</th><th className="right">Tail p</th></tr></thead>
            <tbody>
              {(event.evidence.supporting_features ?? []).map((s) => (
                <tr key={`${s.feature}-${s.statistic}`}>
                  <td style={{ paddingLeft: 0 }}>
                    <div style={{ fontWeight: 500 }}>{formatFeature(s.feature)}</div>
                    <div className="muted" style={{ fontSize: 11.5 }}>{s.statistic}{s.unit ? ` · ${s.unit}` : ""}</div>
                  </td>
                  <td className="right">{s.observed_value !== undefined ? Number(s.observed_value.toPrecision(5)) : "—"}</td>
                  <td className="right">{s.z_score_vs_nominal_training !== undefined ? s.z_score_vs_nominal_training.toFixed(1) : "—"}</td>
                  <td className="right">{formatProbability(s.tail_probability_vs_nominal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint" style={{ marginTop: 6 }}>
            Rarity relative to nominal training approaches (z-score and two-sided tail probability). Not a cause.
          </p>
        </div>

        <div>
          <h3 style={{ marginBottom: 6 }}>Data-quality flags</h3>
          {flags.length === 0 ? <span className="muted">None raised</span> : (
            <div className="chips">
              {flags.map(([k, v]) => <Badge key={k} tone="warning">{FLAG_LABELS[k] ?? k}{typeof v === "number" ? ` (${v})` : ""}</Badge>)}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function TelemetryCard({ flightId, windows, windowIndex, onWindow }: {
  flightId: number; windows: number[]; windowIndex: number; onWindow: (w: number) => void;
}) {
  const [vars, setVars] = useState<Variable[]>(DEFAULT_VARIABLES);
  const telemetry = useQuery({
    queryKey: ["telemetry", flightId, windowIndex],
    queryFn: () => endpoints.telemetry(flightId, windowIndex),
    staleTime: Infinity,
  });
  const toggle = (v: Variable) =>
    setVars((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : cur.length >= MAX_SELECTED ? cur : [...cur, v]));
  const rows = useMemo(() => Array.from({ length: 160 }, (_, t) => t), []);

  return (
    <ChartCard
      title="Telemetry"
      subtitle={`Window ${windowIndex} · one chart per signal (units differ) · up to ${MAX_SELECTED} signals`}
      controls={
        <div className="stack" style={{ gap: 10 }}>
          <div className="row">
            <label htmlFor="window-select" className="secondary" style={{ fontSize: 12.5 }}>Window</label>
            <select id="window-select" className="select" value={windowIndex} onChange={(e) => onWindow(Number(e.target.value))}>
              {windows.map((w) => <option key={w} value={w}>Window {w}</option>)}
            </select>
          </div>
          <div className="chips" role="group" aria-label="Signals">
            {VARIABLES.map((v) => (
              <button key={v} type="button" className="chip" aria-pressed={vars.includes(v)} onClick={() => toggle(v)}
                disabled={!vars.includes(v) && vars.length >= MAX_SELECTED}>
                {VARIABLE_INFO[v].label}
              </button>
            ))}
          </div>
        </div>
      }
      chart={
        telemetry.isPending ? <Loading /> : telemetry.isError ? <ErrorBanner error={telemetry.error} /> :
          vars.length === 0 ? <Empty title="No signals selected" /> : (
            <div className="small-multiples">
              {vars.map((v) => (
                <div key={v}>
                  <div className="multiple-title"><strong>{VARIABLE_INFO[v].label}</strong><span>{VARIABLE_INFO[v].unit}</span></div>
                  <TelemetryLine values={telemetry.data.telemetry[v] ?? []} label={VARIABLE_INFO[v].label} unit={VARIABLE_INFO[v].unit} />
                </div>
              ))}
            </div>
          )
      }
      table={telemetry.data ? (
        <table className="data">
          <thead><tr><th>Second</th>{vars.map((v) => <th key={v} className="right">{VARIABLE_INFO[v].label} ({VARIABLE_INFO[v].unit})</th>)}</tr></thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t}><td className="num">{t}</td>{vars.map((v) => <td key={v} className="right">{telemetry.data.telemetry[v]?.[t]?.toPrecision(6) ?? "—"}</td>)}</tr>
            ))}
          </tbody>
        </table>
      ) : <Loading />}
      footer="* Aileron encoding is unclear in the source documentation; values are shown as recorded."
    />
  );
}
