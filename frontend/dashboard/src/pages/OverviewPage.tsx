import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";

import { endpoints } from "../api/endpoints";
import { ChartCard } from "../components/ChartCard";
import { AlertsByFlight } from "../components/charts";
import { IconUpload } from "../components/Icons";
import { Card, Empty, ErrorBanner, Loading, StatTile, StatusBadge } from "../components/ui";
import { formatCount, formatDateTime, formatPercent, formatScore, timeAgo } from "../lib/format";

export function OverviewPage() {
  const navigate = useNavigate();
  const stats = useQuery({ queryKey: ["stats"], queryFn: endpoints.stats, refetchInterval: 15_000 });
  const model = useQuery({ queryKey: ["model"], queryFn: endpoints.model, staleTime: 300_000, retry: false });

  if (stats.isPending) return <Loading />;
  if (stats.isError) return <ErrorBanner error={stats.error} />;
  const s = stats.data;
  const alertRate = s.windowsScored > 0 ? s.windowsAboveThreshold / s.windowsScored : null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Overview</h1>
          <p>Fleet-level summary of uploaded flights and the latest analysis of each.</p>
        </div>
        <div className="page-actions">
          <Link className="btn btn-primary" to="/flights?upload=1"><IconUpload size={16} />Upload flight</Link>
        </div>
      </div>

      <div className="grid grid-4">
        <StatTile label="Flights" value={formatCount(s.flights)} note={`${formatCount(s.windows)} telemetry windows`} />
        <StatTile label="Windows analysed" value={formatCount(s.windowsScored)}
          note="Latest completed analysis per flight" />
        <StatTile label="Above threshold" value={formatCount(s.windowsAboveThreshold)}
          note={alertRate === null ? "No analyses yet" : `${formatPercent(alertRate)} of analysed windows`} />
        <StatTile label="Analyses completed" value={formatCount(s.analysesCompleted)}
          note={s.lastAnalysisAt
            ? `${s.analysesInProgress} in progress · ${s.analysesFailed} failed · last ${timeAgo(s.lastAnalysisAt)}`
            : "No analyses run yet"} />
      </div>

      <div className="grid grid-main-side equal mt-16">
        <ChartCard
          fill
          title="Windows above threshold by flight"
          subtitle="Latest completed analysis per flight · top 10 · select a bar to open the flight"
          chart={s.flightsByAlerts.length === 0
            ? <Empty title="No analysed flights yet"
                action={<Link className="btn" to={s.flights ? "/flights" : "/flights?upload=1"}>{s.flights ? "Open flights" : "Upload a flight"}</Link>}>
                {s.flights ? "Open a flight and run an analysis to see alerts here." : "Upload a flight, then run an analysis to see alerts here."}
              </Empty>
            : <AlertsByFlight items={s.flightsByAlerts} onSelect={(id) => navigate(`/flights/${id}`)} />}
          table={
            <table className="data">
              <thead><tr><th>Flight</th><th className="right">Above threshold</th><th className="right">Windows scored</th><th className="right">Share</th></tr></thead>
              <tbody>
                {s.flightsByAlerts.map((f) => (
                  <tr key={f.flightId}>
                    <td><Link to={`/flights/${f.flightId}`}>{f.externalFlightReference}</Link></td>
                    <td className="right">{f.nAboveThreshold}</td>
                    <td className="right">{f.nWindows}</td>
                    <td className="right">{formatPercent(f.nWindows ? f.nAboveThreshold / f.nWindows : null)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          }
        />

        <Card title="Model in service" subtitle="Scoring model used for new analyses">
          {model.isPending && <Loading />}
          {model.isError && <ErrorBanner error={model.error} />}
          {model.data && (
            <dl className="kv">
              <dt>Model</dt><dd>{model.data.model_name}</dd>
              <dt>Version</dt><dd>{model.data.model_version}</dd>
              <dt>Input set</dt><dd>{model.data.feature_set_version ?? "—"}</dd>
              <dt>Alert threshold</dt><dd className="num">{formatScore(model.data.threshold)}</dd>
              <dt>Test PR-AUC</dt><dd className="num">{formatScore(model.data.evaluation?.test_pr_auc)}</dd>
              <dt>Unseen aircraft PR-AUC</dt><dd className="num">{formatScore(model.data.evaluation?.aircraft_held_out_pr_auc_mean)}</dd>
            </dl>
          )}
          <div className="mt-16"><Link to="/model">View model card</Link></div>
        </Card>
      </div>

      <div className="mt-16">
        <Card title="Recent analyses" subtitle="Most recent analysis runs across your flights" flush>
          {s.recentAnalyses.length === 0 ? (
            <Empty title="No analyses yet">Analysis runs appear here as soon as one is started.</Empty>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr><th>Analysis</th><th>Flight</th><th>Status</th><th>Started</th><th className="right">Windows</th><th className="right">Above threshold</th></tr>
                </thead>
                <tbody>
                  {s.recentAnalyses.map((a) => (
                    <tr key={a.analysisId} className="clickable" onClick={() => navigate(`/flights/${a.flightId}`)}>
                      <td className="num">#{a.analysisId}</td>
                      <td><Link to={`/flights/${a.flightId}`} onClick={(e) => e.stopPropagation()}>{a.externalFlightReference}</Link></td>
                      <td><StatusBadge status={a.status} /></td>
                      <td className="secondary">{formatDateTime(a.startedAt)}</td>
                      <td className="right">{a.nWindows ?? "—"}</td>
                      <td className="right">{a.nAboveThreshold ?? "—"}</td>
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
