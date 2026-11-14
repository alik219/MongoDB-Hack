"use client";

import { useState } from "react";
import { api, fmtDate, fmtDateTime } from "./api";
import { SourceExcerpt } from "./memory-drawer";
import { CategoryBadge, ErrorState, MemoryRef, RestrictedBadge, Skeleton, StatusPill } from "./ui";

export interface TaskDTO {
  _id: string;
  key: string;
  title: string;
  detail: string;
  rationale: string;
  ownerId: string;
  status: string;
  needsReview: boolean;
  reviewReasons: { memoryId: string; reason: string; at: string }[];
  dependsOn: { memoryId: string; lineageId: string; version: number }[];
  gatedOnKeys: string[];
  visibility: string;
  createdByRunId: string;
  lastRunId: string;
  replacesTaskId?: string;
  replacedByTaskId?: string;
  withdrawnReason?: string;
  approvedBy?: string;
  approvedAt?: string;
  history: { at: string; actor: string; runId?: string; action: string; note: string }[];
  createdAt: string;
  updatedAt: string;
}

interface Explain {
  support: {
    memoryId: string;
    version: number;
    statement: string;
    category?: string;
    basis?: string;
    status: string;
    currentVersion: number | null;
    currentStatement: string | null;
    evidence: { sourceId: string; excerpt: string; sourceDate: string; sourceTitle: string }[];
  }[];
}

