import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { ApiError } from "../api/client";
import { endpoints } from "../api/endpoints";
import type { AnomalyEvent, WindowInfo } from "../api/types";
import { ChartCard } from "../components/ChartCard";
import { ScoreTimeline, TelemetryLine } from "../components/charts";
import { IconPlay, IconTrash } from "../components/Icons";
import {
  Badge, Card, ConfirmButton, Empty, ErrorBanner, InfoBanner, Loading, StatusBadge, ThresholdBadge,
} from "../components/ui";
import { useToast } from "../components/toast";
import { formatClock, formatDateTime, formatProbability, formatScore } from "../lib/format";
import { DEFAULT_VARIABLES, SIGNAL_GROUPS, VARIABLE_INFO, signalLabel, statisticLabel, type Variable } from "../lib/telemetry";

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

  const toast = useToast();
  const start = useMutation({
    mutationFn: () => endpoints.startAnalysis(id),
    onSuccess: (run) => {
      toast(`Analysis #${run.id} started`);
      void queryClient.invalidateQueries({ queryKey: ["analyses", id] });
      void queryClient.invalidateQueries({ queryKey: ["stats"] });
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : "Could not start the analysis", "error"),
  });
  const remove = useMutation({
    mutationFn: () => endpoints.deleteFlight(id),
    onSuccess: () => {
      toast(`Flight ${flight.data?.flight.externalFlightReference ?? `#${id}`} deleted`);
      queryClient.removeQueries({ queryKey: ["flight", id] });
      void queryClient.invalidateQueries({ queryKey: ["flights"] });
      void queryClient.invalidateQueries({ queryKey: ["stats"] });
      navigate("/flights");
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : "Could not delete the flight", "error"),
  });

  // announce completion of a run that was in progress while the page was open
  const [watching, setWatching] = useState<number | null>(null);
  useEffect(() => {
    if (!latestRun) return;
    if (latestRun.status === "PENDING" || latestRun.status === "RUNNING") setWatching(latestRun.id);
    else if (watching === latestRun.id) {
      setWatching(null);
      if (latestRun.status === "COMPLETED") toast(`Analysis #${latestRun.id} completed`);
      else toast(`Analysis #${latestRun.id} failed`, "error");
    }
  }, [latestRun, watching, toast]);

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
          <div className="page-meta">
            {f.datasetId && <Badge>{f.datasetId}</Badge>}
            <Badge>{f.nWindows} windows · {formatClock(f.nWindows * 160)}</Badge>
            <span>Uploaded {formatDateTime(f.createdAt)}</span>
            <span aria-hidden="true">·</span>
            <span>ID #{f.id}</span>
          </div>
        </div>
        <div className="page-actions">
          <ConfirmButton label="Delete" confirmLabel="Confirm delete" icon={<IconTrash size={16} />}
            onConfirm={() => remove.mutate()} disabled={remove.isPending} />
          <button className="btn btn-primary" onClick={() => start.mutate()} disabled={start.isPending || running}>
            <IconPlay size={16} />{running ? "Analysis running…" : anomalies.data ? "Re-run analysis" : "Run analysis"}
          </button>
        </div>
      </div>

      <div className="stack">
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

        <ChartCard
            title="Anomaly score by window"
            subtitle={anomalies.data
              ? `Analysis #${anomalies.data.analysisId} · ${anomalies.data.modelName} ${anomalies.data.modelVersion} · ${anomalies.data.nAboveThreshold} of ${anomalies.data.nWindows} windows above threshold · select a bar to inspect`
              : "Run an analysis to score every window"}
            chart={anomalies.isPending ? <Loading /> : anomalies.data
              ? <ScoreTimeline events={events} threshold={anomalies.data.threshold} selected={selected ?? undefined} onSelect={setSelected} />
              : <Empty title="No completed analysis" icon={<IconPlay size={20} />}>Select “Run analysis” to score every window of this flight.</Empty>}
            table={<EventsTable events={events} selected={selected} onSelect={setSelected} />}
          />

        {/* master/detail: the selected window's evidence beside its telemetry */}
        <div className="grid grid-side-main equal">
          <WindowPanel event={selectedEvent} windowIndex={selected} hasAnalysis={!!anomalies.data} />
          <TelemetryCard flightId={id} windows={flight.data.windows}
            windowIndex={selected ?? 0} onWindow={setSelected} />
        </div>

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
      <thead><tr><th>Window</th><th>Time in flight</th><th className="right">Score</th><th className="right">Threshold</th><th>Status</th><th>Strongest evidence</th></tr></thead>
      <tbody>
        {events.map((e) => {
          const top = e.evidence.supporting_features?.[0];
          const name = top ? signalLabel(top.feature) : null;
          return (
            <tr key={e.windowIndex} className={`clickable ${selected === e.windowIndex ? "selected" : ""}`} onClick={() => onSelect(e.windowIndex)}>
              <td className="num">{e.windowIndex}</td>
              <td className="num secondary">{formatClock(e.windowStartSeconds)}–{formatClock(e.windowEndSeconds + 1)}</td>
              <td className="right">{formatScore(e.anomalyScore)}</td>
              <td className="right">{formatScore(e.threshold)}</td>
              <td><ThresholdBadge above={e.isAnomaly} /></td>
              <td className="secondary">{top && name ? `${name.label} · ${statisticLabel(top.statistic).toLowerCase()}` : "—"}</td>
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
        <Empty title="Not analysed yet">The score, threshold and supporting evidence appear here once an analysis completes.</Empty>
      </Card>
    );
  }
  const flags = Object.entries(event.evidence.quality_flags ?? {}).filter(([, v]) => v === true || (typeof v === "number" && v > 0));
  const comps = event.evidence.score_components;
  // meter scale: hybrid scores are percentiles (0-1); other models get a scale that fits score and threshold
  const scaleMax = Math.max(1, event.anomalyScore, event.threshold);
  const pct = (v: number) => `${Math.min(100, Math.max(0, (v / scaleMax) * 100))}%`;
  return (
    <Card title={`Window ${event.windowIndex}`}
      subtitle={`${formatClock(event.windowStartSeconds)}–${formatClock(event.windowEndSeconds + 1)} into the flight (160 s)`}>
      <div className="stack" style={{ gap: 16 }}>
        <div>
          <div className="spread">
            <div className="stat-label">Anomaly score</div>
            <ThresholdBadge above={event.isAnomaly} />
          </div>
          <div className="stat-value sm">{formatScore(event.anomalyScore)}</div>
          <div className="meter" role="img"
            aria-label={`Score ${formatScore(event.anomalyScore)} against threshold ${formatScore(event.threshold)}`}>
            <div className="meter-track">
              <div className="meter-fill" style={{ width: pct(event.anomalyScore),
                background: event.isAnomaly ? "var(--status-critical)" : "var(--series-1)" }} />
              <div className="meter-mark" style={{ left: `calc(${pct(event.threshold)} - 1px)` }} title="Threshold" />
            </div>
            <div className="meter-scale num"><span>0</span><span>Threshold {formatScore(event.threshold)}</span><span>{formatScore(scaleMax, 1)}</span></div>
          </div>
        </div>

        {comps && (
          <dl className="kv">
            <dt>Isolation Forest percentile</dt><dd className="num">{formatScore(comps.forest_percentile)}</dd>
            <dt>Tail-rule percentile</dt><dd className="num">{formatScore(comps.tail_percentile)}</dd>
          </dl>
        )}

        <div>
          <h3 style={{ marginBottom: 6 }}>Most unusual signals</h3>
          <table className="data" style={{ fontSize: 12.5 }}>
            <thead><tr><th style={{ paddingLeft: 0 }}>Signal</th><th className="right">Value</th><th className="right">z</th><th className="right">Tail p</th></tr></thead>
            <tbody>
              {(event.evidence.supporting_features ?? []).map((s) => {
                const name = signalLabel(s.feature);
                return (
                  <tr key={`${s.feature}-${s.statistic}`}>
                    <td style={{ paddingLeft: 0 }}>
                      <div style={{ fontWeight: 500 }}>{name.label}</div>
                      <div className="muted" style={{ fontSize: 11.5 }}>
                        {statisticLabel(s.statistic)}{name.qualifier ? `, ${name.qualifier}` : ""}
                      </div>
                    </td>
                    <td className="right">
                      {s.observed_value !== undefined ? Number(s.observed_value.toPrecision(5)) : "—"}
                      {s.unit && <div className="muted" style={{ fontSize: 11.5 }}>{s.unit.replace(/\s*\(.*\)$/, "")}</div>}
                    </td>
                    <td className="right">{s.z_score_vs_nominal_training !== undefined ? s.z_score_vs_nominal_training.toFixed(1) : "—"}</td>
                    <td className="right">{formatProbability(s.tail_probability_vs_nominal)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="hint" style={{ marginTop: 6 }}>
            How rare each value is among nominal training approaches (z-score and two-sided tail probability).
            Describes what is unusual, not the cause.
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
  flightId: number; windows: WindowInfo[]; windowIndex: number; onWindow: (w: number) => void;
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
      subtitle={`Window ${windowIndex} · one chart per signal because units differ · up to ${MAX_SELECTED} signals`}
      controls={
        <div className="stack" style={{ gap: 14 }}>
          <div className="toolbar">
            <div className="field">
              <label htmlFor="window-select">Window</label>
              <select id="window-select" className="select" value={windowIndex} onChange={(e) => onWindow(Number(e.target.value))}>
                {windows.map((w) => (
                  <option key={w.windowIndex} value={w.windowIndex}>Window {w.windowIndex} · from {formatClock(w.windowStartSeconds)}</option>
                ))}
              </select>
            </div>
            <span className="hint" style={{ paddingBottom: 8 }}>{vars.length} of {MAX_SELECTED} signals selected</span>
            {vars.length > 0 && <button className="btn btn-sm btn-ghost" style={{ marginBottom: 3 }} onClick={() => setVars([])}>Clear</button>}
            <button className="btn btn-sm btn-ghost" style={{ marginBottom: 3 }} onClick={() => setVars(DEFAULT_VARIABLES)}>Reset</button>
          </div>
          <div className="signal-groups" role="group" aria-label="Signals">
            {SIGNAL_GROUPS.map((g) => (
              <div className="signal-group" key={g.label}>
                <div className="signal-group-label">{g.label}</div>
                <div className="chips">
                  {g.variables.map((v) => (
                    <button key={v} type="button" className="chip" aria-pressed={vars.includes(v)} onClick={() => toggle(v)}
                      disabled={!vars.includes(v) && vars.length >= MAX_SELECTED}>
                      {VARIABLE_INFO[v].label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      }
      chart={
        telemetry.isPending ? <Loading /> : telemetry.isError ? <ErrorBanner error={telemetry.error} /> :
          vars.length === 0 ? <Empty title="No signals selected">Choose up to {MAX_SELECTED} signals above.</Empty> : (
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
