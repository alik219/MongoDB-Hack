"use client";

import { useCallback, useEffect, useState } from "react";
import { api, fmtDate, fmtDateTime, label } from "./api";
import { BasisBadge, CategoryBadge, ErrorState, MemoryRef, RestrictedBadge, Skeleton, Spinner, StatusPill } from "./ui";

export interface MemoryViewDTO {
  _id: string;
  lineageId: string;
  version: number;
  clientId: string;
  clientName: string;
  category: string;
  statement: string;
  structured: { topic: string; attributes: Record<string, string | number | boolean> };
  status: string;
  effectiveStatus: string;
  basis: string;
  evidence: { sourceId: string; excerpt: string; sourceDate: string; sourceKind: string }[];
  proposal?: {
    kind: string;
    targetMemoryId?: string;
    targetVersion?: number;
    changeSummary?: string;
    extractor: string;
    proposedBy: string;
    proposedAt: string;
  };
  supersedesMemoryId?: string;
  supersededByMemoryId?: string;
  createdAt: string;
  createdBy: string;
  confirmedBy?: string;
  confirmedAt?: string;
  lastConfirmedAt?: string;
  visibility: string;
  allowedUserIds: string[];
  expiresAt?: string | null;
  reviewAt?: string | null;
  embeddingModel?: string;
  hasEmbedding: boolean;
  usage: { runs: number; openTasks: number };
  reviewDue: boolean;
  forgottenAt?: string;
  forgetReason?: string;
}

interface Detail {
  memory: MemoryViewDTO;
  versions: MemoryViewDTO[];
  history: { _id: string; type: string; at: string; actorId: string; details: Record<string, unknown> }[];
  runs: { _id: string; createdAt: string; request: string; status: string; versionsUsed: number[] }[];
  tasks: { _id: string; title: string; status: string; needsReview: boolean; versions: number[] }[];
  sources: { _id: string; title: string; kind: string; sourceDate: string }[];
  tombstone: { forgottenAt: string; forgottenBy: string; reason: string } | null;
  canManage: boolean;
  team: { _id: string; name: string; role: string }[];
}