export function TaskCard({
  task,
  names,
  canApprove,
  onChanged,
  onOpenMemory,
  highlight,
}: {
  task: TaskDTO;
  names: Record<string, string>;
  canApprove: boolean;
  onChanged: () => void;
  onOpenMemory: (id: string) => void;
  highlight?: string;
}) {
  const [why, setWhy] = useState<Explain | null>(null);
  const [whyOpen, setWhyOpen] = useState(false);
  const [whyErr, setWhyErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const open = task.status === "draft" || task.status === "approved";

  const toggleWhy = async () => {
    setWhyOpen((o) => !o);
    if (!why) {
      try {
        setWhy(await api<Explain>(`/api/tasks/${task._id}`));
      } catch (e) {
        setWhyErr(e);
      }
    }
  };
  const act = async (action: string) => {
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/tasks/${task._id}`, { body: { action } });
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const gated = task.gatedOnKeys.length > 0;
  const lastAgent = [...task.history].reverse().find((h) => h.actor === "agent");

  return (
    <article
      className={`rounded-xl border bg-white p-3.5 transition ${task.needsReview && open ? "border-warn/50 ring-1 ring-warn/20" : "border-line"} ${highlight ? "ring-2 ring-accent/30" : ""} ${!open ? "opacity-75" : ""}`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusPill status={task.status} />
        {task.needsReview && open && <span className="chip bg-warn-soft text-warn">⚠ Needs review</span>}
        {gated && open && <span className="chip bg-slate-100 text-slate-600">On hold</span>}
        {task.visibility === "restricted" && <RestrictedBadge />}
        {highlight && <span className="chip bg-accent text-white">{highlight}</span>}
        <span className="ml-auto text-[11px] text-muted">Owner: {names[task.ownerId] ?? task.ownerId}</span>
      </div>
      <h3 className={`mt-2 text-[14px] font-semibold leading-snug ${task.status === "withdrawn" ? "text-muted line-through decoration-slate-300" : ""}`}>
        {task.title}
      </h3>
      {task.detail && <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">{task.detail}</p>}
      <p className="mt-1.5 text-[12.5px] text-muted">
        <span className="font-medium text-ink-soft">Why relevant: </span>
        {task.rationale}
      </p>
      {task.withdrawnReason && task.status === "withdrawn" && (
        <p className="mt-1.5 text-[12.5px] text-ink-soft">
          <span className="font-medium">Withdrawn: </span>
          {task.withdrawnReason}
        </p>
      )}
      {task.needsReview && open && task.reviewReasons.length > 0 && (
        <ul className="mt-2 space-y-0.5 rounded-lg bg-warn-soft px-2.5 py-1.5 text-[12px] text-warn">
          {task.reviewReasons.map((r, i) => (
            <li key={i}>{r.reason}</li>
          ))}
        </ul>
      )}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {task.dependsOn.map((d) => (
          <MemoryRef key={d.memoryId} id={d.memoryId} version={d.version} onClick={() => onOpenMemory(d.memoryId)} />
        ))}
        {task.dependsOn.length === 0 && <span className="text-[11px] text-muted">No memory dependencies</span>}
      </div>
      <p className="mt-2 text-[11px] text-muted">
        Created by run <span className="mono">{task.createdByRunId.slice(-8)}</span>
        {task.lastRunId !== task.createdByRunId && (
          <>
            {" "}
            · {lastAgent && lastAgent.runId === task.lastRunId ? `${lastAgent.action} by` : "last checked by"} run{" "}
            <span className="mono">{task.lastRunId.slice(-8)}</span>
          </>
        )}{" "}
        · {fmtDate(task.updatedAt)}
        {task.approvedBy && <> · approved by {names[task.approvedBy] ?? task.approvedBy}</>}
      </p>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <button className="btn-ghost -ml-2 text-accent" onClick={toggleWhy}>
          {whyOpen ? "Hide" : "Why this?"}
        </button>
        {task.status === "draft" && (
          <button
            className="btn-primary"
            disabled={!canApprove || busy || task.needsReview}
            title={!canApprove ? "Only the lead advisor can approve" : task.needsReview ? "Run the agent again first" : ""}
            onClick={() => act("approve")}
          >
            Approve
          </button>
        )}
        {task.status === "approved" && (
          <button className="btn-secondary" disabled={busy} onClick={() => act("complete")}>
            Mark done
          </button>
        )}
        {open && (
          <button className="btn-ghost" disabled={busy} onClick={() => act("withdraw")}>
            Withdraw
          </button>
        )}
      </div>
      {err && <p className="mt-2 rounded-md bg-danger-soft px-2.5 py-1.5 text-xs text-danger">{err}</p>}
      {whyOpen && (
        <div className="mt-3 space-y-3 border-t border-line pt-3">
          {whyErr ? (
            <ErrorState error={whyErr} />
          ) : !why ? (
            <Skeleton lines={3} />
          ) : why.support.length === 0 ? (
            <p className="text-sm text-muted">This task does not rely on any stored memory.</p>
          ) : (
            why.support.map((s) => (
              <div key={s.memoryId} className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <MemoryRef id={s.memoryId} version={s.version} onClick={() => onOpenMemory(s.memoryId)} />
                  {s.category && <CategoryBadge category={s.category} />}
                  <StatusPill status={s.status} />
                  {s.currentVersion && s.currentVersion !== s.version && (
                    <span className="chip bg-warn-soft text-warn">Now v{s.currentVersion}</span>
                  )}
                </div>
                <p className="text-[13px] text-ink">{s.statement}</p>
                {s.currentStatement && (
                  <p className="text-[12px] text-warn">Current version: {s.currentStatement}</p>
                )}
                {s.evidence.map((e, i) => (
                  <SourceExcerpt key={i} excerpt={e.excerpt} sourceId={e.sourceId} sourceDate={e.sourceDate} sourceTitle={e.sourceTitle} />
                ))}
              </div>
            ))
          )}
          <details className="text-xs text-muted">
            <summary className="cursor-pointer">Task history</summary>
            <ul className="mt-1 space-y-0.5">
              {task.history.map((h, i) => (
                <li key={i}>
                  {fmtDateTime(h.at)} · {h.action.replace(/_/g, " ")} by {h.actor === "agent" ? "agent" : (names[h.actor] ?? h.actor)}
                  {h.note ? ` — ${h.note}` : ""}
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </article>
  );
}
