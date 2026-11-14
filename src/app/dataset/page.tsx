"use client";

import { useCallback, useEffect, useState } from "react";
import { api, fmtDate, label } from "@/components/api";
import { MemoryDrawer, type MemoryViewDTO } from "@/components/memory-drawer";
import { useSession } from "@/components/session";
import { Banner, CategoryBadge, Empty, ErrorState, Skeleton, Spinner } from "@/components/ui";

interface SourceRow {
  _id: string;
  title: string;
  kind: string;
  sourceDate: string;
  chars: number;
  contentHash: string;
  safetyFlags: number;
  memories: { active: number; proposed: number; other: number };
}
interface SourceDoc {
  _id: string;
  title: string;
  kind: string;
  sourceDate: string;
  text: string;
  safetyFlags: string[];
}
interface IngestResult {
  sourceId: string;
  extractor: string;
  proposals: MemoryViewDTO[];
  skipped: { statement: string; reason: string }[];
  ignoredInstructions: string[];
}

const KINDS = ["", "meeting_note", "client_profile", "client_goals", "advisor_note", "client_message"];

/** The stored documents behind a client's memories: profile, goals and every meeting note. */
export default function DatasetPage() {
  const { client, clientId, version, refresh } = useSession();
  const [rows, setRows] = useState<SourceRow[] | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [kind, setKind] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [doc, setDoc] = useState<SourceDoc | null>(null);
  const [docErr, setDocErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<IngestResult | null>(null);
  const [runErr, setRunErr] = useState<unknown>(null);
  const [memId, setMemId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!clientId) return;
    setErr(null);
    try {
      setRows(await api(`/api/sources?clientId=${clientId}`));
    } catch (e) {
      setErr(e);
    }
  }, [clientId]);

  useEffect(() => {
    setRows(null);
    setOpenId(null);
    void load();
  }, [load, version]);

  useEffect(() => {
    setDoc(null);
    setDocErr(null);
    setResult(null);
    setRunErr(null);
    if (!openId) return;
    let live = true;
    api<SourceDoc>(`/api/sources/${openId}`)
      .then((d) => live && setDoc(d))
      .catch((e) => live && setDocErr(e));
    return () => {
      live = false;
    };
  }, [openId]);

  const extract = async () => {
    if (!openId) return;
    setBusy(true);
    setRunErr(null);
    setResult(null);
    try {
      setResult(await api<IngestResult>(`/api/sources/${openId}/extract`, { method: "POST" }));
      await load();
      await refresh();
    } catch (e) {
      setRunErr(e);
    } finally {
      setBusy(false);
    }
  };

  const shown = (rows ?? []).filter((r) => !kind || r.kind === kind);
  const totals = (rows ?? []).reduce(
    (a, r) => ({ chars: a.chars + r.chars, active: a.active + r.memories.active, proposed: a.proposed + r.memories.proposed }),
    { chars: 0, active: 0, proposed: 0 },
  );
  const unused = (rows ?? []).filter((r) => r.memories.active + r.memories.proposed + r.memories.other === 0).length;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Dataset</h1>
        <p className="text-sm text-muted">
          Every stored document for {client?.name ?? "this client"}. A document is evidence, not memory: the agent only uses facts an
          advisor has confirmed from it.
        </p>
      </div>

      {err ? (
        <ErrorState error={err} onRetry={load} />
      ) : !rows ? (
        <div className="card p-5">
          <Skeleton lines={5} />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Documents", rows.length],
              ["Characters stored", totals.chars.toLocaleString("en-CA")],
              ["Confirmed memories backed", totals.active],
              ["Documents not yet mined", unused],
            ].map(([k, v]) => (
              <div key={k as string} className="card p-3">
                <p className="label">{k}</p>
                <p className="mono mt-1 text-lg text-ink">{v}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <div className="card overflow-hidden">
              <div className="flex items-center justify-between gap-2 border-b border-line p-3">
                <p className="label">Documents ({shown.length})</p>
                <select className="input w-auto" value={kind} onChange={(e) => setKind(e.target.value)}>
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {k ? label(k) : "All kinds"}
                    </option>
                  ))}
                </select>
              </div>
              {shown.length === 0 ? (
                <div className="p-4">
                  <Empty title="No documents">Nothing is stored for this client yet.</Empty>
                </div>
              ) : (
                <ul className="max-h-[70vh] divide-y divide-line overflow-y-auto">
                  {shown.map((r) => (
                    <li key={r._id}>
                      <button
                        type="button"
                        onClick={() => setOpenId(r._id)}
                        className={`w-full px-3 py-2 text-left hover:bg-white/5 ${openId === r._id ? "bg-canvas" : ""}`}
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-[13px] font-medium text-ink">{r.title}</span>
                          <span className="mono shrink-0 text-[11px] text-muted">{r.sourceDate}</span>
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted">
                          <span>{label(r.kind)}</span>
                          <span className="mono">{r.chars.toLocaleString("en-CA")} chars</span>
                          <span className="mono">sha {r.contentHash}</span>
                          {r.memories.active > 0 && <span className="text-accent">{r.memories.active} confirmed</span>}
                          {r.memories.proposed > 0 && <span className="text-info">{r.memories.proposed} awaiting review</span>}
                          {r.safetyFlags > 0 && <span className="text-warn">{r.safetyFlags} instruction-like line(s)</span>}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="card p-4">
              {!openId ? (
                <Empty title="Pick a document">Read the stored text and extract memories from it.</Empty>
              ) : docErr ? (
                <ErrorState error={docErr} />
              ) : !doc ? (
                <Skeleton lines={8} />
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-ink">{doc.title}</p>
                      <p className="text-[12px] text-muted">
                        {label(doc.kind)} · {fmtDate(doc.sourceDate)} · <span className="mono">{doc._id}</span>
                      </p>
                    </div>
                    <button className="btn-primary" onClick={extract} disabled={busy}>
                      {busy ? (
                        <span className="flex items-center gap-2">
                          <Spinner className="h-3 w-3" /> Extracting…
                        </span>
                      ) : (
                        "Extract memories from this document"
                      )}
                    </button>
                  </div>
                  {doc.safetyFlags.length > 0 && (
                    <Banner tone="warn" title="Instruction-like text found">
                      This document contains lines that look like instructions. They are treated as content and never followed.
                    </Banner>
                  )}
                  {runErr ? <ErrorState error={runErr} /> : null}
                  {result && (
                    <div className="rounded-lg border border-line p-3">
                      <p className="label mb-1.5">
                        {result.proposals.length} proposal(s) · {result.skipped.length} skipped · extractor: {result.extractor}
                      </p>
                      <ul className="space-y-1.5">
                        {result.proposals.map((p) => (
                          <li key={p._id} className="flex items-start gap-2 text-[12.5px]">
                            <CategoryBadge category={p.category} />
                            <button type="button" className="flex-1 text-left text-ink-soft hover:text-ink" onClick={() => setMemId(p._id)}>
                              {p.statement}
                            </button>
                          </li>
                        ))}
                        {result.skipped.map((s, i) => (
                          <li key={`s${i}`} className="text-[12px] text-muted">
                            Skipped: {s.statement} ({s.reason})
                          </li>
                        ))}
                      </ul>
                      {result.proposals.length > 0 && (
                        <p className="mt-2 text-[11px] text-muted">
                          These are proposals. The agent ignores them until the lead advisor confirms them under Memory.
                        </p>
                      )}
                    </div>
                  )}
                  <pre className="max-h-[55vh] overflow-y-auto whitespace-pre-wrap rounded-lg bg-canvas p-3 text-[12.5px] leading-relaxed text-ink-soft">
                    {doc.text}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {memId && <MemoryDrawer memoryId={memId} onClose={() => setMemId(null)} onChanged={() => void load()} />}
    </div>
  );
}