export function SourceExcerpt({
  excerpt,
  sourceTitle,
  sourceDate,
  sourceId,
}: {
  excerpt: string;
  sourceTitle?: string;
  sourceDate: string;
  sourceId: string;
}) {
  const [open, setOpen] = useState(false);
  const [src, setSrc] = useState<{ text: string; title: string; safetyFlags: string[] } | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const toggle = async () => {
    setOpen((o) => !o);
    if (!src && !err && !sourceId.startsWith("advisor")) {
      try {
        setSrc(await api(`/api/sources/${sourceId}`));
      } catch (e) {
        setErr(e);
      }
    }
  };
  const idx = src ? src.text.indexOf(excerpt) : -1;
  return (
    <div className="rounded-lg border-l-[3px] border-accent/50 bg-canvas px-3 py-2">
      <p className="text-[13px] italic leading-relaxed text-ink-soft">“{excerpt}”</p>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted">
        <span>
          {sourceTitle ?? "Source"} · {fmtDate(sourceDate)}
        </span>
        <button className="font-medium text-accent hover:underline" onClick={toggle}>
          {open ? "Hide source" : "View in source"}
        </button>
      </div>
      {open && (
        <div className="mt-2 rounded-md border border-line bg-panel p-2.5 text-[12.5px] leading-relaxed text-ink-soft">
          {err ? (
            <ErrorState error={err} />
          ) : !src ? (
            <Skeleton lines={2} />
          ) : idx >= 0 ? (
            <>
              {src.text.slice(0, idx)}
              <mark className="rounded bg-accent-soft px-0.5 text-ink">{excerpt}</mark>
              {src.text.slice(idx + excerpt.length)}
            </>
          ) : (
            src.text
          )}
          {src && src.safetyFlags.length > 0 && (
            <p className="mt-2 text-[11px] font-medium text-warn">
              ⚠ Contains instruction-like text. Treated as evidence only; it has no effect on access or actions.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function MemoryDrawer({
  memoryId,
  onClose,
  onChanged,
}: {
  memoryId: string;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [id, setId] = useState(memoryId);
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [panel, setPanel] = useState<null | "correct" | "restrict" | "expire" | "forget">(null);

  useEffect(() => setId(memoryId), [memoryId]);

  const load = useCallback(async () => {
    setErr(null);
    try {
      setD(await api<Detail>(`/api/memories/${id}`));
    } catch (e) {
      setErr(e);
      setD(null);
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (body: Record<string, unknown>) => {
    setBusy(true);
    setActionErr(null);
    try {
      const res = await api<{ memoryId?: string; approved?: string }>(`/api/memories/${id}`, { body });
      setPanel(null);
      if (res.memoryId) setId(res.memoryId);
      else await load();
      onChanged?.();
    } catch (e) {
      setActionErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const nameOf = (uid?: string) => d?.team.find((t) => t._id === uid)?.name ?? uid ?? "—";
  const m = d?.memory;

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/60" onClick={onClose}>
      <aside
        className="h-full w-full max-w-[560px] overflow-y-auto border-l border-line bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-panel px-5 py-3">
          <p className="mono text-xs text-muted">{id}</p>
          <button className="btn-ghost" onClick={onClose}>
            Close ✕
          </button>
        </div>
        <div className="space-y-5 p-5">
          {err ? (
            <ErrorState error={err} onRetry={load} />
          ) : !d || !m ? (
            <Skeleton lines={6} />
          ) : (
            <>
              <div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <StatusPill status={m.effectiveStatus} />
                  <CategoryBadge category={m.category} />
                  <span className="chip bg-slate-100 text-slate-600">v{m.version}</span>
                  {m.status !== "forgotten" && <BasisBadge basis={m.basis} />}
                  {m.visibility === "restricted" && (
                    <RestrictedBadge names={m.allowedUserIds.map(nameOf).join(", ")} />
                  )}
                  {m.reviewDue && <span className="chip bg-warn-soft text-warn">Review due</span>}
                </div>
                <p className={`mt-3 text-[17px] font-medium leading-snug ${m.status === "forgotten" ? "text-muted" : ""}`}>
                  {m.statement}
                </p>
                <p className="mt-1 text-xs text-muted">
                  {m.clientName} · topic <span className="mono">{m.structured.topic}</span>
                  {Object.keys(m.structured.attributes).length > 0 && (
                    <>
                      {" "}
                      ·{" "}
                      {Object.entries(m.structured.attributes)
                        .map(([k, v]) => `${k}=${v}`)
                        .join(", ")}
                    </>
                  )}
                </p>
              </div>

              {m.status === "forgotten" && d.tombstone && (
                <div className="rounded-lg border border-slate-300 bg-slate-50 p-3 text-sm">
                  <p className="font-semibold">Forgotten {fmtDateTime(d.tombstone.forgottenAt)} by {nameOf(d.tombstone.forgottenBy)}</p>
                  <p className="mt-1 text-ink-soft">Reason: {d.tombstone.reason}</p>
                  <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-ink-soft">
                    <li>Excluded from all future retrieval immediately.</li>
                    <li>Statement, excerpts and vector embedding were deleted from every version.</li>
                    <li>Copies in run records were redacted; re-ingesting the same source will not recreate it.</li>
                    <li>Kept: ids, category, timestamps, actor and one-way fingerprints (to block re-creation).</li>
                    <li>
                      Retained separately: the original source document (firm record) and historical task text. This is
                      retrieval exclusion plus content removal, not erasure of the source.
                    </li>
                  </ul>
                </div>
              )}

              {m.proposal && m.status === "proposed" && (
                <ProposalBox m={m} canManage={d.canManage} busy={busy} onAct={act} />
              )}

              {m.evidence.length > 0 && (
                <div className="space-y-2">
                  <p className="label">Supporting evidence</p>
                  {m.evidence.map((e, i) => (
                    <SourceExcerpt
                      key={i}
                      excerpt={e.excerpt}
                      sourceId={e.sourceId}
                      sourceDate={e.sourceDate}
                      sourceTitle={d.sources.find((s) => s._id === e.sourceId)?.title}
                    />
                  ))}
                </div>
              )}

              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                {(
                  [
                    ["Confirmed by", m.confirmedBy ? `${nameOf(m.confirmedBy)}, ${fmtDate(m.confirmedAt)}` : "Not confirmed"],
                    ["Last confirmed", fmtDate(m.lastConfirmedAt)],
                    ["Who can access", m.visibility === "team" ? "Client team" : m.allowedUserIds.map(nameOf).join(", ")],
                    ["Expires", m.expiresAt ? fmtDate(m.expiresAt) : "No expiry"],
                    ["Review by", m.reviewAt ? fmtDate(m.reviewAt) : "—"],
                    ["Search index", m.hasEmbedding ? (m.embeddingModel ?? "embedded") : "Not searchable"],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k}>
                    <dt className="label">{k}</dt>
                    <dd className="mt-0.5 text-ink-soft">{v}</dd>
                  </div>
                ))}
              </dl>

              {m.status === "active" && (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    {(
                      [
                        ["correct", "Correct"],
                        ["restrict", "Access"],
                        ["expire", "Expiration"],
                        ["forget", "Forget"],
                      ] as const
                    ).map(([k, l]) => (
                      <button
                        key={k}
                        className={k === "forget" ? "btn-danger" : "btn-secondary"}
                        disabled={!d.canManage || busy}
                        onClick={() => setPanel(panel === k ? null : k)}
                      >
                        {l}
                      </button>
                    ))}
                    <button className="btn-ghost" disabled={!d.canManage || busy} onClick={() => act({ action: "reconfirm" })}>
                      Reconfirm
                    </button>
                  </div>
                  {!d.canManage && (
                    <p className="text-xs text-muted">Only {m.clientName}&apos;s lead advisor can change this memory.</p>
                  )}
                  {panel === "correct" && <CorrectForm m={m} busy={busy} onSubmit={act} />}
                  {panel === "restrict" && <RestrictForm m={m} team={d.team} busy={busy} onSubmit={act} />}
                  {panel === "expire" && <ExpireForm m={m} busy={busy} onSubmit={act} />}
                  {panel === "forget" && <ForgetForm busy={busy} onSubmit={act} />}
                </div>
              )}
              {actionErr && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{actionErr}</p>}

              <div>
                <p className="label mb-2">Version history</p>
                <ol className="space-y-2">
                  {d.versions.map((v) => (
                    <li
                      key={v._id}
                      className={`rounded-lg border px-3 py-2 text-sm ${v._id === m._id ? "border-accent/40 bg-accent-soft/30" : "border-line"}`}
                    >
                      <div className="flex items-center gap-2">
                        <button className="mono text-xs text-accent hover:underline" onClick={() => setId(v._id)}>
                          v{v.version}
                        </button>
                        <StatusPill status={v.effectiveStatus} />
                        <span className="text-xs text-muted">{fmtDate(v.confirmedAt ?? v.createdAt)}</span>
                      </div>
                      <p className={`mt-1 ${v.status === "superseded" ? "text-muted line-through decoration-slate-300" : "text-ink-soft"}`}>
                        {v.statement}
                      </p>
                    </li>
                  ))}
                </ol>
              </div>

              <div>
                <p className="label mb-2">Downstream usage</p>
                {d.runs.length === 0 && d.tasks.length === 0 ? (
                  <p className="text-sm text-muted">No agent run or task has used this memory yet.</p>
                ) : (
                  <div className="space-y-2 text-sm">
                    {d.tasks.map((t) => (
                      <div key={t._id} className="flex items-center gap-2">
                        <StatusPill status={t.status} />
                        {t.needsReview && <span className="chip bg-warn-soft text-warn">Needs review</span>}
                        <span className="text-ink-soft">{t.title}</span>
                        <span className="text-xs text-muted">(v{t.versions.join(", v")})</span>
                      </div>
                    ))}
                    {d.runs.map((r) => (
                      <div key={r._id} className="text-xs text-muted">
                        Run <span className="mono">{r._id}</span> · {fmtDateTime(r.createdAt)} · used v{r.versionsUsed.join(", v")}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <p className="label mb-2">Audit trail</p>
                <ul className="space-y-1 text-xs text-ink-soft">
                  {d.history.length === 0 && <li className="text-muted">No events recorded.</li>}
                  {d.history.map((h) => (
                    <li key={h._id}>
                      <span className="text-muted">{fmtDateTime(h.at)}</span> · {label(h.type)} by {nameOf(h.actorId)}
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

function ProposalBox({
  m,
  canManage,
  busy,
  onAct,
}: {
  m: MemoryViewDTO;
  canManage: boolean;
  busy: boolean;
  onAct: (b: Record<string, unknown>) => void;
}) {
  return <ProposalActions m={m} canManage={canManage} busy={busy} onAct={onAct} />;
}

export function ProposalActions({
  m,
  canManage,
  busy,
  onAct,
  onOpen,
}: {
  m: MemoryViewDTO;
  canManage: boolean;
  busy: boolean;
  onAct: (b: Record<string, unknown>) => void;
  onOpen?: (id: string) => void;
}) {
  const p = m.proposal!;
  return (
    <div
      className={`rounded-lg border p-3 text-sm ${p.kind === "conflict" ? "border-danger/25 bg-danger-soft/50" : p.kind === "update" ? "border-warn/30 bg-warn-soft/60" : "border-info/20 bg-info-soft/50"}`}
    >
      <p className="font-semibold">
        {p.kind === "new" && "New memory proposed"}
        {p.kind === "update" && (
          <>
            Proposed update to a confirmed memory{" "}
            {p.targetMemoryId && <MemoryRef id={p.targetMemoryId} version={p.targetVersion ?? 1} onClick={() => onOpen?.(p.targetMemoryId!)} />}
          </>
        )}
        {p.kind === "conflict" && "Conflicts with an advisor-confirmed fact"}
      </p>
      {p.changeSummary && (
        <p className="mt-1 text-ink-soft">
          {p.changeSummary.split(" → ").map((part, i, arr) => (
            <span key={i}>
              <span className={i === 0 && arr.length > 1 ? "text-muted line-through" : "font-medium text-ink"}>{part}</span>
              {i < arr.length - 1 && <span className="mx-1 text-muted">→</span>}
            </span>
          ))}
        </p>
      )}
      {p.kind === "conflict" && (
        <p className="mt-1 text-xs text-ink-soft">
          The confirmed fact stays in effect. The agent will prepare a clarification task instead of replacing it.
          Approve only after confirming with the client.
        </p>
      )}
      {p.kind === "update" && (
        <p className="mt-1 text-xs text-ink-soft">
          Approving creates v{m.version} and marks v{p.targetVersion} superseded. Draft tasks that depend on it will be flagged for review.
        </p>
      )}
      <p className="mt-1 text-[11px] text-muted">Extracted by {p.extractor}</p>
      <div className="mt-2 flex gap-2">
        <button className="btn-primary" disabled={!canManage || busy} onClick={() => onAct({ action: "approve" })}>
          {p.kind === "new" ? "Confirm" : "Confirm & replace"}
        </button>
        <button className="btn-secondary" disabled={!canManage || busy} onClick={() => onAct({ action: "reject" })}>
          Reject
        </button>
        {!canManage && <span className="self-center text-xs text-muted">Lead advisor confirmation required</span>}
      </div>
    </div>
  );
}

function CorrectForm({ m, busy, onSubmit }: { m: MemoryViewDTO; busy: boolean; onSubmit: (b: Record<string, unknown>) => void }) {
  const [statement, setStatement] = useState(m.statement);
  const [attrs, setAttrs] = useState(
    Object.entries(m.structured.attributes).map(([k, v]) => [k, String(v)] as [string, string]),
  );
  const [reason, setReason] = useState("");
  return (
    <div className="space-y-2 rounded-lg border border-line p-3">
      <p className="text-xs text-muted">Creates v{m.version + 1}. The current version is kept as superseded history.</p>
      <textarea className="input" rows={2} value={statement} onChange={(e) => setStatement(e.target.value)} />
      {attrs.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {attrs.map(([k, v], i) => (
            <label key={k} className="text-xs">
              <span className="mono text-muted">{k}</span>
              <input
                className="input mt-0.5"
                value={v}
                onChange={(e) => setAttrs(attrs.map((a, j) => (j === i ? [k, e.target.value] : a)))}
              />
            </label>
          ))}
        </div>
      )}
      <input className="input" placeholder="Reason for correction" value={reason} onChange={(e) => setReason(e.target.value)} />
      <button
        className="btn-primary"
        disabled={busy || statement.trim().length < 5}
        onClick={() =>
          onSubmit({
            action: "correct",
            statement,
            reason,
            attributes: Object.fromEntries(attrs.map(([k, v]) => [k, v === "true" ? true : v === "false" ? false : v])),
          })
        }
      >
        {busy && <Spinner className="text-white" />} Save correction
      </button>
    </div>
  );
}

function RestrictForm({
  m,
  team,
  busy,
  onSubmit,
}: {
  m: MemoryViewDTO;
  team: { _id: string; name: string; role: string }[];
  busy: boolean;
  onSubmit: (b: Record<string, unknown>) => void;
}) {
  const [vis, setVis] = useState(m.visibility);
  const [allowed, setAllowed] = useState<string[]>(m.allowedUserIds);
  return (
    <div className="space-y-2 rounded-lg border border-line p-3 text-sm">
      <label className="flex items-center gap-2">
        <input type="radio" checked={vis === "team"} onChange={() => setVis("team")} /> Everyone on the client team
      </label>
      <label className="flex items-center gap-2">
        <input type="radio" checked={vis === "restricted"} onChange={() => setVis("restricted")} /> Restricted to:
      </label>
      {vis === "restricted" && (
        <div className="ml-6 space-y-1">
          {team.map((u) => (
            <label key={u._id} className="flex items-center gap-2">
              <input
                type="checkbox"
                disabled={u.role === "lead_advisor"}
                checked={u.role === "lead_advisor" || allowed.includes(u._id)}
                onChange={(e) => setAllowed(e.target.checked ? [...allowed, u._id] : allowed.filter((x) => x !== u._id))}
              />
              {u.name} <span className="text-xs text-muted">{label(u.role)}</span>
            </label>
          ))}
        </div>
      )}
      <p className="text-xs text-muted">Enforced on the server and inside the vector search pre-filter. Applies to all versions.</p>
      <button className="btn-primary" disabled={busy} onClick={() => onSubmit({ action: "restrict", visibility: vis, allowedUserIds: allowed })}>
        Save access
      </button>
    </div>
  );
}

function ExpireForm({ m, busy, onSubmit }: { m: MemoryViewDTO; busy: boolean; onSubmit: (b: Record<string, unknown>) => void }) {
  const [exp, setExp] = useState(m.expiresAt?.slice(0, 10) ?? "");
  const [rev, setRev] = useState(m.reviewAt?.slice(0, 10) ?? "");
  return (
    <div className="grid grid-cols-2 gap-2 rounded-lg border border-line p-3 text-sm">
      <label className="text-xs">
        <span className="label">Expires (excluded after)</span>
        <input type="date" className="input mt-1" value={exp} onChange={(e) => setExp(e.target.value)} />
      </label>
      <label className="text-xs">
        <span className="label">Review by (flag for reconfirmation)</span>
        <input type="date" className="input mt-1" value={rev} onChange={(e) => setRev(e.target.value)} />
      </label>
      <p className="col-span-2 text-xs text-muted">Expiry is checked on every read and before any task is saved.</p>
      <div className="col-span-2">
        <button
          className="btn-primary"
          disabled={busy}
          onClick={() => onSubmit({ action: "set_expiration", expiresAt: exp || null, reviewAt: rev || null })}
        >
          Save dates
        </button>
      </div>
    </div>
  );
}

function ForgetForm({ busy, onSubmit }: { busy: boolean; onSubmit: (b: Record<string, unknown>) => void }) {
  const [reason, setReason] = useState("");
  return (
    <div className="space-y-2 rounded-lg border border-danger/25 bg-danger-soft/40 p-3 text-sm">
      <p className="font-semibold text-danger">Forget this memory (all versions)</p>
      <ul className="list-disc space-y-0.5 pl-5 text-xs text-ink-soft">
        <li>Immediately excluded from retrieval; embeddings and text removed.</li>
        <li>Run-record copies are redacted; re-ingesting the same source won&apos;t recreate it.</li>
        <li>The original source document and historical task text are retained separately.</li>
      </ul>
      <input className="input" placeholder="Reason (recorded)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <button className="btn-danger" disabled={busy || reason.trim().length < 3} onClick={() => onSubmit({ action: "forget", reason })}>
        Forget permanently
      </button>
    </div>
  );
}
