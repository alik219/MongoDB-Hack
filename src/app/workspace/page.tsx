"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, fmtDate, fmtDateTime } from "@/components/api";
import { MemoryDrawer } from "@/components/memory-drawer";
import {
  ActionList,
  BriefView,
  LenderChecksView,
  TraceView,
  RetrievalView,
  RunMeta,
  RunStatusBanner,
  Stages,
  StagesRunning,
  type RunDTO,
} from "@/components/run-view";
import { useSession } from "@/components/session";
import { VoiceAgent } from "@/components/voice-agent";
import { TaskCard, type TaskDTO } from "@/components/task-card";
import { Empty, ErrorState, RestrictedBadge, Section, Skeleton, Spinner, StatusPill } from "@/components/ui";
import { DEFAULT_REQUEST } from "@/lib/samples";

export default function WorkspacePage() {
  const { session, client, clientId, version, refresh } = useSession();
  const [request, setRequest] = useState("");
  const [runs, setRuns] = useState<RunDTO[] | null>(null);
  const [tasks, setTasks] = useState<{ tasks: TaskDTO[]; hiddenRestricted: number } | null>(null);
  const [selectedRun, setSelectedRun] = useState<RunDTO | null>(null);
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState(0);
  const [err, setErr] = useState<unknown>(null);
  const [loadErr, setLoadErr] = useState<unknown>(null);
  const [memoryId, setMemoryId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const names = useMemo(
    () => Object.fromEntries((session?.personas ?? []).map((p) => [p._id, p.name])),
    [session],
  );
  const canApprove = !!client && session?.user._id === client.leadAdvisorId && session?.user.role === "lead_advisor";

  const load = useCallback(async () => {
    if (!clientId) return;
    setLoadErr(null);
    try {
      const [r, t] = await Promise.all([
        api<RunDTO[]>(`/api/runs?clientId=${clientId}`),
        api<{ tasks: TaskDTO[]; hiddenRestricted: number }>(`/api/tasks?clientId=${clientId}`),
      ]);
      setRuns(r);
      setTasks(t);
      setSelectedRun((cur) => (cur && r.some((x) => x._id === cur._id) ? r.find((x) => x._id === cur._id)! : (r[0] ?? null)));
    } catch (e) {
      setLoadErr(e);
    }
  }, [clientId]);

  useEffect(() => {
    setRuns(null);
    setTasks(null);
    setSelectedRun(null);
    setErr(null);
    setRequest(clientId ? (DEFAULT_REQUEST[clientId] ?? "Prepare the quarterly review and create the appropriate follow-ups.") : "");
    void load();
  }, [clientId, version, load]);

  const run = async () => {
    if (!clientId) return;
    setRunning(true);
    setErr(null);
    setStep(0);
    timer.current = setInterval(() => setStep((s) => Math.min(s + 1, 6)), 260);
    try {
      const res = await api<{ run: RunDTO; tasks: TaskDTO[] }>("/api/agent/run", { body: { clientId, request } });
      await load();
      setSelectedRun(res.run);
      void refresh();
    } catch (e) {
      setErr(e);
    } finally {
      if (timer.current) clearInterval(timer.current);
      setRunning(false);
    }
  };

  if (!client) return null;
  const open = tasks?.tasks.filter((t) => t.status === "draft" || t.status === "approved") ?? [];
  const closed = tasks?.tasks.filter((t) => t.status === "done" || t.status === "withdrawn") ?? [];
  const needsReview = open.filter((t) => t.needsReview).length;
  const lastActionByTask = new Map((selectedRun?.appliedActions ?? []).map((a) => [a.taskId, a.type]));
  const actionTag: Record<string, string> = {
    create_task: "New this run",
    revise_task: "Revised this run",
    flag_for_review: "Flagged this run",
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)_420px]">
      {/* Left: client + run history */}
      <div className="space-y-4">
        <section className="card p-4">
          <p className="label">Active client</p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">{client.name}</h1>
          <p className="text-sm text-muted">
            {client.profile.age} · {client.profile.occupation}
          </p>
          <dl className="mt-3 space-y-1.5 text-[13px]">
            <div className="flex justify-between gap-2">
              <dt className="text-muted">Household</dt>
              <dd className="text-right text-ink-soft">{client.profile.household}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted">Lead advisor</dt>
              <dd className="text-ink-soft">{client.leadAdvisorName}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted">Next review</dt>
              <dd className="text-ink-soft">{fmtDate(client.profile.nextReview)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted">Service</dt>
              <dd className="text-ink-soft">{client.profile.serviceTier}</dd>
            </div>
          </dl>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <span className="chip bg-accent-soft text-accent">{client.counts.active} active memories</span>
            {client.counts.proposed > 0 && (
              <Link href="/memory?status=proposed" className="chip bg-info-soft text-info hover:underline">
                {client.counts.proposed} awaiting confirmation
              </Link>
            )}
            {client.counts.expired > 0 && <span className="chip bg-warn-soft text-warn">{client.counts.expired} expired</span>}
            {client.counts.restricted > 0 && <RestrictedBadge names={`${client.counts.restricted} visible to you`} />}
          </div>
        </section>

        <section className="card p-4">
          <p className="label mb-2">Voice agent</p>
          <p className="mb-2 text-[12px] text-muted">
            Ask about {client.name.split(" ")[0]} by voice. It reads only memories you may see and saves new facts as proposals for you to confirm.
          </p>
          <VoiceAgent clientId={client._id} clientName={client.name} />
        </section>

        <section className="card p-4">
          <p className="label mb-2">Run history</p>
          {!runs ? (
            <Skeleton lines={3} />
          ) : runs.length === 0 ? (
            <p className="text-sm text-muted">No agent runs yet for {client.name.split(" ")[0]}.</p>
          ) : (
            <ul className="space-y-1">
              {runs.map((r) => (
                <li key={r._id}>
                  <button
                    onClick={() => setSelectedRun(r)}
                    className={`w-full rounded-lg px-2.5 py-2 text-left text-[12.5px] ${selectedRun?._id === r._id ? "bg-canvas ring-1 ring-line" : "hover:bg-canvas"}`}
                  >
                    <div className="flex items-center gap-1.5">
                      <StatusPill status={r.status} />
                      <span className="text-muted">{fmtDateTime(r.createdAt)}</span>
                    </div>
                    <p className="mt-1 text-ink-soft">
                      {r.retrieved.length} memories ·{" "}
                      {r.appliedActions.filter((a) => a.type !== "keep_task").length} change(s) · {names[r.actorId]?.split(" ")[0]}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Center: request, stages, brief */}
      <div className="min-w-0 space-y-4">
        <section className="card p-4">
          <label className="label" htmlFor="req">
            Ask the agent
          </label>
          <textarea
            id="req"
            className="input mt-2 text-[14px]"
            rows={2}
            value={request}
            onChange={(e) => setRequest(e.target.value)}
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button className="btn-primary" onClick={run} disabled={running || request.trim().length < 3}>
              {running ? <Spinner className="text-white" /> : "▶"} Start fresh agent run
            </button>
            <p className="text-xs text-muted">
              Each run starts with no conversation state. It only knows what it retrieves from memory, scoped to{" "}
              {client.name} and to what {session?.user.name.split(" ")[0]} may see.
            </p>
          </div>
          {running && (
            <div className="mt-4 rounded-lg bg-canvas px-3 py-2.5">
              <StagesRunning step={step} />
            </div>
          )}
          {err != null && (
            <div className="mt-3">
              <ErrorState error={err} onRetry={run} />
            </div>
          )}
        </section>

        {loadErr ? (
          <ErrorState error={loadErr} onRetry={load} />
        ) : !runs ? (
          <section className="card p-4">
            <Skeleton lines={5} />
          </section>
        ) : !selectedRun ? (
          <Empty title="No meeting brief yet">
            Run the agent to prepare a brief. Tip: ingest and confirm the May note on the{" "}
            <Link href="/memory" className="text-accent underline">
              Memory
            </Link>{" "}
            page first.
          </Empty>
        ) : (
          <>
            <RunStatusBanner run={selectedRun} />
            <Section title="Execution" right={<span className="text-[11px] text-muted">{selectedRun.durationMs} ms</span>}>
              <Stages run={selectedRun} />
              <div className="mt-3">
                <RunMeta run={selectedRun} names={names} />
              </div>
            </Section>
            <Section title="Meeting brief">
              <BriefView run={selectedRun} onOpenMemory={setMemoryId} />
            </Section>
            <Section title="What changed in this run">
              <ActionList run={selectedRun} onOpenMemory={setMemoryId} />
            </Section>
            {(selectedRun.lenderChecks?.length ?? 0) > 0 && (
              <Section title="Lender policy checks">
                <LenderChecksView run={selectedRun} onOpenMemory={setMemoryId} />
              </Section>
            )}
            <details className="card p-4" open={false}>
              <summary className="cursor-pointer text-sm font-semibold">
                Retrieved context & policy decisions ({selectedRun.retrieved.length} memories)
              </summary>
              <div className="mt-3">
                <RetrievalView run={selectedRun} onOpenMemory={setMemoryId} />
              </div>
            </details>
            <details className="card p-4" open>
              <summary className="cursor-pointer text-sm font-semibold">Technical trace: query, scores, facts and policy versions</summary>
              <div className="mt-3">
                <TraceView run={selectedRun} onOpenMemory={setMemoryId} />
              </div>
            </details>
          </>
        )}
      </div>

      {/* Right: tasks */}
      <div className="min-w-0 space-y-3 lg:col-span-2 xl:col-span-1">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">
            Follow-up tasks{" "}
            <span className="font-normal text-muted">
              · {open.length} open{needsReview ? ` · ${needsReview} need review` : ""}
            </span>
          </h2>
          {!canApprove && <span className="text-[11px] text-muted">Drafts only · lead advisor approves</span>}
        </div>
        {needsReview > 0 && (
          <div className="rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-[12.5px] text-warn">
            {needsReview} draft{needsReview > 1 ? "s depend" : " depends"} on memories that changed. Start a fresh run to reconcile.
          </div>
        )}
        {!tasks ? (
          <Skeleton lines={4} />
        ) : open.length === 0 ? (
          <Empty title="No open follow-ups">Agent runs create draft tasks here. They persist across runs.</Empty>
        ) : (
          open.map((t) => (
            <TaskCard
              key={t._id}
              task={t}
              names={names}
              canApprove={canApprove}
              onChanged={load}
              onOpenMemory={setMemoryId}
              highlight={selectedRun?._id === runs?.[0]?._id ? actionTag[lastActionByTask.get(t._id) ?? ""] : undefined}
            />
          ))
        )}
        {tasks && tasks.hiddenRestricted > 0 && (
          <p className="text-[12px] text-restricted">
            {tasks.hiddenRestricted} task(s) rely on restricted memories and are hidden from you.
          </p>
        )}
        {closed.length > 0 && (
          <div>
            <button className="btn-ghost -ml-2 text-[12.5px]" onClick={() => setShowHistory((s) => !s)}>
              {showHistory ? "Hide" : "Show"} withdrawn & completed ({closed.length})
            </button>
            {showHistory && (
              <div className="mt-2 space-y-3">
                {closed.map((t) => (
                  <TaskCard key={t._id} task={t} names={names} canApprove={false} onChanged={load} onOpenMemory={setMemoryId} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {memoryId && <MemoryDrawer memoryId={memoryId} onClose={() => setMemoryId(null)} onChanged={() => { void load(); void refresh(); }} />}
    </div>
  );
}
