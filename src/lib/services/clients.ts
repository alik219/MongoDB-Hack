import { authorizeClient, type AuthContext } from "../auth";
import { getConfig, serviceLabels } from "../config";
import { canSeeMemory, effectiveStatus } from "../policy";
import { getStore } from "../store";
import { clock } from "../util";
import { canSeeTask } from "./common";
import { runAgent } from "./agent";

export async function listClients(ctx: AuthContext) {
  const store = await getStore();
  const clients = (await store.clients.find({ firmId: ctx.firmId, _id: { $in: ctx.user.clientIds } })).filter((c) =>
    c.teamUserIds.includes(ctx.userId),
  );
  const now = clock.now();
  const out = [];
  for (const c of clients) {
    const mems = (await store.memories.find({ firmId: ctx.firmId, clientId: c._id })).filter((m) => canSeeMemory(m, ctx));
    const tasks = (await store.tasks.find({ firmId: ctx.firmId, clientId: c._id })).filter((t) => canSeeTask(t, ctx));
    const lead = await store.users.findOne({ _id: c.leadAdvisorId });
    out.push({
      ...c,
      leadAdvisorName: lead?.name ?? "",
      counts: {
        active: mems.filter((m) => effectiveStatus(m, now) === "active").length,
        proposed: mems.filter((m) => m.status === "proposed").length,
        expired: mems.filter((m) => effectiveStatus(m, now) === "expired").length,
        restricted: mems.filter((m) => m.visibility === "restricted" && m.status === "active").length,
        openTasks: tasks.filter((t) => t.status === "draft" || t.status === "approved").length,
        needsReview: tasks.filter((t) => t.needsReview && (t.status === "draft" || t.status === "approved")).length,
      },
    });
  }
  return out;
}

export async function sessionInfo(ctx: AuthContext) {
  const store = await getStore();
  const cfg = getConfig();
  const firm = await store.firms.findOne({ _id: ctx.firmId });
  const personas = await store.users.find({});
  const firms = await store.firms.find({});
  return {
    user: ctx.user,
    firm,
    personas: personas.map((p) => ({
      _id: p._id,
      name: p.name,
      title: p.title,
      role: p.role,
      firmName: firms.find((f) => f._id === p.firmId)?.name ?? "",
    })),
    services: serviceLabels(cfg),
    live: {
      storage: cfg.storage.kind === "atlas",
      embeddings: cfg.embedding.live,
      planner: cfg.planner.live,
    },
    allowDemoReset: cfg.allowDemoReset,
  };
}

/** Controlled comparison: same request, empty open-task set, three memory conditions. Nothing is persisted. */
export async function compareRuns(ctx: AuthContext, clientId: string, request: string) {
  await authorizeClient(ctx, clientId);
  const common = { persist: false, ignoreOpenTasks: true } as const;
  const [none, original, current] = await Promise.all([
    runAgent(ctx, clientId, request, { ...common, memoryMode: "none" }),
    runAgent(ctx, clientId, request, { ...common, memoryMode: "original_snapshot" }),
    runAgent(ctx, clientId, request, { ...common, memoryMode: "persistent" }),
  ]);
  const corrected = current.run.retrieved.some((r) => r.version > 1);
  return {
    request,
    corrected,
    columns: [
      { key: "none", label: "Without persistent memory", run: none.run },
      { key: "original", label: "With approved memory", run: original.run },
      { key: "current", label: "After correction", run: current.run },
    ],
  };
}

export async function clientActivity(ctx: AuthContext, clientId?: string) {
  const store = await getStore();
  const clientIds = clientId
    ? [(await authorizeClient(ctx, clientId))._id]
    : (await listClients(ctx)).map((c) => c._id);
  const events = await store.audit.find(
    { firmId: ctx.firmId, clientId: { $in: clientIds } },
    { sort: { at: -1 }, limit: 200 },
  );
  const users = await store.users.find({ firmId: ctx.firmId });
  return events.map((e) => ({ ...e, actorName: users.find((u) => u._id === e.actorId)?.name ?? e.actorId }));
}
