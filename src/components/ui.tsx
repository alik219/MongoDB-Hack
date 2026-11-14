"use client";

import { ApiError } from "./api";

const STATUS_STYLES: Record<string, string> = {
  proposed: "bg-info-soft text-info",
  active: "bg-accent-soft text-accent",
  superseded: "bg-slate-100 text-slate-500 line-through decoration-slate-400/60",
  expired: "bg-warn-soft text-warn",
  forgotten: "bg-slate-800 text-white",
  rejected: "bg-danger-soft text-danger",
  draft: "bg-info-soft text-info",
  approved: "bg-accent-soft text-accent",
  done: "bg-slate-100 text-slate-600",
  withdrawn: "bg-slate-100 text-slate-500",
  completed: "bg-accent-soft text-accent",
  stale: "bg-warn-soft text-warn",
  failed: "bg-danger-soft text-danger",
};

export function StatusPill({ status }: { status: string }) {
  return <span className={`chip capitalize ${STATUS_STYLES[status] ?? "bg-slate-100 text-slate-600"}`}>{status.replace(/_/g, " ")}</span>;
}

const CATEGORY_STYLES: Record<string, string> = {
  goal: "text-emerald-700 bg-emerald-50",
  constraint: "text-amber-800 bg-amber-50",
  previous_decision: "text-slate-700 bg-slate-100",
  revisit_condition: "text-sky-800 bg-sky-50",
  preference: "text-indigo-700 bg-indigo-50",
  advisor_commitment: "text-teal-800 bg-teal-50",
  life_event: "text-rose-700 bg-rose-50",
};

export function CategoryBadge({ category }: { category: string }) {
  return (
    <span className={`chip capitalize ${CATEGORY_STYLES[category] ?? "bg-slate-100 text-slate-600"}`}>
      {category.replace(/_/g, " ")}
    </span>
  );
}

export function RestrictedBadge({ names }: { names?: string }) {
  return (
    <span className="chip bg-restricted-soft text-restricted" title={names ? `Visible to: ${names}` : undefined}>
      <LockIcon /> Restricted
    </span>
  );
}

export function BasisBadge({ basis }: { basis: string }) {
  return basis === "advisor_confirmed" ? (
    <span className="chip bg-white border border-accent/30 text-accent" title="An authorized advisor confirmed this statement">
      ✓ Advisor-confirmed
    </span>
  ) : (
    <span
      className="chip bg-white border border-info/30 text-info"
      title="Found in a source document. Not yet confirmed by an advisor, so not treated as fact."
    >
      Source-supported · unconfirmed
    </span>
  );
}

export function MemoryRef({
  id,
  version,
  onClick,
  muted,
}: {
  id: string;
  version: number;
  onClick?: () => void;
  muted?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`chip mono border ${muted ? "border-line text-muted line-through" : "border-accent/25 bg-accent-soft/50 text-accent hover:bg-accent-soft"}`}
      title="Open memory"
    >
      {id.replace(/^mem_/, "m·").slice(0, 10)} v{version}
    </button>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg className={`h-4 w-4 animate-spin text-accent ${className}`} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity=".2" strokeWidth="3" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2 animate-pulse">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="h-3 rounded bg-slate-200/70" style={{ width: `${90 - i * 12}%` }} />
      ))}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-white/60 px-6 py-8 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      {children && <div className="mt-1 text-sm text-muted">{children}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const e = error as ApiError;
  if (e?.status === 403) {
    return (
      <div className="rounded-xl border border-restricted/20 bg-restricted-soft px-5 py-4 text-sm">
        <p className="flex items-center gap-2 font-semibold text-restricted">
          <LockIcon /> Permission denied
        </p>
        <p className="mt-1 text-ink-soft">{e.message}</p>
      </div>
    );
  }
  if (e?.status === 503 || e?.status === 0) {
    return (
      <div className="rounded-xl border border-warn/30 bg-warn-soft px-5 py-4 text-sm">
        <p className="font-semibold text-warn">Service disconnected</p>
        <p className="mt-1 text-ink-soft">{e.message}</p>
        {onRetry && (
          <button className="btn-secondary mt-3" onClick={onRetry}>
            Retry
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-danger/20 bg-danger-soft px-5 py-4 text-sm">
      <p className="font-semibold text-danger">{e?.status === 404 ? "Not found" : "Something went wrong"}</p>
      <p className="mt-1 text-ink-soft">{e?.message ?? String(error)}</p>
      {onRetry && (
        <button className="btn-secondary mt-3" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function Banner({
  tone,
  title,
  children,
}: {
  tone: "warn" | "danger" | "info" | "restricted" | "accent";
  title: string;
  children?: React.ReactNode;
}) {
  const tones = {
    warn: "border-warn/30 bg-warn-soft text-warn",
    danger: "border-danger/20 bg-danger-soft text-danger",
    info: "border-info/20 bg-info-soft text-info",
    restricted: "border-restricted/20 bg-restricted-soft text-restricted",
    accent: "border-accent/20 bg-accent-soft text-accent",
  };
  return (
    <div className={`rounded-lg border px-3.5 py-2.5 text-sm ${tones[tone]}`}>
      <p className="font-semibold">{title}</p>
      {children && <div className="mt-0.5 text-ink-soft">{children}</div>}
    </div>
  );
}

export function LockIcon() {
  return (
    <svg className="h-3 w-3" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M8 1a3.5 3.5 0 0 0-3.5 3.5V7H4a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1h-.5V4.5A3.5 3.5 0 0 0 8 1Zm2 6H6V4.5a2 2 0 1 1 4 0V7Z" />
    </svg>
  );
}

export function Section({
  title,
  right,
  children,
  className = "",
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`card p-4 ${className}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}
