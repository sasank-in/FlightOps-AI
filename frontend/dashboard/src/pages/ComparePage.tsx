import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { ApiError } from "../api/client";
import { endpoints } from "../api/endpoints";
import type { Anomalies } from "../api/types";
import { ChartCard } from "../components/ChartCard";
import { CompareLines } from "../components/charts";
import { IconCompare, IconUpload } from "../components/Icons";
import { Card, Empty, ErrorBanner, Loading, ThresholdBadge } from "../components/ui";
import { formatClock, formatScore } from "../lib/format";
import { useTheme } from "../lib/theme";
import { SIGNAL_GROUPS, VARIABLE_INFO, type Variable } from "../lib/telemetry";

interface Side { flightId: number | null; window: number }

async function anomaliesOrNull(id: number): Promise<Anomalies | null> {
  try {
    return await endpoints.anomalies(id);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

function useSide(side: Side) {
  const detail = useQuery({ queryKey: ["flight", side.flightId], queryFn: () => endpoints.flight(side.flightId!), enabled: side.flightId !== null });
  const telemetry = useQuery({
    queryKey: ["telemetry", side.flightId, side.window],
    queryFn: () => endpoints.telemetry(side.flightId!, side.window),
    enabled: side.flightId !== null,
    staleTime: Infinity,
  });
  const anomalies = useQuery({ queryKey: ["anomalies-latest", side.flightId], queryFn: () => anomaliesOrNull(side.flightId!), enabled: side.flightId !== null });
  return { detail, telemetry, anomalies };
}

export function ComparePage() {
  const flights = useQuery({ queryKey: ["flights", "all"], queryFn: () => endpoints.flights(0, 100) });
  const [a, setA] = useState<Side>({ flightId: null, window: 0 });
  const [b, setB] = useState<Side>({ flightId: null, window: 0 });
  const [variable, setVariable] = useState<Variable>("airspeed");

  useEffect(() => {
    const items = flights.data?.items ?? [];
    if (items.length && a.flightId === null) setA({ flightId: items[0]!.id, window: 0 });
    if (items.length && b.flightId === null) setB({ flightId: (items[1] ?? items[0])!.id, window: items[1] ? 0 : Math.min(1, items[0]!.nWindows - 1) });
  }, [flights.data, a.flightId, b.flightId]);

  const sa = useSide(a);
  const sb = useSide(b);
  const { colors } = useTheme();

  const head = (
    <div className="page-head">
      <div>
        <h1>Compare flights</h1>
        <p>Overlay one signal from two windows on a common time axis, alongside their anomaly scores.</p>
      </div>
    </div>
  );
  if (flights.isPending) return <>{head}<Loading /></>;
  if (flights.isError) return <>{head}<ErrorBanner error={flights.error} /></>;
  if (flights.data.items.length === 0) {
    return (
      <>
        {head}
        <Card>
          <Empty title="No flights to compare" icon={<IconCompare size={20} />}
            action={<Link className="btn btn-primary" to="/flights?upload=1"><IconUpload size={16} />Upload a flight</Link>}>
            Upload at least one flight. You can compare two windows of the same flight or of different flights.
          </Empty>
        </Card>
      </>
    );
  }

  const info = VARIABLE_INFO[variable];
  const name = (side: Side, d: typeof sa) => `${d.detail.data?.flight.externalFlightReference ?? `#${side.flightId}`} · w${side.window}`;
  const va = sa.telemetry.data?.telemetry[variable];
  const vb = sb.telemetry.data?.telemetry[variable];

  const sidePicker = (label: string, side: Side, set: (s: Side) => void, d: typeof sa, color: string) => (
    <div className="series-group" role="group" aria-labelledby={`series-${label}`}>
      <div className="series-head" id={`series-${label}`}>
        <span className="legend-line" style={{ background: color }} aria-hidden="true" />Series {label}
      </div>
      <div className="field-pair">
        <select className="select" aria-label={`Series ${label} flight`} value={side.flightId ?? ""}
          onChange={(e) => set({ flightId: Number(e.target.value), window: 0 })}>
          {flights.data.items.map((f) => <option key={f.id} value={f.id}>{f.externalFlightReference}</option>)}
        </select>
        <select className="select" aria-label={`Series ${label} window`} value={side.window}
          onChange={(e) => set({ ...side, window: Number(e.target.value) })}>
          {(d.detail.data?.windows ?? [{ windowIndex: 0, windowStartSeconds: 0 }]).map((w) => (
            <option key={w.windowIndex} value={w.windowIndex}>Window {w.windowIndex} · {formatClock(w.windowStartSeconds)}</option>
          ))}
        </select>
      </div>
    </div>
  );

  const scoreOf = (side: Side, d: typeof sa) => d.anomalies.data?.events.find((e) => e.windowIndex === side.window);

  return (
    <>
      {head}
      <div className="stack">
        <ChartCard
          title={`${info.label} (${info.unit})`}
          subtitle="Seconds into each 160-second window"
          controls={
            <div className="compare-toolbar">
              <div className="series-group">
                <label className="series-head" htmlFor="cmp-var">Signal</label>
                <select id="cmp-var" className="select" value={variable} onChange={(e) => setVariable(e.target.value as Variable)}>
                  {SIGNAL_GROUPS.map((g) => (
                    <optgroup key={g.label} label={g.label}>
                      {g.variables.map((v) => <option key={v} value={v}>{VARIABLE_INFO[v].label}</option>)}
                    </optgroup>
                  ))}
                </select>
              </div>
              {sidePicker("A", a, setA, sa, colors.series1)}
              {sidePicker("B", b, setB, sb, colors.series2)}
            </div>
          }
          chart={(sa.telemetry.isPending || sb.telemetry.isPending) ? <Loading /> :
            (sa.telemetry.isError || sb.telemetry.isError) ? <ErrorBanner error={sa.telemetry.error ?? sb.telemetry.error} /> :
              <CompareLines a={va ?? []} b={vb ?? []} nameA={name(a, sa)} nameB={name(b, sb)} label={info.label} unit={info.unit} />}
          table={
            <table className="data">
              <thead><tr><th>Second</th><th className="right">A · {name(a, sa)}</th><th className="right">B · {name(b, sb)}</th><th className="right">B − A</th></tr></thead>
              <tbody>
                {Array.from({ length: 160 }, (_, t) => (
                  <tr key={t}>
                    <td className="num">{t}</td>
                    <td className="right">{va?.[t]?.toPrecision(6) ?? "—"}</td>
                    <td className="right">{vb?.[t]?.toPrecision(6) ?? "—"}</td>
                    <td className="right">{va?.[t] !== undefined && vb?.[t] !== undefined ? (vb[t]! - va[t]!).toPrecision(4) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          }
        />

        <Card title="Anomaly scores" subtitle="Latest completed analysis of each flight" flush>
          <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Series</th><th>Flight · window</th><th className="right">Score</th><th className="right">Threshold</th><th>Status</th></tr></thead>
            <tbody>
              {([["A", a, sa], ["B", b, sb]] as const).map(([label, side, d]) => {
                const e = scoreOf(side, d);
                return (
                  <tr key={label}>
                    <td style={{ fontWeight: 600 }}>
                      <span className="legend-key">
                        <span className="legend-line" style={{ background: label === "A" ? colors.series1 : colors.series2 }} aria-hidden="true" />{label}
                      </span>
                    </td>
                    <td>{side.flightId !== null ? <Link to={`/flights/${side.flightId}`}>{name(side, d)}</Link> : "—"}</td>
                    <td className="right">{e ? formatScore(e.anomalyScore) : "—"}</td>
                    <td className="right">{e ? formatScore(e.threshold) : "—"}</td>
                    <td>{e ? <ThresholdBadge above={e.isAnomaly} /> : <span className="muted">Not analysed</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </Card>
      </div>
    </>
  );
}
