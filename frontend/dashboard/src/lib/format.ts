const dateTime = new Intl.DateTimeFormat(undefined, {
  year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit",
});
const integer = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : dateTime.format(d);
}

/** 1,284 / 12.9K / 4.2M: compact above 10,000. */
export function formatCount(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  if (Math.abs(n) < 10_000) return integer.format(n);
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function formatScore(n: number | null | undefined, digits = 3): string {
  return n === null || n === undefined || !Number.isFinite(n) ? "—" : n.toFixed(digits);
}

export function formatPercent(n: number | null | undefined, digits = 1): string {
  return n === null || n === undefined || !Number.isFinite(n) ? "—" : `${(n * 100).toFixed(digits)}%`;
}

export function formatProbability(p: number | null | undefined): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return "—";
  return p < 0.001 ? p.toExponential(1) : p.toFixed(3);
}

/** "flap_rel_end" -> "flap (rel. end)"; statistic names are kept short. */
export function formatFeature(feature: string): string {
  return feature.replace("_rel_median", " (rel. median)").replace("_rel_end", " (rel. end)").replaceAll("_", " ");
}

export function timeAgo(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "—";
  const s = Math.round((now.getTime() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
