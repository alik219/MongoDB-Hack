"use client";

import { useEffect, useState } from "react";
import { api } from "@/components/api";
import { MemoryDrawer } from "@/components/memory-drawer";
import { ActionList, RunStatusBanner, type RunDTO } from "@/components/run-view";
import { useSession } from "@/components/session";
import { Banner, CategoryBadge, ErrorState, MemoryRef, Spinner } from "@/components/ui";
import { DEFAULT_REQUEST } from "@/lib/samples";

interface Comparison {
  request: string;
  corrected: boolean;
  columns: { key: string; label: string; run: RunDTO }[];
}

const COLUMN_NOTE: Record<string, string> = {
  none: "Retrieval disabled. The planner sees only the request.",
  original: "Memory as confirmed before the first correction, reconstructed from version history.",
  current: "Current active versions via the normal scoped retrieval path.",
};

export default function ComparePage() {
  const { client, clientId } = useSession();
  const [request, setRequest] = useState("");
  const [data, setData] = useState<Comparison | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [memoryId, setMemoryId] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setRequest(clientId ? (DEFAULT_REQUEST[clientId] ?? "") : "");
  }, [clientId]);

  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      setData(await api<Comparison>("/api/compare", { body: { clientId, request } }));
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };

  const taskTitles = (r: RunDTO) => new Set(r.appliedActions.map((a) => a.taskKey));
  const all = data?.columns.map((c) => taskTitles(c.run)) ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Memory influence comparison</h1>
        <p className="text-sm text-muted">
          Same request, same (empty) set of open tasks, three memory conditions. Dry runs: nothing is saved.
        </p>
      </div>
      <Banner tone="info" title="A demonstration of memory influence, not proof of model causality">
        The request and open-task input are held constant so differences in retrieved context and task actions are visible. With a
        language model planner, outputs can also vary between calls for reasons unrelated to memory.
      </Banner>
      <div className="card flex flex-wrap items-center gap-3 p-4">
        <input className="input min-w-[280px] flex-1" value={request} onChange={(e) => setRequest(e.target.value)} />
        <button className="btn-primary" onClick={go} disabled={busy || !clientId}>
          {busy && <Spinner className="text-white" />} Compare for {client?.name}
        </button>
      </div>
      {err != null && <ErrorState error={err} onRetry={go} />}
      {data && !data.corrected && (
        <Banner tone="warn" title="No corrections yet">
          The second and third columns will match until a confirmed memory is corrected (for example, by confirming the November update).
        </Banner>
      )}
      {data && (
        <div className="grid gap-4 lg:grid-cols-3">
          {data.columns.map((c, i) => (
            <section key={c.key} className="card flex flex-col p-4">
              <p className="label">{i + 1}</p>
              <h2 className="text-[15px] font-semibold">{c.label}</h2>
              <p className="text-xs text-muted">{COLUMN_NOTE[c.key]}</p>
              <RunStatusBanner run={c.run} />
              <div className="mt-3">
                <p className="label mb-1.5">Retrieved context ({c.run.retrieved.length})</p>
                {c.run.retrieved.length === 0 ? (
                  <p className="text-sm text-muted">None</p>
                ) : (
                  <ul className="space-y-1.5">
                    {c.run.retrieved.map((r) => (
                      <li key={r.memoryId} className="flex items-start gap-1.5 text-[12.5px] [&>*:last-child]:min-w-0">
                        <MemoryRef id={r.memoryId} version={r.version} onClick={() => setMemoryId(r.memoryId)} />
                        <CategoryBadge category={r.category} />
                        <span className="text-ink-soft">{r.statement}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="mt-4">
                <p className="label mb-1.5">Brief</p>
                <p className="text-[13px] text-ink-soft">{c.run.brief?.summary}</p>
              </div>
              <div className="mt-4">
                <p className="label mb-1.5">Proposed follow-ups</p>
                <ActionList run={c.run} compact />
                <p className="mt-2 text-[11px] text-muted">
                  {[...taskTitles(c.run)].filter((k) => all.some((s, j) => j !== i && !s.has(k))).length} task(s) differ from at least one other column
                </p>
              </div>
            </section>
          ))}
        </div>
      )}
      {memoryId && <MemoryDrawer memoryId={memoryId} onClose={() => setMemoryId(null)} />}
    </div>
  );
}
