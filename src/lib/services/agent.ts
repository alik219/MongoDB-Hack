import { authorizeClient, notFound, type AuthContext } from "../auth";
import { cosine, demoEmbed, embed } from "../ai/embeddings";
import { evaluateAll, FACT_KEYS, productsForRequest, type Facts, type LenderCheck } from "../lender/engine";
import { getPlanner, type Planner, type PlannerInput } from "../ai/planner";
import { getConfig, serviceLabels } from "../config";
import { canSeeMemory, effectiveStatus, eligibility, retrievalFilter } from "../policy";
import { getStore } from "../store";
import type { ScoredMemory, Store } from "../store/types";
import {
  PlanOutputSchema,
  type AppliedAction,
  type Brief,
  type Client,
  type Memory,
  type PlanAction,
  type PlanOutput,
  type PolicyDecision,
  type RejectedAction,
  type RetrievedMemoryRef,
  type Run,
  type RunStage,
  type RunTrace,
  type Task,
  type TaskDependency,
} from "../types";
import { clock, newId, nowIso } from "../util";
import { audit, canSeeTask, OPEN_TASK_STATUSES, structuredMemoryFallback, taskVisibility } from "./common";

export type MemoryMode = "persistent" | "none" | "original_snapshot";

export interface RunOptions {
  /** Test/compare injection. Defaults to the configured planner. */
  planner?: Planner;
  plannerLabel?: string;
  memoryMode?: MemoryMode;
  /** false = dry run for the comparison view: nothing is written. */
  persist?: boolean;
  /** Hold open tasks constant (comparison view uses an empty set). */
  ignoreOpenTasks?: boolean;
  /** Called after planning, before revalidation (tests use it to change memory mid-run). */
  beforePersist?: () => Promise<void>;
}

const RETRIEVAL_LIMIT = 12;

class StageTimer {
  stages: RunStage[] = [];
  private t = Date.now();
  done(key: string, label: string, detail: string, status: RunStage["status"] = "done") {
    const now = Date.now();
    this.stages.push({ key, label, status, ms: now - this.t, detail });
    this.t = now;
  }
}

function freshness(m: Pick<Memory, "reviewAt">, now: Date): RetrievedMemoryRef["freshness"] {
  return m.reviewAt && new Date(m.reviewAt) <= now ? "review_due" : "current";
}

function ownerFor(role: PlanAction["ownerRole"], client: Client, users: { _id: string; role: string }[]) {
  if (role === "associate") {
    const a = users.find((u) => u.role === "associate" && client.teamUserIds.includes(u._id));
    if (a) return a._id;
  }
  return client.leadAdvisorId;
}

/**
 * The "with approved memory" snapshot for the comparison view: memory as it stood just before the
 * first correction (the earliest confirmed version > 1). Reconstructed from version history.
 */
async function originalSnapshot(store: Store, ctx: AuthContext, clientId: string, queryVector: number[]) {
  const now = clock.now();
  const all = await store.memories.find({
    firmId: ctx.firmId,
    clientId,
    status: { $in: ["active", "superseded"] },
  });
  const corrections = all.filter((m) => m.version > 1 && m.confirmedAt).map((m) => m.confirmedAt!);
  const cutoff = corrections.length ? corrections.sort()[0] : "9999";
  const byLineage = new Map<string, Memory>();
  for (const m of all.sort((a, b) => a.version - b.version)) {
    if (!m.confirmedAt || m.confirmedAt >= cutoff) continue;
    byLineage.set(m.lineageId, m); // latest version confirmed before the cutoff
  }
  return [...byLineage.values()]
    .filter((m) => canSeeMemory(m, ctx) && !(m.expiresAt && new Date(m.expiresAt) <= now) && (m.embedding || m.embeddingText))
    .map((m) => {
      const { embedding, embeddingText, ...rest } = m;
      // Auto-embedded memories have no vector in the app; rank them with the demo hash model (ranking only).
      const v = embedding && embedding.length === queryVector.length ? embedding : demoEmbed(embeddingText ?? m.statement, queryVector.length);
      return { ...rest, similarity: cosine(queryVector, v) } as ScoredMemory;
    })
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, RETRIEVAL_LIMIT);
}

