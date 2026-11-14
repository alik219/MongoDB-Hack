"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, fmtDate } from "@/components/api";
import { MemoryDrawer, ProposalActions, type MemoryViewDTO } from "@/components/memory-drawer";
import { useSession } from "@/components/session";
import {
  BasisBadge,
  Banner,
  CategoryBadge,
  Empty,
  ErrorState,
  RestrictedBadge,
  Skeleton,
  Spinner,
  StatusPill,
} from "@/components/ui";
import { SAMPLE_NOTES } from "@/lib/samples";

const STATUSES = ["proposed", "active", "superseded", "expired", "forgotten", "rejected"];
const CATEGORIES = [
  "goal",
  "constraint",
  "previous_decision",
  "revisit_condition",
  "preference",
  "advisor_commitment",
  "life_event",
];

interface IngestResult {
  sourceId: string;
  extractor: string;
  proposals: MemoryViewDTO[];
  skipped: { statement: string; reason: string }[];
  ignoredInstructions: string[];
}

export default function MemoryPage() {
  const { session, client, clientId, clients, version, refresh } = useSession();
  const [scope, setScope] = useState<"client" | "all">("client");
  const [status, setStatus] = useState<string>("");
  const [category, setCategory] = useState("");
  const [q, setQ] = useState("");
  const [data, setData] = useState<{ memories: MemoryViewDTO[]; hiddenRestricted: number } | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showIngest, setShowIngest] = useState(true);

  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get("status");
    if (s) setStatus(s);
  }, []);

  const load = useCallback(async () => {
    setErr(null);
    const p = new URLSearchParams();
    if (scope === "client" && clientId) p.set("clientId", clientId);
    if (category) p.set("category", category);
    if (q) p.set("q", q);
    try {
      setData(await api(`/api/memories?${p}`));
    } catch (e) {
      setErr(e);
    }
  }, [scope, clientId, category, q]);

  useEffect(() => {
    const t = setTimeout(load, 150);
    return () => clearTimeout(t);
  }, [load, version]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const m of data?.memories ?? []) c[m.effectiveStatus] = (c[m.effectiveStatus] ?? 0) + 1;
    return c;
  }, [data]);
  const shown = (data?.memories ?? []).filter((m) => !status || m.effectiveStatus === status);
  const canManage = !!client && session?.user._id === client.leadAdvisorId;
  const names = Object.fromEntries((session?.personas ?? []).map((p) => [p._id, p.name]));
  const changed = () => {
    void load();
    void refresh();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Memory</h1>
          <p className="text-sm text-muted">
            What the agent is allowed to remember, who can see it, how long it lives, and what it has influenced.
          </p>
        </div>
        <div className="flex gap-2">
          <a className="btn-secondary" href={clientId ? `/api/export?clientId=${clientId}` : "#"} target="_blank" rel="noreferrer">
            Export {client?.name.split(" ")[0]}&apos;s memories
          </a>
          <button className="btn-primary" onClick={() => setShowIngest((s) => !s)}>
            {showIngest ? "Hide note ingestion" : "+ Ingest a note"}
          </button>
        </div>
      </div>

      {showIngest && client && <IngestPanel clientId={client._id} clientName={client.name} canManage={canManage} onChanged={changed} onOpen={setOpenId} />}

      <div className="card flex flex-wrap items-center gap-3 p-3">
        <input className="input max-w-xs" placeholder="Search statements and excerpts…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input w-auto" value={scope} onChange={(e) => setScope(e.target.value as "client" | "all")}>
          <option value="client">{client?.name ?? "Selected client"}</option>
          <option value="all">All my clients ({clients.length})</option>
        </select>
        <select className="input w-auto" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        <div className="flex flex-wrap gap-1">
          <button className={`chip px-2 py-1 ${!status ? "bg-ink text-white" : "bg-canvas text-ink-soft"}`} onClick={() => setStatus("")}>
            All {data?.memories.length ?? ""}
          </button>
          {STATUSES.map((s) => (
            <button
              key={s}
              className={`chip px-2 py-1 capitalize ${status === s ? "bg-ink text-white" : "bg-canvas text-ink-soft"}`}
              onClick={() => setStatus(status === s ? "" : s)}
            >
              {s} {counts[s] ?? 0}
            </button>
          ))}
        </div>
      </div>

      {data && data.hiddenRestricted > 0 && (
        <Banner tone="restricted" title={`${data.hiddenRestricted} restricted memor${data.hiddenRestricted > 1 ? "ies are" : "y is"} hidden from you`}>
          Access is limited by the lead advisor. Hidden memories are also excluded from your agent runs.
        </Banner>
      )}

      {err ? (
        <ErrorState error={err} onRetry={load} />
      ) : !data ? (
        <div className="card p-5">
          <Skeleton lines={6} />
        </div>
      ) : shown.length === 0 ? (
        <Empty title="No memories match these filters" />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {shown.map((m) => (
            <MemoryCard key={m._id} m={m} names={names} onOpen={() => setOpenId(m._id)} showClient={scope === "all"} />
          ))}
        </div>
      )}

      {openId && <MemoryDrawer memoryId={openId} onClose={() => setOpenId(null)} onChanged={changed} />}
    </div>
  );
}

