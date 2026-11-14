import type { AuthContext } from "../auth";
import type { Store } from "../store/types";
import type { Memory, Task, Visibility } from "../types";
import type { ScoredMemory } from "../store/types";
import { eligibility } from "../policy";
import { newId, nowIso } from "../util";

export async function audit(
  store: Store,
  ctx: { firmId: string; userId: string },
  type: string,
  targetId: string,
  clientId: string | undefined,
  details: Record<string, unknown> = {},
) {
  await store.audit.insertOne({
    _id: newId("aud"),
    firmId: ctx.firmId,
    clientId,
    actorId: ctx.userId,
    type,
    targetId,
    at: nowIso(),
    details,
  });
}

export const OPEN_TASK_STATUSES = ["draft", "approved"] as const;

/** When a memory version stops being current, every open task that depends on it is flagged. */
export async function flagDependentTasks(
  store: Store,
  firmId: string,
  clientId: string,
  lineageId: string,
  memoryId: string,
  reason: string,
) {
  const at = nowIso();
  const tasks = await store.tasks.find({
    firmId,
    clientId,
    status: { $in: [...OPEN_TASK_STATUSES] },
    "dependsOn.lineageId": lineageId,
  });
  for (const t of tasks) {
    await store.tasks.updateOne(
      { _id: t._id },
      {
        $set: { needsReview: true, updatedAt: at },
        $push: { reviewReasons: { memoryId, lineageId, reason, at } },
      },
    );
    await store.tasks.updateOne(
      { _id: t._id },
      { $push: { history: { at, actor: "system", action: "flagged_for_review", note: reason } } },
    );
  }
  return tasks.map((t) => t._id);
}

/** A task inherits the most restrictive visibility of the memories it depends on. */
export function taskVisibility(
  deps: Pick<Memory, "visibility" | "allowedUserIds">[],
): { visibility: Visibility; allowedUserIds: string[] } {
  const restricted = deps.filter((d) => d.visibility === "restricted");
  if (!restricted.length) return { visibility: "team", allowedUserIds: [] };
  let allowed = restricted[0].allowedUserIds;
  for (const r of restricted.slice(1)) allowed = allowed.filter((u) => r.allowedUserIds.includes(u));
  return { visibility: "restricted", allowedUserIds: allowed };
}

export function canSeeTask(t: Pick<Task, "visibility" | "allowedUserIds">, ctx: AuthContext) {
  return t.visibility === "team" || t.allowedUserIds.includes(ctx.userId);
}

/**
 * Used when vector search is temporarily unavailable (for example the embedding provider is
 * rate limited). Loads the client's active memories directly and applies the same eligibility
 * rules in code, so access control is unchanged; only similarity ranking is lost.
 */
export async function structuredMemoryFallback(
  store: Store,
  ctx: AuthContext,
  clientId: string,
  now: Date,
  limit: number,
): Promise<ScoredMemory[]> {
  const all = await store.memories.find({ firmId: ctx.firmId, clientId, status: "active" });
  return all
    .filter((m) => eligibility(m, ctx, clientId, now).ok)
    .sort((a, b) => (b.confirmedAt ?? "").localeCompare(a.confirmedAt ?? ""))
    .slice(0, limit)
    .map(({ embedding: _e, embeddingText: _t, ...m }) => ({ ...m, similarity: 0 }) as ScoredMemory);
}