export interface RunResult {
  run: Run;
  tasks: Task[];
}

export async function runAgent(
  ctx: AuthContext,
  clientId: string,
  request: string,
  opts: RunOptions = {},
): Promise<RunResult> {
  const store = await getStore();
  const cfg = getConfig();
  const labels = serviceLabels(cfg);
  const started = Date.now();
  const timer = new StageTimer();
  const memoryMode = opts.memoryMode ?? "persistent";
  const persist = opts.persist ?? true;
  const { planner, label: plannerLabel } = opts.planner
    ? { planner: opts.planner, label: opts.plannerLabel ?? "custom" }
    : getPlanner();

  const run: Run = {
    _id: newId("run"),
    firmId: ctx.firmId,
    clientId,
    actorId: ctx.userId,
    request: (request ?? "").trim().slice(0, 1000),
    services: {
      storage: labels.storage,
      embeddings: labels.embeddings,
      planner: opts.planner ? plannerLabel : labels.planner,
    },
    status: "completed",
    stages: [],
    retrieved: [],
    pendingChanges: [],
    policy: [],
    brief: null,
    proposedActions: [],
    appliedActions: [],
    rejectedActions: [],
    errors: [],
    createdAt: nowIso(),
    durationMs: 0,
  };

  const finish = async (status: Run["status"]) => {
    run.status = status;
    run.stages = timer.stages;
    run.durationMs = Date.now() - started;
    if (persist) await store.runs.insertOne(run);
    const tasks = persist ? await listTasksInternal(store, ctx, clientId) : [];
    return { run, tasks };
  };

  // 1. Access — derived from the session; throws on cross-firm or unassigned client.
  if (run.request.length < 3) throw new Error("Task request is required.");
  const client = await authorizeClient(ctx, clientId);
  run.policy.push({
    rule: "scope",
    outcome: `Firm and client derived from session (${ctx.user.name}, ${ctx.role.replace("_", " ")}). Other clients and firms are never queried.`,
  });
  timer.done("access", "Checking access", `${ctx.user.name} is assigned to ${client.name}`);

  try {
    // 2. Load current open follow-ups.
    const openTasks = opts.ignoreOpenTasks
      ? []
      : (
          await store.tasks.find({
            firmId: ctx.firmId,
            clientId,
            status: { $in: [...OPEN_TASK_STATUSES] },
          })
        ).filter((t) => canSeeTask(t, ctx));
    timer.done("load", "Loading open follow-ups", `${openTasks.length} open task(s)`);

    // 3. Retrieve: Atlas Vector Search with the authorization pre-filter.
    const now = clock.now();
    let candidates: ScoredMemory[] = [];
    let vectorFallback = false;
    const trace: RunTrace = {
      retrieval: null,
      policies: [],
      factsLoaded: 0,
      planner: { provider: cfg.planner.provider, model: cfg.planner.model, memoriesSent: 0, lenderChecksSent: 0, openTasksSent: 0 },
    };
    run.trace = trace;
    if (memoryMode === "none") {
      timer.done("retrieve", "Retrieving memories", "Skipped: memory disabled for this comparison", "skipped");
    } else {
      const queryText = `${client.name}. ${run.request}`;
      const auto = cfg.embedding.provider === "atlas-auto";
      const [queryVector] = auto ? [demoEmbed(queryText, 256)] : await embed([queryText], "query");
      if (memoryMode === "original_snapshot") {
        candidates = await originalSnapshot(store, ctx, clientId, queryVector);
        trace.retrieval = {
          engine: "version history (in-app ranking)",
          index: null,
          path: null,
          queryMode: "version_history",
          queryText,
          embeddingModel: cfg.embedding.id,
          numCandidates: 0,
          limit: RETRIEVAL_LIMIT,
          filterJson: JSON.stringify({ firmId: ctx.firmId, clientId }),
          returned: candidates.length,
          droppedAfterRecheck: 0,
        };
        timer.done(
          "retrieve",
          "Retrieving memories",
          `${candidates.length} memories as confirmed before the first correction (reconstructed from version history, ranked in-app)`,
        );
      } else {
        const filter = retrievalFilter(ctx, clientId, now, cfg.embedding.id);
        let vectorError: string | null = null;
        try {
          candidates = await store.vectorSearchMemories({
            ...(auto ? { queryText } : { queryVector }),
            filter,
            limit: RETRIEVAL_LIMIT,
            numCandidates: RETRIEVAL_LIMIT * 20,
          });
        } catch (err) {
          // Vector search can be briefly unavailable (embedding provider rate limit). Access rules still apply in code.
          vectorError = (err as Error).message.slice(0, 200);
          candidates = await structuredMemoryFallback(store, ctx, clientId, now, RETRIEVAL_LIMIT * 2);
          vectorFallback = true;
          run.errors.push(`Vector search unavailable, used structured retrieval instead: ${vectorError}`);
        }
        trace.retrieval = {
          engine: vectorFallback
            ? "structured fallback (vector search unavailable)"
            : store.kind === "atlas"
              ? "Atlas $vectorSearch"
              : "demo cosine search (in-process)",
          index: store.kind === "atlas" ? (process.env.ATLAS_VECTOR_INDEX ?? "memory_vector_index") : null,
          path: store.kind === "atlas" ? (auto ? "embeddingText" : "embedding") : null,
          queryMode: auto ? "auto_embed_text" : "query_vector",
          queryText,
          embeddingModel: cfg.embedding.id,
          numCandidates: RETRIEVAL_LIMIT * 20,
          limit: RETRIEVAL_LIMIT,
          filterJson: JSON.stringify(filter),
          returned: candidates.length,
          droppedAfterRecheck: 0,
        };
        timer.done(
          "retrieve",
          "Retrieving memories",
          `${candidates.length} candidate(s) via ${vectorFallback ? "structured fallback (vector search unavailable)" : store.kind === "atlas" ? "Atlas $vectorSearch" : "demo cosine search"} with firm/client/status/expiry/access ${vectorFallback ? "checks in code" : "pre-filter"}`,
        );
      }
    }

    // 4. Provenance, freshness, conflicts and access (defense in depth).
    const eligible: ScoredMemory[] = [];
    for (const m of candidates) {
      const e =
        memoryMode === "original_snapshot"
          ? m.firmId === ctx.firmId && m.clientId === clientId
            ? ({ ok: true } as const)
            : ({ ok: false, reason: "wrong_scope" } as const)
          : eligibility(m as Memory, ctx, clientId, now, vectorFallback ? undefined : cfg.embedding.id);
      if (e.ok && m.evidence.length) eligible.push(m);
      else run.errors.push(`Dropped retrieved memory ${m._id}: ${e.ok ? "no supporting evidence" : e.reason}`);
    }
    if (trace.retrieval) trace.retrieval.droppedAfterRecheck = candidates.length - eligible.length;
    // 4b. Lender policies: structured (not vector) retrieval of every authorized financial fact,
    // then a deterministic rule engine. The model never decides eligibility; it only sees the result.
    let lenderChecks: LenderCheck[] = [];
    if (client.segment === "retail" || client.segment === "business") {
      let factMems: ScoredMemory[] = [];
      if (memoryMode === "persistent") {
        factMems = (await store.memories.find({ firmId: ctx.firmId, clientId, category: "financial_fact", status: "active" }))
          .filter((m) => eligibility(m, ctx, clientId, now).ok && m.evidence.length)
          .map(({ embedding: _e, embeddingText: _t, ...m }) => ({ ...m, similarity: 0 }) as ScoredMemory);
        for (const f of factMems) if (!eligible.some((e) => e._id === f._id)) eligible.push(f);
      } else if (memoryMode === "original_snapshot") {
        factMems = eligible.filter((m) => m.category === "financial_fact");
      }
      const facts: Facts = {};
      for (const m of [...factMems].sort((a, b) => (a.confirmedAt ?? "").localeCompare(b.confirmedAt ?? ""))) {
        for (const [k, v] of Object.entries(m.structured.attributes)) {
          if (k in FACT_KEYS && typeof v === "number") {
            facts[k] = { key: k, value: v, memoryId: m._id, lineageId: m.lineageId, version: m.version, statement: m.statement };
          }
        }
      }
      const policies = await store.lenderPolicies.find({ status: "current" });
      lenderChecks = evaluateAll(policies, facts, productsForRequest(run.request));
      run.lenderChecks = lenderChecks;
      trace.factsLoaded = Object.keys(facts).length;
      trace.policies = policies
        .filter((p) => lenderChecks.some((c) => c.policyId === p._id))
        .map((p) => ({
          policyId: p._id,
          bank: p.bank,
          product: p.product,
          version: p.version,
          effectiveDate: p.effectiveDate,
          contentHash: p.contentHash,
          sourceFile: p.sourceFile,
        }));
      const tally = (d: string) => lenderChecks.filter((c) => c.decision === d).length;
      timer.done(
        "lender",
        "Checking lender policies",
        `${Object.keys(facts).length} authorized fact(s) from ${factMems.length} memories · ${lenderChecks.length} policy check(s): ${tally("approve")} approve, ${tally("refer")} refer, ${tally("decline")} decline`,
      );
    } else {
      timer.done("lender", "Checking lender policies", "Not applicable: commercial client outside the retail and small-business policies", "skipped");
    }

    run.retrieved = eligible.map((m) => ({
      memoryId: m._id,
      lineageId: m.lineageId,
      version: m.version,
      category: m.category,
      statement: m.statement,
      similarity: Number(m.similarity.toFixed(4)),
      freshness: freshness(m, now),
    }));

    if (memoryMode !== "none") {
      const scoped = await store.memories.find({ firmId: ctx.firmId, clientId });
      const counts: Record<string, number> = {};
      for (const m of scoped) {
        if (eligible.some((x) => x._id === m._id)) continue;
        const status = effectiveStatus(m, now);
        const reason = !canSeeMemory(m, ctx)
          ? "restricted (not authorized for this user)"
          : status === "active"
            ? memoryMode === "original_snapshot"
              ? "not in original snapshot"
              : "below retrieval limit"
            : status;
        counts[reason] = (counts[reason] ?? 0) + 1;
      }
      const policy: PolicyDecision[] = Object.entries(counts).map(([outcome, count]) => ({
        rule: "excluded",
        outcome,
        count,
      }));
      run.policy.push(...policy);
    }

    const pending =
      memoryMode === "persistent"
        ? (await store.memories.find({ firmId: ctx.firmId, clientId, status: "proposed" })).filter(
            (p) => canSeeMemory(p, ctx) && p.proposal?.targetMemoryId && eligible.some((e) => e._id === p.proposal!.targetMemoryId),
          )
        : [];
    run.pendingChanges = pending.map((p) => ({
      memoryId: p._id,
      kind: p.proposal!.kind,
      summary: p.proposal!.changeSummary ?? p.statement,
    }));
    const reviewDue = run.retrieved.filter((r) => r.freshness === "review_due").length;
    timer.done(
      "check",
      "Checking freshness & conflicts",
      `${eligible.length} eligible · ${reviewDue} due for reconfirmation · ${pending.length} unconfirmed change(s)`,
    );

    // 5. Plan.
    const input: PlannerInput = {
      clientName: client.name,
      request: run.request,
      today: now.toISOString().slice(0, 10),
      memories: eligible.map((m) => ({
        id: m._id,
        version: m.version,
        category: m.category,
        statement: m.statement,
        topic: m.structured.topic,
        attributes: m.structured.attributes,
        basis: m.basis,
        lastConfirmedAt: m.lastConfirmedAt,
        reviewDue: freshness(m, now) === "review_due",
        visibility: m.visibility,
      })),
      pendingChanges: pending.map((p) => ({
        id: p._id,
        kind: p.proposal!.kind,
        topic: p.structured.topic,
        statement: p.statement,
        targetMemoryId: p.proposal!.targetMemoryId,
        targetStatement: eligible.find((e) => e._id === p.proposal!.targetMemoryId)?.statement,
      })),
      lenderChecks: lenderChecks.map((c) => ({
        bank: c.bank,
        product: c.product,
        policyId: c.policyId,
        decision: c.decision,
        summary: c.summary,
        offer: c.offer ?? null,
        factMemoryIds: [...new Set(c.factsUsed.map((f) => f.memoryId).filter((x): x is string => Boolean(x)))],
        pivotalFacts: c.pivotalFacts.map((p) => ({ factKey: p.factKey, memoryId: p.memoryId ?? null, decisionWithout: p.decisionWithout })),
      })),
      openTasks: openTasks.map((t) => ({
        id: t._id,
        key: t.key,
        title: t.title,
        status: t.status,
        needsReview: t.needsReview,
        reviewReasons: t.reviewReasons.map((r) => r.reason),
        dependsOn: t.dependsOn.map((d) => ({ memoryId: d.memoryId, version: d.version })),
        gatedOnKeys: t.gatedOnKeys,
      })),
    };
    trace.planner.memoriesSent = input.memories.length;
    trace.planner.lenderChecksSent = input.lenderChecks?.length ?? 0;
    trace.planner.openTasksSent = input.openTasks.length;
    let plan: PlanOutput;
    try {
      plan = await planner(input);
    } catch (err) {
      run.errors.push(`Planner failed: ${(err as Error).message}`);
      timer.done("plan", "Preparing follow-ups", "Planner unavailable or returned an error", "failed");
      return finish("failed");
    }
    timer.done("plan", "Preparing follow-ups", `${plan.actions.length} proposed action(s) from ${run.services.planner}`);

    // 6. Schema + citation validation.
    const parsed = PlanOutputSchema.safeParse(plan);
    if (!parsed.success) {
      run.errors.push(`Planner output failed schema validation: ${parsed.error.message}`);
      timer.done("validate", "Validating output", "Schema validation failed", "failed");
      return finish("failed");
    }
    plan = parsed.data;
    run.proposedActions = plan.actions;
    const eligibleIds = new Map(eligible.map((m) => [m._id, m]));
    const filterPoints = (pts: Brief["context"]) =>
      pts.map((p) => {
        const bad = p.memoryIds.filter((id) => !eligibleIds.has(id));
        if (bad.length) run.errors.push(`Brief cited unauthorized or unknown memory id(s): ${bad.join(", ")} (removed)`);
        return { ...p, memoryIds: p.memoryIds.filter((id) => eligibleIds.has(id)) };
      });
    run.brief = {
      summary: plan.brief.summary,
      context: filterPoints(plan.brief.context),
      missingInformation: filterPoints(plan.brief.missingInformation),
      conflicts: filterPoints(plan.brief.conflicts),
    };

    const users = await store.users.find({ firmId: ctx.firmId, _id: { $in: client.teamUserIds } });
    const openById = new Map(openTasks.map((t) => [t._id, t]));
    const openByKey = new Map(openTasks.map((t) => [t.key, t]));
    const valid: (PlanAction & { target?: Task })[] = [];
    const seenKeys = new Set<string>();
    for (const a of plan.actions) {
      const reject = (reason: string) => run.rejectedActions.push({ action: a, reason } as RejectedAction);
      const badCites = a.memoryIds.filter((id) => !eligibleIds.has(id));
      if (badCites.length) {
        reject(`Cites memory id(s) that are not in the authorized, eligible context: ${badCites.join(", ")}`);
        continue;
      }
      if (seenKeys.has(a.taskKey)) {
        reject("Duplicate taskKey in the same plan");
        continue;
      }
      let target: Task | undefined;
      if (a.type === "create_task") {
        target = openByKey.get(a.taskKey);
        if (target) {
          // Reconcile: never create a duplicate open task.
          valid.push({ ...a, type: "revise_task", taskId: target._id, target });
          seenKeys.add(a.taskKey);
          continue;
        }
      } else {
        target = (a.taskId && openById.get(a.taskId)) || openByKey.get(a.taskKey);
        if (!target) {
          reject(`${a.type} refers to a task that is not an open task for this client`);
          continue;
        }
      }
      seenKeys.add(a.taskKey);
      valid.push({ ...a, target });
    }
    timer.done(
      "validate",
      "Validating output & citations",
      `${valid.length} valid · ${run.rejectedActions.length} rejected`,
    );

    if (!persist) {
      run.appliedActions = valid.map((a) => ({
        type: a.type,
        taskId: a.target?._id ?? "(dry run)",
        taskKey: a.taskKey,
        title: a.title,
        rationale: a.rationale,
        memoryRefs: a.memoryIds.map((id) => ({
          memoryId: id,
          lineageId: eligibleIds.get(id)!.lineageId,
          version: eligibleIds.get(id)!.version,
        })),
      }));
      timer.done("save", "Saving tasks", "Dry run: nothing persisted", "skipped");
      return finish("completed");
    }

    if (opts.beforePersist) await opts.beforePersist();

    // 7. Revalidate cited memory versions right before writing (they may have changed mid-run).
    const cited = [...new Set(valid.flatMap((a) => a.memoryIds))];
    const fresh = await store.memories.find({ _id: { $in: cited }, firmId: ctx.firmId });
    const nowCheck = clock.now();
    const staleProblems: string[] = [];
    for (const id of cited) {
      const m = fresh.find((f) => f._id === id);
      const original = eligibleIds.get(id)!;
      if (!m) staleProblems.push(`${id} no longer exists`);
      else {
        const e = eligibility(m, ctx, clientId, nowCheck);
        if (!e.ok) staleProblems.push(`${id} (v${original.version}) is now ${e.reason}`);
        else if (m.version !== original.version) staleProblems.push(`${id} changed version`);
      }
    }
    if (staleProblems.length) {
      run.staleReason = `Memory changed during the run: ${staleProblems.join("; ")}. No tasks were saved; run again.`;
      run.errors.push(run.staleReason);
      timer.done("save", "Revalidating & saving tasks", "Stale result: nothing persisted", "failed");
      await audit(store, ctx, "run.stale", run._id, clientId, { problems: staleProblems });
      return finish("stale");
    }

    // 8. Persist task changes.
    const at = nowIso();
    const createdByKey = new Map<string, string>();
    const currentByLineage = new Map(eligible.map((m) => [m.lineageId, m]));
    const changeExplanation = (t: Task) =>
      t.dependsOn
        .map((d) => {
          const cur = currentByLineage.get(d.lineageId);
          if (!cur) {
            const reason = t.reviewReasons.find((r) => r.lineageId === d.lineageId)?.reason;
            return `Memory ${d.memoryId} (v${d.version}) is no longer eligible${reason ? `: ${reason}` : ""}`;
          }
          if (cur.version !== d.version) return `Memory v${d.version} → v${cur.version}: "${cur.statement}"`;
          return "";
        })
        .filter(Boolean);

    for (const a of valid) {
      const deps: TaskDependency[] = a.memoryIds.map((id) => ({
        memoryId: id,
        lineageId: eligibleIds.get(id)!.lineageId,
        version: eligibleIds.get(id)!.version,
      }));
      const depDocs = a.memoryIds.map((id) => eligibleIds.get(id)!);
      const vis = taskVisibility(depDocs);
      let ownerId = ownerFor(a.ownerRole, client, users);
      if (vis.visibility === "restricted" && !vis.allowedUserIds.includes(ownerId)) ownerId = client.leadAdvisorId;
      const applied: AppliedAction = {
        type: a.type,
        taskId: a.target?._id ?? "",
        taskKey: a.taskKey,
        title: a.title,
        rationale: a.rationale,
        memoryRefs: deps,
      };

      if (a.type === "create_task") {
        const replaced = a.replacesTaskKey ? openByKey.get(a.replacesTaskKey) : undefined;
        const task: Task = {
          _id: newId("tsk"),
          firmId: ctx.firmId,
          clientId,
          key: a.taskKey,
          title: a.title,
          detail: a.detail,
          rationale: a.rationale,
          ownerId,
          status: "draft",
          needsReview: false,
          reviewReasons: [],
          dependsOn: deps,
          gatedOnKeys: a.gatedOnKeys,
          ...vis,
          createdByRunId: run._id,
          lastRunId: run._id,
          replacesTaskId: replaced?._id,
          history: [{ at, actor: "agent", runId: run._id, action: "created", note: a.rationale }],
          createdAt: at,
          updatedAt: at,
        };
        await store.tasks.insertOne(task);
        createdByKey.set(a.taskKey, task._id);
        applied.taskId = task._id;
        if (replaced) applied.changedBecause = changeExplanation(replaced);
      } else if (a.type === "revise_task") {
        const t = a.target!;
        const because = changeExplanation(t);
        applied.changedBecause = because.length ? because : t.reviewReasons.map((r) => r.reason);
        if (t.status === "approved") {
          // Approved tasks are not rewritten by the agent; the advisor decides.
          applied.type = "flag_for_review";
          await store.tasks.updateOne(
            { _id: t._id },
            {
              $set: { needsReview: true, lastRunId: run._id, updatedAt: at },
              $push: {
                history: { at, actor: "agent", runId: run._id, action: "revision_suggested", note: `${a.title}. ${a.rationale}` },
              },
            },
          );
        } else {
          await store.tasks.updateOne(
            { _id: t._id, status: "draft" },
            {
              $set: {
                title: a.title,
                detail: a.detail,
                rationale: a.rationale,
                dependsOn: deps,
                gatedOnKeys: a.gatedOnKeys,
                ownerId,
                ...vis,
                needsReview: false,
                reviewReasons: [],
                lastRunId: run._id,
                updatedAt: at,
              },
              $push: {
                history: {
                  at,
                  actor: "agent",
                  runId: run._id,
                  action: "revised",
                  note: applied.changedBecause.length ? applied.changedBecause.join(" ") : a.rationale,
                },
              },
            },
          );
        }
      } else if (a.type === "withdraw_task") {
        const t = a.target!;
        applied.changedBecause = changeExplanation(t);
        if (t.status === "approved") {
          applied.type = "flag_for_review";
          await store.tasks.updateOne(
            { _id: t._id },
            {
              $set: { needsReview: true, lastRunId: run._id, updatedAt: at },
              $push: { history: { at, actor: "agent", runId: run._id, action: "withdrawal_suggested", note: a.rationale } },
            },
          );
        } else {
          await store.tasks.updateOne(
            { _id: t._id, status: "draft" },
            {
              $set: { status: "withdrawn", withdrawnReason: a.rationale, lastRunId: run._id, updatedAt: at, needsReview: false },
              $push: { history: { at, actor: "agent", runId: run._id, action: "withdrawn", note: a.rationale } },
            },
          );
        }
      } else {
        await store.tasks.updateOne({ _id: a.target!._id }, { $set: { lastRunId: run._id } });
      }
      run.appliedActions.push(applied);
    }
    // Link replacements both ways.
    for (const a of valid) {
      if (a.type !== "create_task" || !a.replacesTaskKey) continue;
      const old = openByKey.get(a.replacesTaskKey);
      const newId_ = createdByKey.get(a.taskKey);
      if (old && newId_) await store.tasks.updateOne({ _id: old._id }, { $set: { replacedByTaskId: newId_ } });
    }
    const tally = run.appliedActions.reduce<Record<string, number>>((acc, x) => {
      const k = x.type.replace("_task", "").replace(/_/g, " ");
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {});
    timer.done(
      "save",
      "Revalidating & saving tasks",
      Object.entries(tally)
        .map(([k, v]) => `${v} ${k}`)
        .join(" · ") || "No changes",
    );
    await audit(store, ctx, "run.completed", run._id, clientId, {
      applied: run.appliedActions.length,
      rejected: run.rejectedActions.length,
    });
    return finish("completed");
  } catch (err) {
    run.errors.push((err as Error).message);
    timer.done("error", "Run failed", (err as Error).message, "failed");
    return finish("failed");
  }
}

async function listTasksInternal(store: Store, ctx: AuthContext, clientId: string) {
  return (await store.tasks.find({ firmId: ctx.firmId, clientId }, { sort: { createdAt: -1 } })).filter((t) =>
    canSeeTask(t, ctx),
  );
}

export async function listRuns(ctx: AuthContext, clientId: string) {
  const store = await getStore();
  await authorizeClient(ctx, clientId);
  const runs = await store.runs.find({ firmId: ctx.firmId, clientId }, { sort: { createdAt: -1 }, limit: 30 });
  return Promise.all(runs.map((r) => redactRunForViewer(store, r, ctx)));
}

export async function getRun(ctx: AuthContext, runId: string) {
  const store = await getStore();
  const r = await store.runs.findOne({ _id: runId, firmId: ctx.firmId });
  if (!r) throw notFound("Run not found");
  await authorizeClient(ctx, r.clientId);
  return redactRunForViewer(store, r, ctx);
}

/**
 * Run records are evidence, and they are authorization-checked like any other read:
 * a teammate viewing a run made by someone with broader access sees restricted memory
 * references and the actions/brief points that relied on them masked.
 */
async function redactRunForViewer(store: Store, r: Run, ctx: AuthContext): Promise<Run & { hiddenForViewer: number }> {
  const ids = [
    ...new Set([
      ...r.retrieved.map((x) => x.memoryId),
      ...r.appliedActions.flatMap((a) => a.memoryRefs.map((m) => m.memoryId)),
      ...(r.lenderChecks ?? []).flatMap((c) => c.factsUsed.map((f) => f.memoryId ?? "")),
    ]),
  ].filter(Boolean);
  const mems = await store.memories.find({ _id: { $in: ids }, firmId: ctx.firmId });
  const hidden = new Set(mems.filter((m) => !canSeeMemory(m, ctx)).map((m) => m._id));
  if (!hidden.size) return { ...r, hiddenForViewer: 0 };
  const maskPts = (pts: Brief["context"]) =>
    pts.filter((p) => !p.memoryIds.some((id) => hidden.has(id)));
  const touchesHidden = (refs: string[]) => refs.some((id) => hidden.has(id));
  return {
    ...r,
    retrieved: r.retrieved.filter((x) => !hidden.has(x.memoryId)),
    brief: r.brief
      ? {
          ...r.brief,
          context: maskPts(r.brief.context),
          missingInformation: maskPts(r.brief.missingInformation),
          conflicts: maskPts(r.brief.conflicts),
        }
      : null,
    proposedActions: r.proposedActions.filter((a) => !touchesHidden(a.memoryIds)),
    appliedActions: r.appliedActions.filter((a) => !touchesHidden(a.memoryRefs.map((m) => m.memoryId))),
    // A decision computed from a restricted fact (e.g. an exact credit score) would reveal it: hide the whole check.
    lenderChecks: r.lenderChecks?.filter((c) => !touchesHidden(c.factsUsed.map((f) => f.memoryId ?? ""))),
    hiddenForViewer: hidden.size,
  };
}
