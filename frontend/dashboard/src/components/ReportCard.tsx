import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { ApiError } from "../api/client";
import { endpoints } from "../api/endpoints";
import type { FindingBasis, Report, ReportEvidence } from "../api/types";
import { IconDownload, IconReport } from "./Icons";
import { useToast } from "./toast";
import { Badge, Card, Empty, ErrorBanner, InfoBanner, Loading, StatusBadge } from "./ui";
import { formatDateTime } from "../lib/format";

const BASIS: Record<FindingBasis, { label: string; tone?: "info" | "warning"; title: string }> = {
  measured: { label: "Measured", tone: "info", title: "A recorded telemetry value or time" },
  model_output: { label: "Model output", title: "A statistical output of the model: scores, thresholds, z-scores" },
  interpretation: { label: "Interpretation", tone: "warning", title: "A hedged reading of the evidence, not a measurement" },
};

const inProgress = (r?: { status: string } | null) => r?.status === "PENDING" || r?.status === "RUNNING";

/**
 * Evidence-grounded engineering report for the flight's latest completed analysis (Phase 7).
 * Window refs in findings select that window on the page.
 */
export function ReportCard({ flightId, analysisId, onSelectWindow }: {
  flightId: number; analysisId: number | null; onSelectWindow: (w: number) => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const list = useQuery({ queryKey: ["reports", flightId], queryFn: () => endpoints.reports(flightId) });
  const latest = list.data?.[0];
  // The report just requested is shown at once, even before the list has been refetched
  const [createdId, setCreatedId] = useState<number | null>(null);
  const currentId = Math.max(latest?.id ?? 0, createdId ?? 0) || null;
  const report = useQuery({
    queryKey: ["report", currentId],
    queryFn: () => endpoints.report(currentId!),
    enabled: currentId !== null,
    refetchInterval: (q) => (inProgress(q.state.data) ? 1500 : false),
  });

  // announce a report finishing while the page is open, and refresh the list's status
  const [watching, setWatching] = useState<number | null>(null);
  const r = report.data;
  useEffect(() => {
    if (!r) return;
    if (inProgress(r)) setWatching(r.id);
    else if (watching === r.id) {
      setWatching(null);
      toast(r.status === "COMPLETED" ? `Report #${r.id} ready` : `Report #${r.id} failed`, r.status === "COMPLETED" ? "success" : "error");
      void queryClient.invalidateQueries({ queryKey: ["reports", flightId] });
    }
  }, [r, watching, toast, queryClient, flightId]);

  const create = useMutation({
    mutationFn: () => endpoints.createReport(analysisId!),
    onSuccess: (created) => {
      queryClient.setQueryData(["report", created.id], created);
      setCreatedId(created.id);
      void queryClient.invalidateQueries({ queryKey: ["reports", flightId] });
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : "Could not start the report", "error"),
  });

  const download = useMutation({
    mutationFn: (id: number) => endpoints.reportMarkdown(id),
    onSuccess: (md, id) => {
      const url = URL.createObjectURL(new Blob([md], { type: "text/markdown;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `flightops-report-${id}.md`;
      a.click();
      URL.revokeObjectURL(url);
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : "Could not download the report", "error"),
  });

  const busy = create.isPending || inProgress(r);
  const stale = r && analysisId !== null && r.analysisId !== analysisId;
  const actions = (
    <>
      {r?.status === "COMPLETED" && (
        <button className="btn" onClick={() => download.mutate(r.id)} disabled={download.isPending}>
          <IconDownload size={16} />Markdown
        </button>
      )}
      <button className="btn btn-primary" onClick={() => create.mutate()} disabled={busy || analysisId === null}
        title={analysisId === null ? "Run an analysis first" : undefined}>
        <IconReport size={16} />{busy ? "Writing report…" : r ? "New report" : "Generate report"}
      </button>
    </>
  );

  return (
    <Card title="Engineering report" subtitle="Evidence-grounded summary of the latest completed analysis" actions={actions}>
      {list.isPending && <Loading />}
      {list.isError && <ErrorBanner error={list.error} />}
      {list.isSuccess && currentId === null && (
        <Empty title="No report yet" icon={<IconReport size={20} />}>
          {analysisId === null
            ? "Run an analysis first. A report summarises a completed analysis."
            : "Generate a report: every statement cites the analysis evidence it is based on, and statements that cannot be traced to the evidence are removed."}
        </Empty>
      )}
      {currentId !== null && report.isPending && <Loading />}
      {report.isError && <ErrorBanner error={report.error} />}
      {r && inProgress(r) && <Loading label={`Writing report #${r.id}: collecting evidence and checking every statement…`} />}
      {r?.status === "FAILED" && (
        <div className="banner banner-error" role="alert"><span>Report #{r.id} failed: {r.error ?? "unknown error"}</span></div>
      )}
      {r?.status === "COMPLETED" && r.content && r.evidence && (
        <ReportBody report={r} stale={!!stale} onSelectWindow={onSelectWindow} />
      )}
    </Card>
  );
}

function ReportBody({ report: r, stale, onSelectWindow }: { report: Report; stale: boolean; onSelectWindow: (w: number) => void }) {
  const c = r.content!;
  const ev = r.evidence!;
  return (
    <div className="report">
      <div className="report-meta">
        <StatusBadge status={r.status} />
        <span>Report #{r.id} · analysis #{r.analysisId} · {formatDateTime(r.completedAt)}</span>
        {r.generator === "llm"
          ? <Badge tone="info">Written by {r.llmModel}</Badge>
          : <Badge>Template (no language model)</Badge>}
      </div>
      {stale && <InfoBanner tone="warn">This report is for analysis #{r.analysisId}, not the latest analysis. Generate a new report to cover it.</InfoBanner>}
      {r.generator === "deterministic" && r.fallbackReason && (
        <InfoBanner>Written by the deterministic template: {r.fallbackReason}.</InfoBanner>
      )}
      <InfoBanner tone="warn">
        Experimental statistical analysis. Not a confirmed fault or a safety determination; engineering review required.
      </InfoBanner>

      <section aria-labelledby="report-summary">
        <h3 id="report-summary">Summary</h3>
        <p>{c.summary}</p>
      </section>

      <section aria-labelledby="report-findings">
        <h3 id="report-findings">Findings</h3>
        <ul className="findings">
          {c.findings.map((f, i) => (
            <li key={i}>
              <span title={BASIS[f.basis]?.title}><Badge tone={BASIS[f.basis]?.tone}>{BASIS[f.basis]?.label ?? f.basis}</Badge></span>
              <div>
                <p>{f.statement}</p>
                <div className="refs" aria-label="Evidence">
                  {f.evidence.map((ref) => <EvidenceRef key={ref} refId={ref} evidence={ev} onSelectWindow={onSelectWindow} />)}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="report-limits">
        <h3 id="report-limits">Limitations</h3>
        <ul className="limits">{ev.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul>
      </section>

      <p className="hint">
        Figures, tables and limitations come from the stored analysis.
        {r.generator === "llm" && ` The narrative was checked statement by statement against the evidence: ${c.removed.length} removed${c.summaryReplaced ? " and the summary replaced by the template" : ""}.`}
      </p>
      {c.removed.length > 0 && (
        <details className="removed">
          <summary>Statements removed by validation ({c.removed.length})</summary>
          <ul>{c.removed.map((x, i) => <li key={i}><span className="muted">{x.reason}:</span> {x.statement}</li>)}</ul>
        </details>
      )}
    </div>
  );
}

/** A cited ref: windows are buttons that select the window; other refs explain themselves on hover. */
function EvidenceRef({ refId, evidence, onSelectWindow }: { refId: string; evidence: ReportEvidence; onSelectWindow: (w: number) => void }) {
  const w = evidence.windows.find((x) => x.ref === refId);
  if (w) {
    return (
      <button type="button" className="ref" onClick={() => onSelectWindow(w.window_index)}
        title={`Show window ${w.window_index} (seconds ${w.start_seconds}–${w.end_seconds})`}>
        {refId}
      </button>
    );
  }
  const it = evidence.intervals.find((x) => x.ref === refId);
  if (it) {
    return (
      <button type="button" className="ref" onClick={() => onSelectWindow(it.first_window)}
        title={`Interval: windows ${it.first_window}–${it.last_window}, seconds ${it.start_seconds}–${it.end_seconds}`}>
        {refId}
      </button>
    );
  }
  const v = evidence.variables.find((x) => x.ref === refId);
  const title = v ? `${v.feature}: unusual in ${v.n_above_threshold_windows} above-threshold window(s)`
    : refId === "RUN" ? `Analysis #${evidence.analysis.analysis_id} totals`
      : refId === "EVAL" ? "Model evaluation figures" : refId;
  return <span className="ref ref-static" title={title}>{v ? `${refId} · ${v.feature}` : refId}</span>;
}