function MemoryCard({
  m,
  names,
  onOpen,
  showClient,
}: {
  m: MemoryViewDTO;
  names: Record<string, string>;
  onOpen: () => void;
  showClient: boolean;
}) {
  const dim = ["superseded", "forgotten", "rejected", "expired"].includes(m.effectiveStatus);
  return (
    <button
      onClick={onOpen}
      className={`card flex flex-col p-4 text-left transition hover:border-accent/40 hover:shadow-sm ${dim ? "bg-white/70" : ""}`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusPill status={m.effectiveStatus} />
        <CategoryBadge category={m.category} />
        <span className="chip bg-slate-100 text-slate-600">v{m.version}</span>
        {m.visibility === "restricted" && <RestrictedBadge names={m.allowedUserIds.map((u) => names[u] ?? u).join(", ")} />}
        {m.reviewDue && <span className="chip bg-warn-soft text-warn">Review due</span>}
        {m.proposal?.kind === "update" && m.status === "proposed" && <span className="chip bg-warn-soft text-warn">Update</span>}
        {m.proposal?.kind === "conflict" && m.status === "proposed" && <span className="chip bg-danger-soft text-danger">Conflict</span>}
        {showClient && <span className="ml-auto text-[11px] text-muted">{m.clientName}</span>}
      </div>
      <p className={`mt-2.5 text-[14px] font-medium leading-snug ${dim ? "text-muted" : "text-ink"} ${m.effectiveStatus === "superseded" ? "line-through decoration-slate-300" : ""}`}>
        {m.statement}
      </p>
      {m.evidence[0] && (
        <p className="mt-2 line-clamp-2 border-l-2 border-line pl-2 text-[12px] italic text-muted">“{m.evidence[0].excerpt}”</p>
      )}
      <div className="mt-auto pt-3">
        {m.status !== "forgotten" && <BasisBadge basis={m.basis} />}
        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11.5px] text-muted">
          {m.status === "forgotten" ? (
            <span className="col-span-2 font-medium text-ink-soft">
              Forgotten {fmtDate(m.forgottenAt)}. Content and embedding removed; source retained separately.
            </span>
          ) : (
            <span>Source: {fmtDate(m.evidence[0]?.sourceDate)}</span>
          )}
          <span>Confirmed: {m.confirmedBy ? `${names[m.confirmedBy]?.split(" ")[0] ?? ""} ${fmtDate(m.lastConfirmedAt)}` : "—"}</span>
          <span>Access: {m.visibility === "team" ? "Client team" : "Restricted"}</span>
          <span className={m.effectiveStatus === "expired" ? "font-medium text-warn" : ""}>
            {m.expiresAt ? `Expires ${fmtDate(m.expiresAt)}` : m.reviewAt ? `Review ${fmtDate(m.reviewAt)}` : "No expiry"}
          </span>
          <span className="col-span-2">
            Used by {m.usage.runs} run{m.usage.runs === 1 ? "" : "s"} · {m.usage.openTasks} open task{m.usage.openTasks === 1 ? "" : "s"}
          </span>
        </div>
      </div>
    </button>
  );
}

