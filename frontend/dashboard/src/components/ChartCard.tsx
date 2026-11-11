import { useState, type ReactNode } from "react";

import { Segmented } from "./ui";

/**
 * Card holding a chart and its table-view twin (every chart's values are reachable without
 * hovering or reading colour). Controls sit in one row above the chart. With `fill`, the chart
 * grows to the card's height when the card is stretched beside a taller neighbour.
 */
export function ChartCard({ title, subtitle, controls, chart, table, footer, fill }: {
  title: string;
  subtitle?: ReactNode;
  controls?: ReactNode;
  chart: ReactNode;
  table: ReactNode;
  footer?: ReactNode;
  fill?: boolean;
}) {
  const [view, setView] = useState<"chart" | "table">("chart");
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <Segmented label={`${title}: view as`} value={view} onChange={setView}
          options={[{ value: "chart", label: "Chart" }, { value: "table", label: "Table" }]} />
      </div>
      {controls && <div className="card-body" style={{ paddingTop: 0, paddingBottom: 14 }}>{controls}</div>}
      {view === "chart" ? (
        <div className={`card-body ${fill ? "grow" : ""}`}>{chart}</div>
      ) : (
        <div className="card-body flush"><div className="table-wrap">{table}</div></div>
      )}
      {footer && <div className="card-foot">{footer}</div>}
    </section>
  );
}
