"use client";

import { fmtDateTime, label } from "./api";
import { Banner, CategoryBadge, MemoryRef, Spinner } from "./ui";

export interface RunDTO {
  _id: string;
  clientId: string;
  actorId: string;
  request: string;
  services: { storage: string; embeddings: string; planner: string };
  status: "completed" | "stale" | "failed";
  stages: { key: string; label: string; status: string; ms: number; detail: string }[];
  retrieved: {
    memoryId: string;
    lineageId: string;
    version: number;
    category: string;
    statement: string;
    similarity: number;
    freshness: string;
  }[];
  pendingChanges: { memoryId: string; kind: string; summary: string }[];
  policy: { rule: string; outcome: string; count?: number }[];
  brief: {
    summary: string;
    context: { text: string; memoryIds: string[] }[];
    missingInformation: { text: string; memoryIds: string[] }[];
    conflicts: { text: string; memoryIds: string[] }[];
  } | null;
  appliedActions: {
    type: string;
    taskId: string;
    taskKey: string;
    title: string;
    rationale: string;
    memoryRefs: { memoryId: string; version: number }[];
    changedBecause?: string[];
  }[];
  rejectedActions: { action: unknown; reason: string }[];
  lenderChecks?: {
    policyId: string;
    bank: string;
    product: string;
    policyVersion: string;
    decision: "approve" | "refer" | "decline";
    summary: string;
    checks: { rule: string; outcome: "pass" | "fail" | "unknown"; detail: string; factKeys: string[] }[];
    offer?: { kind: string; limit?: number; note?: string };
    factsUsed: { key: string; value: number; memoryId?: string; version?: number }[];
    pivotalFacts: { factKey: string; memoryId?: string; statement?: string; decisionWithout: string }[];
  }[];
  errors: string[];
  staleReason?: string;
  createdAt: string;
  durationMs: number;
  hiddenForViewer?: number;
}

export const PLANNED_STAGES = [
  "Checking access",
  "Loading open follow-ups",
  "Retrieving memories",
  "Checking freshness & conflicts",
  "Checking lender policies",
  "Preparing follow-ups",
  "Validating output & citations",
  "Revalidating & saving tasks",
];

export function StagesRunning({ step }: { step: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]">
      {PLANNED_STAGES.map((s, i) => (
        <li key={s} className="flex items-center gap-1.5">
          {i < step ? (
            <span className="text-accent">✓</span>
          ) : i === step ? (
            <Spinner className="h-3 w-3" />
          ) : (
            <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
          )}
          <span className={i <= step ? "text-ink" : "text-muted"}>{s}</span>
          {i < PLANNED_STAGES.length - 1 && <span className="text-slate-300">→</span>}
        </li>
      ))}
    </ol>
  );
}

export function Stages({ run }: { run: RunDTO }) {
  return (
    <ol className="space-y-1">
      {run.stages.map((s, i) => (
        <li key={i} className="flex items-start gap-2 text-[12.5px]">
          <span
            className={`mt-0.5 w-3 text-center ${s.status === "done" ? "text-accent" : s.status === "skipped" ? "text-muted" : "text-danger"}`}
          >
            {s.status === "done" ? "✓" : s.status === "skipped" ? "–" : "✕"}
          </span>
          <span className="w-52 shrink-0 font-medium text-ink">{s.label}</span>
          <span className="text-muted">{s.detail}</span>
        </li>
      ))}
    </ol>
  );
}

const ACTION_STYLE: Record<string, string> = {
  create_task: "bg-accent-soft text-accent",
  revise_task: "bg-info-soft text-info",
  withdraw_task: "bg-danger-soft text-danger",
  keep_task: "bg-slate-100 text-slate-600",
  flag_for_review: "bg-warn-soft text-warn",
};
const ACTION_LABEL: Record<string, string> = {
  create_task: "Created",
  revise_task: "Revised",
  withdraw_task: "Withdrawn",
  keep_task: "Kept",
  flag_for_review: "Flagged for advisor",
};