function IngestPanel({
  clientId,
  clientName,
  canManage,
  onChanged,
  onOpen,
}: {
  clientId: string;
  clientName: string;
  canManage: boolean;
  onChanged: () => void;
  onOpen: (id: string) => void;
}) {
  const samples = SAMPLE_NOTES.filter((s) => s.clientId === clientId);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("meeting_note");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [text, setText] = useState("");
  const [hint, setHint] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<IngestResult | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [decided, setDecided] = useState<Record<string, string>>({});
  const [actErr, setActErr] = useState<string | null>(null);

  useEffect(() => {
    setRes(null);
    setText("");
    setTitle("");
    setHint("");
  }, [clientId]);

  const pick = (id: string) => {
    const s = SAMPLE_NOTES.find((n) => n.id === id)!;
    setTitle(s.title);
    setKind(s.kind);
    setDate(s.sourceDate);
    setText(s.text);
    setHint(s.hint);
    setRes(null);
  };

  const upload = async (f: File | undefined) => {
    if (!f) return;
    if (!/\.(txt|md)$/i.test(f.name) || f.size > 100_000) {
      setErr(new Error("Upload a plain-text (.txt or .md) file under 100 KB."));
      return;
    }
    setText(await f.text());
    setTitle(f.name.replace(/\.(txt|md)$/i, ""));
  };

  const submit = async () => {
    setBusy(true);
    setErr(null);
    setDecided({});
    try {
      setRes(await api<IngestResult>("/api/notes", { body: { clientId, title, kind, sourceDate: date, text } }));
      onChanged();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };

  const act = async (id: string, action: string) => {
    setActErr(null);
    try {
      await api(`/api/memories/${id}`, { body: { action } });
      setDecided((d) => ({ ...d, [id]: action === "approve" ? "Confirmed" : "Rejected" }));
      onChanged();
    } catch (e) {
      setActErr((e as Error).message);
    }
  };

  return (
    <section className="card p-4">
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold">Ingest a note for {clientName}</h2>
            <p className="text-xs text-muted">
              Notes and client messages are treated as evidence, never as instructions. Extracted memories start as proposals.
            </p>
          </div>
          {samples.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              <span className="label self-center">Samples</span>
              {samples.map((s) => (
                <button key={s.id} className="chip border border-line bg-white px-2 py-1 text-ink-soft hover:border-accent/40" onClick={() => pick(s.id)}>
                  {s.label}
                </button>
              ))}
            </div>
          )}
          <div className="grid grid-cols-3 gap-2">
            <input className="input col-span-3 sm:col-span-1" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
            <select className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="meeting_note">Meeting note</option>
              <option value="client_message">Client message</option>
              <option value="advisor_note">Advisor note</option>
            </select>
            <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <textarea
            className="input min-h-[110px] text-[13.5px]"
            placeholder="Paste meeting notes or a client message…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {hint && <p className="text-xs text-muted">ℹ {hint}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-primary" onClick={submit} disabled={busy || text.trim().length < 10}>
              {busy && <Spinner className="text-white" />} Extract proposed memories
            </button>
            <label className="btn-secondary cursor-pointer">
              Upload .txt
              <input type="file" accept=".txt,.md,text/plain" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
            </label>
          </div>
          {err != null && <ErrorState error={err} />}
        </div>

        <div className="space-y-3">
          {!res ? (
            <Empty title="Proposals appear here">
              Each proposal shows the exact excerpt it came from. Nothing is used by the agent until the lead advisor confirms it.
            </Empty>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">
                  {res.proposals.length} proposed memor{res.proposals.length === 1 ? "y" : "ies"}
                </p>
                <span className="text-[11px] text-muted">Extractor: {res.extractor}</span>
              </div>
              {res.ignoredInstructions.length > 0 && (
                <Banner tone="warn" title="Instruction-like text detected and ignored">
                  <ul className="list-disc pl-4 text-xs">
                    {res.ignoredInstructions.map((s, i) => (
                      <li key={i}>“{s}”</li>
                    ))}
                  </ul>
                  <p className="mt-1 text-xs">Stored as evidence only. It cannot change access, permissions or agent actions.</p>
                </Banner>
              )}
              {actErr && <p className="rounded-md bg-danger-soft px-2.5 py-1.5 text-xs text-danger">{actErr}</p>}
              <div className="max-h-[460px] space-y-2.5 overflow-y-auto pr-1">
                {res.proposals.map((p) => (
                  <div key={p._id} className="rounded-lg border border-line p-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <CategoryBadge category={p.category} />
                      <BasisBadge basis={p.basis} />
                      {decided[p._id] && <span className="chip bg-ink text-white">{decided[p._id]}</span>}
                      <button className="ml-auto text-[11px] text-accent hover:underline" onClick={() => onOpen(p._id)}>
                        Details
                      </button>
                    </div>
                    <p className="mt-2 text-[14px] font-medium">{p.statement}</p>
                    <p className="mt-1.5 border-l-2 border-accent/40 pl-2 text-[12.5px] italic text-ink-soft">“{p.evidence[0]?.excerpt}”</p>
                    {!decided[p._id] && (
                      <div className="mt-2.5">
                        {p.proposal?.kind !== "new" ? (
                          <ProposalActions m={p} canManage={canManage} busy={false} onAct={(b) => act(p._id, b.action as string)} onOpen={onOpen} />
                        ) : (
                          <div className="flex gap-2">
                            <button className="btn-primary" disabled={!canManage} onClick={() => act(p._id, "approve")}>
                              Confirm
                            </button>
                            <button className="btn-secondary" disabled={!canManage} onClick={() => act(p._id, "reject")}>
                              Reject
                            </button>
                            {!canManage && <span className="self-center text-xs text-muted">Lead advisor confirmation required</span>}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {res.skipped.length > 0 && (
                <div>
                  <p className="label mb-1">Not proposed</p>
                  <ul className="space-y-0.5 text-[12px] text-ink-soft">
                    {res.skipped.map((s, i) => (
                      <li key={i}>
                        <span className="text-muted">{s.statement}</span> — {s.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
