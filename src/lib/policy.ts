import type { AuthContext } from "./auth";
import type { Filter } from "./store/types";
import type { Memory, MemoryStatus } from "./types";

/** Status as seen by readers: active memories past expiresAt are reported (and treated) as expired. */
export function effectiveStatus(m: Pick<Memory, "status" | "expiresAt">, now: Date): MemoryStatus {
  if (m.status === "active" && m.expiresAt && new Date(m.expiresAt).getTime() <= now.getTime()) return "expired";
  return m.status;
}

export function accessFilter(ctx: AuthContext): Filter {
  return { $or: [{ visibility: "team" }, { allowedUserIds: ctx.userId }] };
}

export function canSeeMemory(m: Pick<Memory, "firmId" | "visibility" | "allowedUserIds">, ctx: AuthContext) {
  if (m.firmId !== ctx.firmId) return false;
  return m.visibility === "team" || m.allowedUserIds.includes(ctx.userId);
}

/**
 * The Atlas Vector Search pre-filter. Scope (firm, client), lifecycle (active, unexpired),
 * access (team-visible or explicitly allowed) and embedding model are all constrained
 * inside $vectorSearch, before any private memory can become a candidate.
 * clientId must already have been authorized for ctx.
 */
export function retrievalFilter(ctx: AuthContext, clientId: string, now: Date, embeddingModel: string): Filter {
  return {
    $and: [
      { firmId: ctx.firmId },
      { clientId },
      { status: "active" },
      { embeddingModel },
      { retrievalExpiresAt: { $gt: now } },
      accessFilter(ctx),
    ],
  };
}

export type IneligibleReason =
  | "wrong_scope"
  | "not_active"
  | "expired"
  | "restricted"
  | "embedding_model_mismatch"
  | "forgotten";

/** Defense in depth: re-check every retrieved or cited memory in application code. */
export function eligibility(
  m: Memory | Omit<Memory, "embedding">,
  ctx: AuthContext,
  clientId: string,
  now: Date,
  embeddingModel?: string,
): { ok: true } | { ok: false; reason: IneligibleReason } {
  if (m.firmId !== ctx.firmId || m.clientId !== clientId) return { ok: false, reason: "wrong_scope" };
  if (m.status === "forgotten") return { ok: false, reason: "forgotten" };
  if (m.status !== "active") return { ok: false, reason: "not_active" };
  if (effectiveStatus(m, now) === "expired") return { ok: false, reason: "expired" };
  if (!canSeeMemory(m, ctx)) return { ok: false, reason: "restricted" };
  if (embeddingModel && m.embeddingModel !== embeddingModel) return { ok: false, reason: "embedding_model_mismatch" };
  return { ok: true };
}
