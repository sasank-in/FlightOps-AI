import { useEffect, useRef, useState, type ReactNode } from "react";

import type { AnalysisStatus } from "../api/types";
import { ApiError } from "../api/client";
import { IconAlert, IconCheck, IconClock, IconInfo, IconX } from "./Icons";

export function Card({ title, subtitle, actions, children, footer, flush, className }: {
  title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode;
  footer?: ReactNode; flush?: boolean; className?: string;
}) {
  return (
    <section className={`card ${className ?? ""}`}>
      {(title || actions) && (
        <div className="card-head">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p>{subtitle}</p>}
          </div>
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      <div className={`card-body ${flush ? "flush" : ""}`}>{children}</div>
      {footer && <div className="card-foot">{footer}</div>}
    </section>
  );
}

/** Stat tile: label, value (proportional figures), optional note. */
export function StatTile({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <section className="card stat" aria-label={label}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {note && <div className="stat-note">{note}</div>}
    </section>
  );
}

const STATUS: Record<AnalysisStatus, { cls: string; label: string; icon: ReactNode }> = {
  COMPLETED: { cls: "badge-good", label: "Completed", icon: <IconCheck size={13} /> },
  RUNNING: { cls: "badge-info", label: "Running", icon: <IconClock size={13} /> },
  PENDING: { cls: "badge-info", label: "Queued", icon: <IconClock size={13} /> },
  FAILED: { cls: "badge-critical", label: "Failed", icon: <IconX size={13} /> },
};

export function StatusBadge({ status }: { status: AnalysisStatus }) {
  const s = STATUS[status];
  return <span className={`badge ${s.cls}`}>{s.icon}{s.label}</span>;
}

/** Above / below model threshold. Always icon + label: never colour alone. */
export function ThresholdBadge({ above }: { above: boolean }) {
  return above ? (
    <span className="badge badge-critical"><IconAlert size={13} />Above threshold</span>
  ) : (
    <span className="badge"><IconCheck size={13} />Below threshold</span>
  );
}

export function Badge({ children, tone }: { children: ReactNode; tone?: "info" | "good" | "warning" | "critical" }) {
  return <span className={`badge ${tone ? `badge-${tone}` : ""}`}>{children}</span>;
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return <div className="loading" role="status"><span className="spinner" aria-hidden="true" />{label}</div>;
}

export function ErrorBanner({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof ApiError ? error.message : "Something went wrong. Please try again.";
  return <div className="banner banner-error" role="alert"><IconAlert size={16} /><span>{msg}</span></div>;
}

export function InfoBanner({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warn" }) {
  return <div className={`banner banner-${tone}`}><IconInfo size={16} /><span>{children}</span></div>;
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action && <div className="mt-16">{action}</div>}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Pager({ page, totalPages, totalItems, onPage }: {
  page: number; totalPages: number; totalItems: number; onPage: (p: number) => void;
}) {
  return (
    <div className="pager">
      <span className="num">{totalItems.toLocaleString()} total</span>
      <div className="row">
        <button className="btn btn-sm" disabled={page <= 0} onClick={() => onPage(page - 1)}>Previous</button>
        <span className="num">Page {totalPages === 0 ? 0 : page + 1} of {totalPages}</span>
        <button className="btn btn-sm" disabled={page + 1 >= totalPages} onClick={() => onPage(page + 1)}>Next</button>
      </div>
    </div>
  );
}

/** Accessible modal dialog: focus moves in on open, Escape closes, focus returns on close. */
export function Dialog({ title, onClose, children, footer }: {
  title: string; onClose: () => void; children: ReactNode; footer: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("input, button, select")?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); previous?.focus(); };
  }, [onClose]);
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title" ref={ref}>
        <div className="dialog-head"><h2 id="dialog-title">{title}</h2></div>
        <div className="dialog-body">{children}</div>
        <div className="dialog-foot">{footer}</div>
      </div>
    </div>
  );
}

/** Two-step confirm button for destructive actions. */
export function ConfirmButton({ label, confirmLabel, onConfirm, disabled, icon }: {
  label: string; confirmLabel: string; onConfirm: () => void; disabled?: boolean; icon?: ReactNode;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(t);
  }, [armed]);
  return (
    <button className="btn btn-danger" disabled={disabled}
      onClick={() => (armed ? (setArmed(false), onConfirm()) : setArmed(true))}>
      {icon}{armed ? confirmLabel : label}
    </button>
  );
}
