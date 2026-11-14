"use client";

import { useCallback, useEffect, useState } from "react";
import { api, fmtDateTime, label } from "@/components/api";
import { useSession } from "@/components/session";
import { Empty, ErrorState, Skeleton } from "@/components/ui";

interface Event {
  _id: string;
  type: string;
  targetId: string;
  clientId?: string;
  at: string;
  actorName: string;
  details: Record<string, unknown>;
}

const TONE: Record<string, string> = {
  memory: "bg-accent",
  task: "bg-info",
  run: "bg-accent",
  source: "bg-white/30",
};

export default function ActivityPage() {
  const { clients, version } = useSession();
  const [clientFilter, setClientFilter] = useState("");
  const [events, setEvents] = useState<Event[] | null>(null);
  const [err, setErr] = useState<unknown>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      setEvents(await api(`/api/activity${clientFilter ? `?clientId=${clientFilter}` : ""}`));
    } catch (e) {
      setErr(e);
    }
  }, [clientFilter]);
  useEffect(() => {
    void load();
  }, [load, version]);

  const nameOf = (id?: string) => clients.find((c) => c._id === id)?.name ?? "";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Activity</h1>
          <p className="text-sm text-muted">Minimal audit trail: who changed memory, tasks and runs, and when. Content is not copied here.</p>
        </div>
        <select className="input w-auto" value={clientFilter} onChange={(e) => setClientFilter(e.target.value)}>
          <option value="">All my clients</option>
          {clients.map((c) => (
            <option key={c._id} value={c._id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      {err ? (
        <ErrorState error={err} onRetry={load} />
      ) : !events ? (
        <div className="card p-5">
          <Skeleton lines={6} />
        </div>
      ) : events.length === 0 ? (
        <Empty title="No activity yet" />
      ) : (
        <ol className="card divide-y divide-line">
          {events.map((e) => (
            <li key={e._id} className="flex flex-wrap items-start gap-3 px-4 py-2.5 text-[13px]">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TONE[e.type.split(".")[0]] ?? "bg-white/20"}`} />
              <span className="w-32 shrink-0 text-muted">{fmtDateTime(e.at)}</span>
              <span className="min-w-0 flex-1">
                <span className="font-medium text-ink">{label(e.type.replace(".", " "))}</span>{" "}
                <span className="text-ink-soft">by {e.actorName}</span>
                {e.clientId && <span className="text-muted"> · {nameOf(e.clientId)}</span>}
                <span className="mono ml-2 text-[11px] text-muted">{e.targetId}</span>
                {Object.keys(e.details).length > 0 && (
                  <span className="block text-[11.5px] text-muted">
                    {Object.entries(e.details)
                      .filter(([, v]) => v !== "" && !(Array.isArray(v) && v.length === 0))
                      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.length : typeof v === "object" ? JSON.stringify(v) : v}`)
                      .join(" · ")}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
