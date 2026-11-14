import { authorizeClient, badRequest, conflict, denied, isLeadAdvisor, notFound, type AuthContext } from "../auth";
import { eligibility } from "../policy";
import { getStore } from "../store";
import { clock, nowIso } from "../util";
import { audit, canSeeTask } from "./common";
import { effectiveStatus } from "../policy";

export async function listTasks(ctx: AuthContext, clientId: string) {
  const store = await getStore();
  await authorizeClient(ctx, clientId);
  const all = await store.tasks.find({ firmId: ctx.firmId, clientId }, { sort: { createdAt: -1 } });
  const visible = all.filter((t) => canSeeTask(t, ctx));
  return { tasks: visible, hiddenRestricted: all.length - visible.length };
}

/** "Why this?": the exact supporting memory versions and source excerpts, authorization-checked. */
export async function explainTask(ctx: AuthContext, taskId: string) {
  const store = await getStore();
  const t = await store.tasks.findOne({ _id: taskId, firmId: ctx.firmId });
  if (!t) throw notFound("Task not found");
  await authorizeClient(ctx, t.clientId);
  if (!canSeeTask(t, ctx)) throw denied("This task relies on restricted memories.");
  const now = clock.now();
  const memories = await store.memories.find({ _id: { $in: t.dependsOn.map((d) => d.memoryId) }, firmId: ctx.firmId });
  const lineageIds = t.dependsOn.map((d) => d.lineageId);
  const current = await store.memories.find({ firmId: ctx.firmId, lineageId: { $in: lineageIds }, status: "active" });
  const sources = await store.sources.find({
    firmId: ctx.firmId,
    _id: { $in: memories.flatMap((m) => m.evidence.map((e) => e.sourceId)) },
  });
  const runIds = [...new Set([t.createdByRunId, t.lastRunId, ...t.history.map((h) => h.runId).filter(Boolean)])] as string[];
  const runs = await store.runs.find({ _id: { $in: runIds }, firmId: ctx.firmId });
  return {
    task: t,
    support: t.dependsOn.map((d) => {
      const m = memories.find((x) => x._id === d.memoryId);
      const cur = current.find((x) => x.lineageId === d.lineageId);
      return {
        ...d,
        statement: m?.statement ?? "[unavailable]",
        category: m?.category,
        basis: m?.basis,
        status: m ? effectiveStatus(m, now) : "missing",
        currentVersion: cur && effectiveStatus(cur, now) === "active" ? cur.version : null,
        currentStatement: cur && cur._id !== d.memoryId ? cur.statement : null,
        evidence: (m?.evidence ?? []).map((e) => ({
          ...e,
          sourceTitle: sources.find((s) => s._id === e.sourceId)?.title ?? "Source",
        })),
      };
    }),
    runs: runs.map((r) => ({ _id: r._id, createdAt: r.createdAt, request: r.request, status: r.status })),
  };
}

export async function taskAction(
  ctx: AuthContext,
  taskId: string,
  action: "approve" | "withdraw" | "complete" | "reopen",
  note?: string,
) {
  const store = await getStore();
  const t = await store.tasks.findOne({ _id: taskId, firmId: ctx.firmId });
  if (!t) throw notFound("Task not found");
  const client = await authorizeClient(ctx, t.clientId);
  if (!canSeeTask(t, ctx)) throw denied("This task relies on restricted memories.");
  const at = nowIso();
  const lead = isLeadAdvisor(ctx, client);

  if (action === "approve") {
    if (!lead) throw denied("Only the lead advisor can approve follow-ups. The agent and teammates can only prepare drafts.");
    if (t.status !== "draft") throw conflict("Only draft tasks can be approved.");
    if (t.needsReview) throw conflict("This task is marked for review because a supporting memory changed. Run the agent again or withdraw it.");
    // Revalidate the exact memory versions this task depends on.
    const deps = await store.memories.find({ _id: { $in: t.dependsOn.map((d) => d.memoryId) }, firmId: ctx.firmId });
    const problems = t.dependsOn.filter((d) => {
      const m = deps.find((x) => x._id === d.memoryId);
      return !m || m.version !== d.version || !eligibility(m, ctx, t.clientId, clock.now()).ok;
    });
    if (problems.length) {
      throw conflict(`Stale: ${problems.length} supporting memory version(s) are no longer current. Regenerate before approving.`);
    }
    await store.tasks.updateOne(
      { _id: t._id, status: "draft" },
      {
        $set: { status: "approved", approvedBy: ctx.userId, approvedAt: at, updatedAt: at },
        $push: { history: { at, actor: ctx.userId, action: "approved", note: note ?? "" } },
      },
    );
  } else if (action === "withdraw") {
    if (!lead && t.ownerId !== ctx.userId) throw denied("Only the lead advisor or the task owner can withdraw it.");
    if (!["draft", "approved"].includes(t.status)) throw conflict("Only open tasks can be withdrawn.");
    await store.tasks.updateOne(
      { _id: t._id },
      {
        $set: { status: "withdrawn", withdrawnReason: note || "Withdrawn by advisor", updatedAt: at, needsReview: false },
        $push: { history: { at, actor: ctx.userId, action: "withdrawn", note: note ?? "" } },
      },
    );
  } else if (action === "complete") {
    if (!lead && t.ownerId !== ctx.userId) throw denied("Only the lead advisor or the task owner can complete it.");
    if (t.status !== "approved") throw conflict("Approve the task before marking it done.");
    await store.tasks.updateOne(
      { _id: t._id },
      {
        $set: { status: "done", updatedAt: at },
        $push: { history: { at, actor: ctx.userId, action: "completed", note: note ?? "" } },
      },
    );
  } else if (action === "reopen") {
    if (!lead) throw denied("Only the lead advisor can reopen tasks.");
    if (t.status !== "withdrawn") throw conflict("Only withdrawn tasks can be reopened.");
    await store.tasks.updateOne(
      { _id: t._id },
      {
        $set: { status: "draft", needsReview: true, updatedAt: at },
        $push: { history: { at, actor: ctx.userId, action: "reopened", note: note ?? "" } },
      },
    );
  } else {
    throw badRequest("Unknown task action");
  }
  await audit(store, ctx, `task.${action}`, t._id, t.clientId, { note: note ?? "" });
  return store.tasks.findOne({ _id: t._id });
}
