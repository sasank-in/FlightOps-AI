import { useQuery } from "@tanstack/react-query";

import { endpoints } from "../api/endpoints";
import { Card, ErrorBanner, InfoBanner, Loading, StatTile } from "../components/ui";
import { formatDateTime, formatScore } from "../lib/format";

export function ModelPage() {
  const model = useQuery({ queryKey: ["model"], queryFn: endpoints.model, staleTime: 300_000, retry: false });
  if (model.isPending) return <Loading />;
  if (model.isError) return <ErrorBanner error={model.error} />;
  const m = model.data;
  const ev = m.evaluation ?? {};

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Model card</h1>
          <p>The anomaly-detection model currently used for new analyses, and how it was evaluated.</p>
        </div>
      </div>

      <div className="grid grid-4">
        <StatTile label="Test PR-AUC" value={formatScore(ev.test_pr_auc)} note="Random baseline ≈ 0.10 (anomaly prevalence)" />
        <StatTile label="Unseen-aircraft PR-AUC" value={formatScore(ev.aircraft_held_out_pr_auc_mean)} note="5-fold, whole aircraft held out" />
        <StatTile label="Precision at threshold" value={formatScore(ev.test_precision)} note="Share of alerts that are labelled anomalies" />
        <StatTile label="Recall at threshold" value={formatScore(ev.test_recall)} note="Share of labelled anomalies alerted" />
      </div>

      <div className="grid grid-main-side mt-16">
        <Card title="Model" subtitle="Identity and decision rule">
          <dl className="kv">
            <dt>Name</dt><dd>{m.model_name}</dd>
            <dt>Version</dt><dd>{m.model_version}</dd>
            <dt>Input set</dt><dd>{m.feature_set_version ?? "—"} ({m.n_features ?? "—"} window features)</dd>
            <dt>Input window</dt><dd>{m.input ? `${m.input.timesteps} s at ${m.input.sampling_hz} Hz, ${m.input.variables.length} signals` : "—"}</dd>
            <dt>Alert threshold</dt><dd className="num">{formatScore(m.threshold, 4)}</dd>
            <dt>Threshold policy</dt><dd>{ev.threshold_policy ?? "—"}</dd>
            <dt>Score direction</dt><dd>{m.score_direction ?? "—"}</dd>
            <dt>Evaluated</dt><dd>{formatDateTime(ev.report_created_at)}</dd>
          </dl>
        </Card>
        <Card title="Interpretation" subtitle="How to read the scores">
          <div className="stack" style={{ gap: 12 }}>
            <p className="secondary">{m.interpretation}</p>
            <InfoBanner tone="warn">
              Detection is strong for late flap settings, moderate for high flight path and weak for high speed.
              Part of the “Speed High” labels are affected by a recording fault on one aircraft.
            </InfoBanner>
          </div>
        </Card>
      </div>

      {m.input && (
        <div className="mt-16">
          <Card title="Input signals" subtitle="Raw telemetry expected for every 160-second window" flush>
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th style={{ width: 56 }}>#</th><th style={{ width: "35%" }}>Signal</th><th>Unit</th></tr></thead>
                <tbody>
                  {m.input.variables.map((v, i) => (
                    <tr key={v}><td className="num muted">{i + 1}</td><td className="mono">{v}</td><td className="secondary">{m.input?.units[v] ?? "—"}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
