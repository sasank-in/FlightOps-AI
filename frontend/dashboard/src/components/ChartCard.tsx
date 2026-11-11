import { useState, type ReactNode } from "react";

import { Segmented } from "./ui";

/**
 * Card holding a chart and its table-view twin (every chart's values are reachable without
 * hovering or reading colour). The filter/controls row sits above the chart.
 */
export function ChartCard({ title, subtitle, controls, chart, table, footer }: {
  title: string;
  subtitle?: ReactNode;
  controls?: ReactNode;
  chart: ReactNode;
  table: ReactNode;
  footer?: ReactNode;
}) {
  const [view, setView] = useState<"chart" | "table">("chart");
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <Segmented label={`${title} view`} value={view} onChange={setView}
          options={[{ value: "chart", label: "Chart" }, { value: "table", label: "Table" }]} />
      </div>
      {controls && <div className="card-body" style={{ paddingTop: 0, paddingBottom: 12 }}>{controls}</div>}
      <div className={`card-body ${view === "table" ? "flush" : ""}`}>
        {view === "chart" ? chart : <div className="table-wrap">{table}</div>}
      </div>
      {footer && <div className="card-foot">{footer}</div>}
    </section>
  );
}
