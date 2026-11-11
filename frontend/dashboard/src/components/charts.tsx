import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, Line, LineChart, ReferenceArea, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

import type { AnomalyEvent, FlightAlertSummary } from "../api/types";
import { formatScore } from "../lib/format";
import { useTheme } from "../lib/theme";

/*
 * Chart specs (data-viz guidelines): 2px lines, bars <= 24px with 4px rounded data-ends, solid
 * hairline grid, muted axes, one y-axis per chart (variables with different units are small
 * multiples, never dual-axis), legend for >= 2 series, tooltip on hover, table view alongside.
 * Validated palette: series-1 blue, series-2 orange, status critical red (light & dark).
 */

const TICK = { fontSize: 11 } as const;

interface TooltipEntry { name?: string | number; value?: unknown; color?: string; payload?: Record<string, unknown> }
interface TooltipArgs { active?: boolean; payload?: readonly TooltipEntry[]; label?: string | number }

function ChartTooltip({ active, payload, label, title, rows }: TooltipArgs & {
  title: (label: string | number | undefined, payload: readonly TooltipEntry[]) => string;
  rows: (payload: readonly TooltipEntry[]) => { key: string; color?: string; label: string; value: string }[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="tooltip" role="presentation">
      <div className="tooltip-title">{title(label, payload)}</div>
      {rows(payload).map((r) => (
        <div className="tooltip-row" key={r.key}>
          <span className="legend-key">
            {r.color && <span className="legend-line" style={{ background: r.color }} />}
            {r.label}
          </span>
          <span>{r.value}</span>
        </div>
      ))}
    </div>
  );
}

function fmt(v: number): string {
  const a = Math.abs(v);
  if (a >= 1000) return v.toFixed(0);
  if (a >= 100) return v.toFixed(1);
  if (a >= 1) return v.toFixed(2);
  return v.toFixed(3);
}

function tickFmt(v: number): string {
  const a = Math.abs(v);
  if (a >= 10_000) return `${(v / 1000).toFixed(0)}K`;
  if (a >= 100) return v.toFixed(0);
  if (a >= 1) return Number(v.toFixed(1)).toString();
  return Number(v.toFixed(2)).toString();
}

/** One telemetry variable over the 160-second window (a small multiple: single series, no legend). */
export function TelemetryLine({ values, label, unit, height = 150 }: {
  values: number[]; label: string; unit: string; height?: number;
}) {
  const { colors } = useTheme();
  const data = values.map((v, t) => ({ t, v }));
  return (
    <div className="chart" role="img" aria-label={`${label} (${unit}) over 160 seconds`}>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={colors.grid} vertical={false} />
          <XAxis dataKey="t" type="number" domain={[0, 159]} ticks={[0, 40, 80, 120, 159]}
            tick={{ ...TICK, fill: colors.ink }} stroke={colors.axis} tickLine={false} />
          <YAxis width={48} tick={{ ...TICK, fill: colors.ink }} stroke={colors.axis} tickLine={false} axisLine={false}
            tickFormatter={tickFmt} domain={["auto", "auto"]} />
          <Tooltip cursor={{ stroke: colors.axis, strokeWidth: 1 }} isAnimationActive={false}
            content={(p: TooltipArgs) => (
              <ChartTooltip {...p} title={(l) => `t = ${l} s`}
                rows={(pl) => [{ key: "v", color: colors.series1, label, value: `${fmt(Number(pl[0]?.value))} ${unit}` }]} />
            )} />
          <Line type="linear" dataKey="v" stroke={colors.series1} strokeWidth={2} dot={false}
            activeDot={{ r: 4, stroke: colors.surface, strokeWidth: 2 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Two flights, one variable (same unit): one axis. Identity via the legend + tooltip; no end labels,
 * because approach traces converge near touchdown and end labels would collide.
 */
export function CompareLines({ a, b, nameA, nameB, label, unit }: {
  a: number[]; b: number[]; nameA: string; nameB: string; label: string; unit: string;
}) {
  const { colors } = useTheme();
  const data = Array.from({ length: Math.max(a.length, b.length) }, (_, t) => ({ t, a: a[t], b: b[t] }));
  return (
    <div>
      <div className="chart-legend" aria-hidden="true">
        <span className="legend-key"><span className="legend-line" style={{ background: colors.series1 }} />A · {nameA}</span>
        <span className="legend-key"><span className="legend-line" style={{ background: colors.series2 }} />B · {nameB}</span>
      </div>
      <div className="chart" role="img" aria-label={`${label} (${unit}): ${nameA} compared with ${nameB}`}>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid stroke={colors.grid} vertical={false} />
            <XAxis dataKey="t" type="number" domain={[0, 159]} ticks={[0, 20, 40, 60, 80, 100, 120, 140, 159]}
              tick={{ ...TICK, fill: colors.ink }} stroke={colors.axis} tickLine={false}
              label={{ value: "Seconds into window", position: "insideBottom", offset: -2, fontSize: 11, fill: colors.ink }} height={36} />
            <YAxis width={52} tick={{ ...TICK, fill: colors.ink }} stroke={colors.axis} tickLine={false} axisLine={false}
              tickFormatter={tickFmt} domain={["auto", "auto"]} />
            <Tooltip cursor={{ stroke: colors.axis, strokeWidth: 1 }} isAnimationActive={false}
              content={(p: TooltipArgs) => (
                <ChartTooltip {...p} title={(l) => `t = ${l} s`}
                  rows={(pl) => pl.map((e) => ({
                    key: String(e.name), color: e.color, label: e.name === "a" ? "A" : "B",
                    value: `${fmt(Number(e.value))} ${unit}`,
                  }))} />
              )} />
            <Line dataKey="a" name="a" stroke={colors.series1} strokeWidth={2} dot={false} isAnimationActive={false}
              activeDot={{ r: 4, stroke: colors.surface, strokeWidth: 2 }} />
            <Line dataKey="b" name="b" stroke={colors.series2} strokeWidth={2} dot={false} isAnimationActive={false}
              activeDot={{ r: 4, stroke: colors.surface, strokeWidth: 2 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Anomaly score per window with the model threshold; above-threshold windows in the status colour. */
export function ScoreTimeline({ events, threshold, selected, onSelect }: {
  events: AnomalyEvent[]; threshold: number; selected?: number; onSelect?: (windowIndex: number) => void;
}) {
  const { colors } = useTheme();
  const data = events.map((e) => ({ w: e.windowIndex, score: e.anomalyScore, above: e.isAnomaly, start: e.windowStartSeconds }));
  const yMax = Math.max(1, ...data.map((d) => d.score));
  const yMin = Math.min(0, ...data.map((d) => d.score));
  const ticks = Array.from({ length: 5 }, (_, i) => Number((yMin + ((yMax - yMin) * i) / 4).toFixed(3)));
  return (
    <div className="chart-fill">
      <div className="chart-legend" aria-hidden="true">
        <span className="legend-key"><span className="legend-swatch" style={{ background: colors.series1 }} />Below threshold</span>
        <span className="legend-key"><span className="legend-swatch" style={{ background: colors.critical }} />Above threshold (alert)</span>
        <span className="legend-key"><span className="legend-line" style={{ background: colors.ink }} />Threshold {formatScore(threshold)}</span>
      </div>
      <div className="chart" role="img" aria-label={`Anomaly score for ${events.length} windows; threshold ${formatScore(threshold)}`}>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }} barCategoryGap="22%"
            onClick={(state: { activeLabel?: string | number }) => {
              if (onSelect && state?.activeLabel !== undefined) onSelect(Number(state.activeLabel));
            }}>
            <CartesianGrid stroke={colors.grid} vertical={false} />
            <XAxis dataKey="w" tick={{ ...TICK, fill: colors.ink }} stroke={colors.axis} tickLine={false} interval="preserveStartEnd"
              label={{ value: "Window", position: "insideBottom", offset: -2, fontSize: 11, fill: colors.ink }} height={36} />
            <YAxis width={44} domain={[yMin, yMax]} ticks={ticks} tick={{ ...TICK, fill: colors.ink }} stroke={colors.axis}
              tickLine={false} axisLine={false} tickFormatter={(v: number) => v.toFixed(2)} />
            {selected !== undefined && (
              // selection: a recessive band behind the window, so bar colours keep their meaning
              <ReferenceArea x1={selected} x2={selected} fill={colors.grid} fillOpacity={0.9} ifOverflow="visible" />
            )}
            <Tooltip cursor={{ fill: colors.grid, opacity: 0.5 }} isAnimationActive={false}
              content={(p: TooltipArgs) => (
                <ChartTooltip {...p} title={(l, pl) => `Window ${l} · starts at ${String(pl[0]?.payload?.start ?? "")} s`}
                  rows={(pl) => [
                    { key: "s", label: "Anomaly score", value: formatScore(Number(pl[0]?.value)) },
                    { key: "t", label: "Threshold", value: formatScore(threshold) },
                    { key: "a", label: "Status", value: pl[0]?.payload?.above ? "Above threshold" : "Below threshold" },
                  ]} />
              )} />
            <ReferenceLine y={threshold} stroke={colors.ink} strokeWidth={1} ifOverflow="extendDomain" />
            <Bar dataKey="score" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} style={{ cursor: onSelect ? "pointer" : undefined }}>
              {data.map((d) => (
                <Cell key={d.w} fill={d.above ? colors.critical : colors.series1} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Ranked horizontal bars: above-threshold windows per flight (latest completed analysis). */
export function AlertsByFlight({ items, onSelect }: { items: FlightAlertSummary[]; onSelect?: (flightId: number) => void }) {
  const { colors } = useTheme();
  const data = items.map((i) => ({ id: i.flightId, name: i.externalFlightReference, above: i.nAboveThreshold, n: i.nWindows }));
  const height = Math.max(200, data.length * 34 + 40);
  return (
    <div className="chart" role="img" aria-label="Windows above threshold by flight">
      <ResponsiveContainer width="100%" height="100%" minHeight={height}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 40, bottom: 4, left: 0 }} barCategoryGap="30%"
          onClick={(state: { activeIndex?: number | string | null }) => {
            const i = state?.activeIndex;
            const id = i === null || i === undefined ? undefined : data[Number(i)]?.id;
            if (onSelect && id !== undefined) onSelect(id);
          }}>
          <CartesianGrid stroke={colors.grid} horizontal={false} />
          <XAxis type="number" allowDecimals={false} tick={{ ...TICK, fill: colors.ink }} stroke={colors.axis} tickLine={false} />
          <YAxis type="category" dataKey="name" width={170} tick={{ ...TICK, fill: colors.ink }} stroke={colors.axis} tickLine={false}
            tickFormatter={(v: string) => (v.length > 24 ? `${v.slice(0, 23)}…` : v)} />
          <Tooltip cursor={{ fill: colors.grid, opacity: 0.5 }} isAnimationActive={false}
            content={(p: TooltipArgs) => (
              <ChartTooltip {...p} title={(_, pl) => String(pl[0]?.payload?.name ?? "")}
                rows={(pl) => [
                  { key: "a", label: "Above threshold", value: String(pl[0]?.payload?.above ?? "") },
                  { key: "n", label: "Windows scored", value: String(pl[0]?.payload?.n ?? "") },
                ]} />
            )} />
          <Bar dataKey="above" fill={colors.series1} radius={[0, 4, 4, 0]} maxBarSize={20} isAnimationActive={false}
            style={{ cursor: onSelect ? "pointer" : undefined }}>
            <LabelList dataKey="above" position="right" fontSize={11} fill={colors.ink} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