export function ActionList({ run, onOpenMemory, compact }: { run: RunDTO; onOpenMemory?: (id: string) => void; compact?: boolean }) {
  if (!run.appliedActions.length) return <p className="text-sm text-muted">No task actions.</p>;
  return (
    <ul className="space-y-2">
      {run.appliedActions.map((a, i) => (
        <li key={i} className="text-[13px]">
          <div className="flex items-start gap-1.5">
            <span className={`chip mt-px shrink-0 ${ACTION_STYLE[a.type] ?? ""}`}>{ACTION_LABEL[a.type] ?? a.type}</span>
            <span className={`min-w-0 font-medium ${a.type === "withdraw_task" ? "text-muted line-through decoration-slate-300" : "text-ink"}`}>{a.title}</span>
          </div>
          {!compact && a.changedBecause && a.changedBecause.length > 0 && (
            <ul className="ml-1 mt-1 space-y-0.5 border-l-2 border-warn/40 pl-2 text-[12px] text-ink-soft">
              {a.changedBecause.map((c, j) => (
                <li key={j}>
                  <span className="font-medium text-warn">Because </span>
                  {c}
                </li>
              ))}
            </ul>
          )}
          {!compact && a.type === "withdraw_task" && !a.changedBecause?.length && (
            <p className="ml-1 mt-0.5 text-[12px] text-muted">{a.rationale}</p>
          )}
          {!compact && a.memoryRefs.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {a.memoryRefs.map((m) => (
                <MemoryRef key={m.memoryId} id={m.memoryId} version={m.version} onClick={() => onOpenMemory?.(m.memoryId)} />
              ))}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function Points({
  pts,
  onOpenMemory,
  run,
}: {
  pts: { text: string; memoryIds: string[] }[];
  onOpenMemory?: (id: string) => void;
  run: RunDTO;
}) {
  const ver = (id: string) => run.retrieved.find((r) => r.memoryId === id)?.version ?? 1;
  return (
    <ul className="space-y-1.5">
      {pts.map((p, i) => (
        <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-ink-soft">
          <span className="text-slate-300">•</span>
          <span className="min-w-0">
            <span className="first-letter:uppercase">{p.text}</span>{" "}
            {p.memoryIds.map((id) => (
              <span key={id} className="ml-1 inline-block align-middle">
                <MemoryRef id={id} version={ver(id)} onClick={() => onOpenMemory?.(id)} />
              </span>
            ))}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function RunStatusBanner({ run }: { run: RunDTO }) {
  if (run.status === "stale")
    return (
      <Banner tone="warn" title="Stale result: nothing was saved">
        {run.staleReason} Run the agent again to regenerate from current memories.
      </Banner>
    );
  if (run.status === "failed")
    return (
      <Banner tone="danger" title="Run failed: nothing was saved">
        {run.errors.join(" ")}
      </Banner>
    );
  return null;
}

export function BriefView({ run, onOpenMemory }: { run: RunDTO; onOpenMemory?: (id: string) => void }) {
  if (!run.brief) return null;
  const b = run.brief;
  return (
    <div className="space-y-4">
      <p className="text-[14px] leading-relaxed text-ink">{b.summary}</p>
      {b.conflicts.length > 0 && (
        <div className="rounded-lg border border-danger/20 bg-danger-soft/50 p-3">
          <p className="label mb-1.5 text-danger">Conflicting or unconfirmed facts</p>
          <Points pts={b.conflicts} run={run} onOpenMemory={onOpenMemory} />
        </div>
      )}
      {b.missingInformation.length > 0 && (
        <div className="rounded-lg border border-warn/25 bg-warn-soft/60 p-3">
          <p className="label mb-1.5 text-warn">Missing information</p>
          <Points pts={b.missingInformation} run={run} onOpenMemory={onOpenMemory} />
        </div>
      )}
      {b.context.length > 0 && (
        <div>
          <p className="label mb-1.5">What we know (confirmed, authorized memories)</p>
          <Points pts={b.context} run={run} onOpenMemory={onOpenMemory} />
        </div>
      )}
    </div>
  );
}

export function RetrievalView({ run, onOpenMemory }: { run: RunDTO; onOpenMemory?: (id: string) => void }) {
  return (
    <div className="space-y-3">
      {run.retrieved.length === 0 ? (
        <p className="text-sm text-muted">No memories were used.</p>
      ) : (
        <ul className="space-y-1.5">
          {run.retrieved.map((r) => (
            <li key={r.memoryId} className="flex items-start gap-2 text-[12.5px]">
              <MemoryRef id={r.memoryId} version={r.version} onClick={() => onOpenMemory?.(r.memoryId)} />
              <CategoryBadge category={r.category} />
              <span className="flex-1 text-ink-soft">{r.statement}</span>
              <span className="mono shrink-0 text-[11px] text-muted" title="Vector similarity: used only to rank retrieval. Not a measure of whether the fact is true.">
                sim {r.similarity.toFixed(2)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] text-muted">
        “sim” is vector similarity used for ranking only. It is not confidence that a fact is true; truth comes from advisor confirmation.
      </p>
      <div>
        <p className="label mb-1">Policy decisions</p>
        <ul className="space-y-0.5 text-[12px] text-ink-soft">
          {run.policy.map((p, i) => (
            <li key={i}>
              {p.rule === "excluded" ? (
                <>
                  Excluded {p.count} × <span className="font-medium">{label(p.outcome)}</span>
                </>
              ) : (
                p.outcome
              )}
            </li>
          ))}
          {run.pendingChanges.length > 0 && <li>{run.pendingChanges.length} unconfirmed change(s) passed to the planner as pending, never as facts.</li>}
          {(run.hiddenForViewer ?? 0) > 0 && (
            <li className="text-restricted">{run.hiddenForViewer} restricted reference(s) in this run are hidden from you.</li>
          )}
        </ul>
      </div>
      {run.rejectedActions.length > 0 && (
        <div>
          <p className="label mb-1 text-danger">Rejected model actions</p>
          <ul className="space-y-0.5 text-[12px] text-danger">
            {run.rejectedActions.map((r, i) => (
              <li key={i}>{r.reason}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function RunMeta({ run, names }: { run: RunDTO; names: Record<string, string> }) {
  return (
    <p className="text-[11px] text-muted">
      Run <span className="mono">{run._id}</span> · {fmtDateTime(run.createdAt)} · {names[run.actorId] ?? run.actorId} ·{" "}
      {run.durationMs} ms · planner: {run.services.planner} · embeddings: {run.services.embeddings} · storage: {run.services.storage}
    </p>
  );
}

const DECISION_STYLE: Record<string, string> = {
  approve: "bg-accent/10 text-accent",
  refer: "bg-warn-soft text-warn",
  decline: "bg-danger-soft text-danger",
};
const OUTCOME_MARK: Record<string, string> = { pass: "✓", fail: "✗", unknown: "?" };

/** Lender decisions computed in code from authorized facts, with the facts whose removal flips each one. */
export function LenderChecksView({ run, onOpenMemory }: { run: RunDTO; onOpenMemory?: (id: string) => void }) {
  const checks = run.lenderChecks ?? [];
  if (!checks.length) return null;
  const versionOf = (id?: string) => run.retrieved.find((r) => r.memoryId === id)?.version ?? 1;
  return (
    <div className="space-y-3">
      <p className="text-[11px] text-muted">
        Simulated RBC / TD / CIBC policies, evaluated in code (not by the model) against advisor-confirmed facts you are allowed to read.
        “Pivotal” facts are the memories whose removal changes the decision, found by re-running the engine without each one.
      </p>
      {checks.map((c) => (
        <div key={c.policyId} className="rounded-lg border border-line p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-ink">{c.bank}</span>
            <span className="text-[12px] text-muted">{label(c.product)} · policy v{c.policyVersion}</span>
            <span className={`chip uppercase ${DECISION_STYLE[c.decision]}`}>{c.decision}</span>
            {c.offer?.limit !== undefined && (
              <span className="text-[12px] text-ink-soft">
                {c.offer.kind} up to ${c.offer.limit.toLocaleString("en-CA")}
              </span>
            )}
          </div>
          <ul className="mt-2 space-y-0.5 text-[12px] text-ink-soft">
            {c.checks.map((k, i) => (
              <li key={i}>
                <span className={k.outcome === "fail" ? "text-danger" : k.outcome === "unknown" ? "text-warn" : "text-accent"}>
                  {OUTCOME_MARK[k.outcome]}
                </span>{" "}
                {k.rule}: <span className="text-muted">{k.detail}</span>
              </li>
            ))}
          </ul>
          {c.pivotalFacts.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px]">
              <span className="label">Pivotal</span>
              {c.pivotalFacts.map((p) => (
                <span key={p.factKey} className="flex items-center gap-1">
                  {p.memoryId && <MemoryRef id={p.memoryId} version={versionOf(p.memoryId)} onClick={() => onOpenMemory?.(p.memoryId!)} />}
                  <span className="text-muted">
                    {label(p.factKey)} → {p.decisionWithout} without it
                  </span>
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
