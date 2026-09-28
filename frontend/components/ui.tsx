"use client";

import { useEffect, type ReactNode } from "react";
import type { Tone } from "@/lib/format";

export function Badge({ tone = "gray", children, plain }: { tone?: Tone; children: ReactNode; plain?: boolean }) {
  return <span className={`badge ${tone}${plain ? " plain" : ""}`}>{children}</span>;
}

export function StatusBadge({ map, status }: { map: Record<string, { label: string; tone: Tone }>; status: string }) {
  const s = map[status] ?? { label: status, tone: "gray" as Tone };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export function Card({ title, children, className = "", actions }: { title?: ReactNode; children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="row between" style={{ marginBottom: 12 }}>
          {title ? <div className="card-title" style={{ margin: 0 }}>{title}</div> : <span />}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, tone, hint }: { label: string; value: ReactNode; tone?: Tone; hint?: ReactNode }) {
  return (
    <div className="card">
      <div className="card-title">{label}</div>
      <div className={`stat-value ${tone ? `tone-${tone}` : ""}`}>{value}</div>
      {hint && <div className="small muted">{hint}</div>}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div style={{ textAlign: "center", padding: "36px 12px" }}>
      <h3>{title}</h3>
      {children && <div className="muted">{children}</div>}
    </div>
  );
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="muted small row" role="status" aria-live="polite">
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="3" opacity="0.25" />
        <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3">
          <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite" />
        </path>
      </svg>
      {label}
    </div>
  );
}

export function ErrorNote({ error }: { error: { message: string } | null | undefined }) {
  if (!error) return null;
  return <div className="notice err" role="alert">{error.message}</div>;
}

export function Modal({ open, onClose, children, label }: { open: boolean; onClose(): void; children: ReactNode; label: string }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </div>
  );
}

export function Drawer({ open, onClose, children, label }: { open: boolean; onClose(): void; children: ReactNode; label: string }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="overlay drawer-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </aside>
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange(v: T): void; tabs: Array<{ id: T; label: ReactNode }> }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} className={value === t.id ? "active" : ""} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="row between" style={{ marginBottom: 22, alignItems: "flex-end" }}>
      <div>
        <h1>{title}</h1>
        {subtitle && <div className="muted">{subtitle}</div>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}
