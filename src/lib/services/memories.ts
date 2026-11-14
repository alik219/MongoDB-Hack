import { authorizeClient, badRequest, conflict, denied, notFound, requireLeadAdvisor, type AuthContext } from "../auth";
import { extractMemories, detectInstructionLikeText } from "../ai/extract";
import { buildMemory, embeddingFields, parseAttrs } from "../memory-doc";
import { canSeeMemory, effectiveStatus } from "../policy";
import { getStore } from "../store";
import type { Filter, Store } from "../store/types";
import {
  MEMORY_CATEGORIES,
  NO_EXPIRY_SENTINEL,
  type Attr,
  type Client,
  type Memory,
  type MemoryCategory,
  type MemoryStatus,
  type Source,
  type SourceKind,
  type Tombstone,
} from "../types";
import { evidenceFingerprint, memoryFingerprint, newId, nowIso, clock, sha } from "../util";
import { audit, canSeeTask, flagDependentTasks, taskVisibility } from "./common";

// ---------------- Views ----------------

export type MemoryView = Omit<Memory, "embedding" | "retrievalExpiresAt"> & {
  effectiveStatus: MemoryStatus;
  clientName: string;
  hasEmbedding: boolean;
  usage: { runs: number; openTasks: number };
  reviewDue: boolean;
};

function toView(m: Memory, clientName: string, usage = { runs: 0, openTasks: 0 }): MemoryView {
  const { embedding, embeddingText: _t, retrievalExpiresAt: _r, ...rest } = m;
  const now = clock.now();
  return {
    ...rest,
    effectiveStatus: effectiveStatus(m, now),
    clientName,
    hasEmbedding: Boolean(embedding?.length || _t),
    usage,
    reviewDue: Boolean(m.status === "active" && m.reviewAt && new Date(m.reviewAt) <= now),
  };
}

async function accessibleClientIds(ctx: AuthContext) {
  const store = await getStore();
  const clients = await store.clients.find({ firmId: ctx.firmId, _id: { $in: ctx.user.clientIds } });
  return clients.filter((c) => c.teamUserIds.includes(ctx.userId));
}

export async function listMemories(
  ctx: AuthContext,
  q: { clientId?: string; status?: string; category?: string; search?: string },
) {
  const store = await getStore();
  const clients = q.clientId ? [await authorizeClient(ctx, q.clientId)] : await accessibleClientIds(ctx);
  const names = new Map(clients.map((c) => [c._id, c.name]));
  const filter: Filter = {
    firmId: ctx.firmId,
    clientId: { $in: clients.map((c) => c._id) },
  };
  if (q.category && (MEMORY_CATEGORIES as readonly string[]).includes(q.category)) filter.category = q.category;
  const all = await store.memories.find(filter, { sort: { createdAt: -1 } });
  const visible = all.filter((m) => canSeeMemory(m, ctx));
  const hiddenRestricted = all.length - visible.length;

  const runs = await store.runs.find({ firmId: ctx.firmId, clientId: { $in: clients.map((c) => c._id) } });
  const tasks = await store.tasks.find({ firmId: ctx.firmId, clientId: { $in: clients.map((c) => c._id) } });
  const now = clock.now();
  let views = visible.map((m) =>
    toView(m, names.get(m.clientId) ?? "", {
      runs: runs.filter((r) => r.retrieved.some((x) => x.memoryId === m._id)).length,
      openTasks: tasks.filter(
        (t) => (t.status === "draft" || t.status === "approved") && t.dependsOn.some((d) => d.memoryId === m._id),
      ).length,
    }),
  );
  if (q.status) views = views.filter((v) => v.effectiveStatus === q.status);
  if (q.search) {
    const s = q.search.toLowerCase();
    views = views.filter(
      (v) =>
        v.statement.toLowerCase().includes(s) ||
        v.structured.topic.includes(s) ||
        v.evidence.some((e) => e.excerpt.toLowerCase().includes(s)),
    );
  }
  void now;
  return { memories: views, hiddenRestricted };
}

export async function getMemoryDetail(ctx: AuthContext, memoryId: string) {
  const store = await getStore();
  const m = await store.memories.findOne({ _id: memoryId, firmId: ctx.firmId });
  if (!m) throw notFound("Memory not found");
  const client = await authorizeClient(ctx, m.clientId);
  if (!canSeeMemory(m, ctx)) throw denied("This memory is restricted. Ask the lead advisor for access.");

  const versions = (await store.memories.find({ lineageId: m.lineageId, firmId: ctx.firmId }, { sort: { version: 1 } }))
    .filter((v) => canSeeMemory(v, ctx))
    .map((v) => toView(v, client.name));
  const versionIds = versions.map((v) => v._id);
  const history = await store.audit.find(
    { firmId: ctx.firmId, $or: [{ targetId: m.lineageId }, { targetId: { $in: versionIds } }] },
    { sort: { at: 1 } },
  );
  const runs = (await store.runs.find({ firmId: ctx.firmId, clientId: m.clientId }, { sort: { createdAt: -1 } }))
    .filter((r) => r.retrieved.some((x) => x.lineageId === m.lineageId))
    .map((r) => ({
      _id: r._id,
      createdAt: r.createdAt,
      request: r.request,
      status: r.status,
      versionsUsed: r.retrieved.filter((x) => x.lineageId === m.lineageId).map((x) => x.version),
    }));
  const tasks = (await store.tasks.find({ firmId: ctx.firmId, clientId: m.clientId, "dependsOn.lineageId": m.lineageId }))
    .filter((t) => canSeeTask(t, ctx))
    .map((t) => ({
      _id: t._id,
      title: t.title,
      status: t.status,
      needsReview: t.needsReview,
      versions: t.dependsOn.filter((d) => d.lineageId === m.lineageId).map((d) => d.version),
    }));
  const sourceIds = [...new Set(versions.flatMap((v) => v.evidence.map((e) => e.sourceId)))];
  const sources = (await store.sources.find({ _id: { $in: sourceIds }, firmId: ctx.firmId, clientId: m.clientId })).map(
    (s) => ({ _id: s._id, title: s.title, kind: s.kind, sourceDate: s.sourceDate }),
  );
  const tombstone =
    m.status === "forgotten" ? await store.tombstones.findOne({ lineageId: m.lineageId, firmId: ctx.firmId }) : null;
  return {
    memory: toView(m, client.name),
    versions,
    history,
    runs,
    tasks,
    sources,
    tombstone: tombstone
      ? { forgottenAt: tombstone.forgottenAt, forgottenBy: tombstone.forgottenBy, reason: tombstone.reason }
      : null,
    canManage: client.leadAdvisorId === ctx.userId && ctx.role === "lead_advisor",
    team: (await store.users.find({ _id: { $in: client.teamUserIds }, firmId: ctx.firmId })).map((u) => ({
      _id: u._id,
      name: u.name,
      role: u.role,
    })),
  };
}

export async function getSourcePreview(ctx: AuthContext, sourceId: string) {
  const store = await getStore();
  const s = await store.sources.findOne({ _id: sourceId, firmId: ctx.firmId });
  if (!s) throw notFound("Source not found");
  await authorizeClient(ctx, s.clientId);
  // A source that backs a restricted memory is only previewable by users allowed to see that memory.
  const backing = await store.memories.find({ firmId: ctx.firmId, clientId: s.clientId, "evidence.sourceId": s._id });
  if (backing.length && backing.every((m) => !canSeeMemory(m, ctx))) {
    throw denied("This source supports a restricted memory.");
  }
  return {
    _id: s._id,
    title: s.title,
    kind: s.kind,
    sourceDate: s.sourceDate,
    text: s.text,
    safetyFlags: s.safetyFlags,
    createdBy: s.createdBy,
  };
}

// ---------------- Ingestion → proposals ----------------

export interface IngestResult {
  sourceId: string;
  extractor: string;
  proposals: ReturnType<typeof toView>[];
  skipped: { statement: string; reason: string }[];
  ignoredInstructions: string[];
}

export async function ingestNote(
  ctx: AuthContext,
  input: { clientId: string; title: string; kind: SourceKind; sourceDate: string; text: string },
): Promise<IngestResult> {
  const store = await getStore();
  const client = await authorizeClient(ctx, input.clientId);
  const text = (input.text ?? "").trim();
  if (text.length < 10) throw badRequest("Note text is too short.");
  if (text.length > 20000) throw badRequest("Note is too long for the MVP (20,000 characters).");
  if (!["meeting_note", "client_message", "advisor_note"].includes(input.kind)) throw badRequest("Invalid source kind");
  const at = nowIso();
  const src: Source = {
    _id: newId("src"),
    firmId: ctx.firmId, // from session, never from the request
    clientId: client._id,
    kind: input.kind,
    title: (input.title || "Untitled note").slice(0, 140),
    text,
    sourceDate: /^\d{4}-\d{2}-\d{2}$/.test(input.sourceDate) ? input.sourceDate : at.slice(0, 10),
    createdBy: ctx.userId,
    createdAt: at,
    contentHash: sha(text),
    safetyFlags: detectInstructionLikeText(text),
  };
  await store.sources.insertOne(src);
  return proposeFromSource(store, ctx, client, src);
}

/**
 * Re-reads a document that is already stored (for example one of the dataset's meeting notes)
 * and proposes memories from it. Same guards as a new note: verbatim evidence, tombstones,
 * duplicates. Everything it finds is a proposal until an advisor confirms it.
 */
export async function extractFromSource(ctx: AuthContext, sourceId: string): Promise<IngestResult> {
  const store = await getStore();
  const src = await store.sources.findOne({ _id: sourceId, firmId: ctx.firmId });
  if (!src) throw notFound("Source not found");
  const client = await authorizeClient(ctx, src.clientId);
  const backing = await store.memories.find({ firmId: ctx.firmId, clientId: src.clientId, "evidence.sourceId": src._id });
  if (backing.length && backing.every((b) => !canSeeMemory(b, ctx))) throw denied("This source supports a restricted memory.");
  return proposeFromSource(store, ctx, client, src);
}

/** Every stored document for a client, with how many memories each one supports. Text is not returned here. */
export async function listSources(ctx: AuthContext, clientId: string) {
  const store = await getStore();
  const client = await authorizeClient(ctx, clientId);
  const [sources, mems] = await Promise.all([
    store.sources.find({ firmId: ctx.firmId, clientId: client._id }, { sort: { sourceDate: -1 } }),
    store.memories.find({ firmId: ctx.firmId, clientId: client._id }),
  ]);
  const now = clock.now();
  return sources
    .map((s) => {
      const backing = mems.filter((m) => m.evidence.some((e) => e.sourceId === s._id));
      const visible = backing.filter((m) => canSeeMemory(m, ctx));
      if (backing.length && !visible.length) return null; // supports only restricted memories
      const by = (status: string) => visible.filter((m) => effectiveStatus(m, now) === status).length;
      return {
        _id: s._id,
        title: s.title,
        kind: s.kind,
        sourceDate: s.sourceDate,
        chars: s.text.length,
        contentHash: s.contentHash.slice(0, 12),
        safetyFlags: s.safetyFlags.length,
        memories: { active: by("active"), proposed: by("proposed"), other: visible.length - by("active") - by("proposed") },
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}

async function proposeFromSource(store: Store, ctx: AuthContext, client: Client, src: Source): Promise<IngestResult> {
  const text = src.text;
  const at = nowIso();
  const existing = (await store.memories.find({ firmId: ctx.firmId, clientId: client._id, status: "active" })).filter(
    (m) => canSeeMemory(m, ctx) && effectiveStatus(m, clock.now()) === "active",
  );
  const { output, extractor } = await extractMemories({
    clientName: client.name,
    sourceKind: src.kind,
    text,
    existing,
  });

  const tombstones = await store.tombstones.find({ firmId: ctx.firmId, clientId: client._id });
  const blocked = new Set(tombstones.flatMap((t) => t.fingerprints));
  const known = await store.memories.find({
    firmId: ctx.firmId,
    clientId: client._id,
    status: { $in: ["proposed", "active", "rejected"] },
  });

  const proposals: Memory[] = [];
  const skipped: IngestResult["skipped"] = [];
  for (const e of output.memories) {
    // 1. Evidence must actually be in the source. No invented quotations.
    if (!text.includes(e.excerpt)) {
      skipped.push({ statement: e.statement, reason: "Excerpt is not a verbatim quote from the source; discarded." });
      continue;
    }
    // 2. Forgotten memories cannot be recreated from the same source or statement.
    const fp = memoryFingerprint(client._id, e.statement);
    const efp = evidenceFingerprint(client._id, src.contentHash, e.excerpt);
    if (blocked.has(fp) || blocked.has(efp)) {
      skipped.push({ statement: "[withheld]", reason: "Matches a forgotten memory; not recreated." });
      continue;
    }
    const dup = known.find((k) => k.fingerprint === fp);
    if (dup) {
      skipped.push({
        statement: e.statement,
        reason:
          dup.status === "rejected"
            ? "Previously rejected by an advisor."
            : dup.status === "proposed"
              ? "Already awaiting review."
              : "Already an active memory.",
      });
      continue;
    }
    // 3. Update targets must be active memories of this client that the caller can see.
    let target: Memory | undefined;
    if (e.relation !== "new" && e.targetMemoryId) {
      target = existing.find((x) => x._id === e.targetMemoryId);
    }
    const relation = target ? e.relation : "new";
    const p = buildMemory({
      firmId: ctx.firmId,
      clientId: client._id,
      category: e.category,
      statement: e.statement,
      topic: e.topic,
      attributes: parseAttrs(e.attributes),
      evidence: [{ sourceId: src._id, excerpt: e.excerpt, sourceDate: src.sourceDate, sourceKind: src.kind }],
      status: "proposed",
      basis: "source_supported",
      createdBy: ctx.userId,
      createdAt: at,
      lineageId: target?.lineageId,
      version: target ? target.version + 1 : 1,
      visibility: target?.visibility,
      allowedUserIds: target?.allowedUserIds,
      proposal: {
        kind: relation,
        targetMemoryId: target?._id,
        targetVersion: target?.version,
        changeSummary: target ? (e.changeSummary ?? `${target.statement} → ${e.statement}`) : undefined,
        extractor,
        proposedBy: ctx.userId,
        proposedAt: at,
      },
    });
    proposals.push(p);
  }
  await store.memories.insertMany(proposals);
  await audit(store, ctx, "source.ingested", src._id, client._id, {
    proposals: proposals.length,
    skipped: skipped.length,
    ignoredInstructions: output.ignoredInstructions.length,
    extractor,
  });
  return {
    sourceId: src._id,
    extractor,
    proposals: proposals.map((p) => toView(p, client.name)),
    skipped,
    ignoredInstructions: output.ignoredInstructions,
  };
}

// ---------------- Lifecycle actions ----------------

async function loadForAction(ctx: AuthContext, memoryId: string, action: string) {
  const store = await getStore();
  const m = await store.memories.findOne({ _id: memoryId, firmId: ctx.firmId });
  if (!m) throw notFound("Memory not found");
  const client = await authorizeClient(ctx, m.clientId);
  if (!canSeeMemory(m, ctx)) throw denied("This memory is restricted.");
  requireLeadAdvisor(ctx, client, action);
  return { store, m, client };
}

export async function approveProposal(ctx: AuthContext, memoryId: string) {
  const { store, m, client } = await loadForAction(ctx, memoryId, "confirm memories");
  if (m.status !== "proposed") throw conflict(`Only proposed memories can be approved (this one is ${m.status}).`);
  const at = nowIso();
  let target: Memory | null = null;
  if (m.proposal?.targetMemoryId) {
    target = await store.memories.findOne({ _id: m.proposal.targetMemoryId, firmId: ctx.firmId });
    if (!target || target.status !== "active" || target.version !== m.proposal.targetVersion) {
      throw conflict("The memory this proposal updates has changed since it was proposed. Re-ingest or reject it.");
    }
    // Supersede atomically on the expected version (optimistic concurrency).
    const r = await store.memories.updateOne(
      { _id: target._id, status: "active", version: target.version },
      { $set: { status: "superseded", supersededByMemoryId: m._id } },
    );
    if (!r.matched) throw conflict("The target memory changed during approval. Try again.");
  }
  const emb = await embeddingFields(m, at);
  await store.memories.updateOne(
    { _id: m._id, status: "proposed" },
    {
      $set: {
        status: "active",
        basis: "advisor_confirmed",
        confirmedBy: ctx.userId,
        confirmedAt: at,
        lastConfirmedAt: at,
        supersedesMemoryId: target?._id,
        expiresAt: target?.expiresAt ?? m.expiresAt ?? null,
        retrievalExpiresAt: target?.expiresAt ? new Date(target.expiresAt) : NO_EXPIRY_SENTINEL,
        ...emb,
      },
    },
  );
  let flagged: string[] = [];
  if (target) {
    flagged = await flagDependentTasks(
      store,
      ctx.firmId,
      client._id,
      target.lineageId,
      target._id,
      `Memory v${target.version} was superseded by v${m.version}: "${m.statement}"`,
    );
  }
  await audit(store, ctx, target ? "memory.updated" : "memory.approved", m._id, client._id, {
    lineageId: m.lineageId,
    version: m.version,
    supersedes: target?._id,
    flaggedTasks: flagged,
  });
  return { approved: m._id, superseded: target?._id ?? null, flaggedTasks: flagged };
}

export async function rejectProposal(ctx: AuthContext, memoryId: string, reason?: string) {
  const { store, m, client } = await loadForAction(ctx, memoryId, "reject memories");
  if (m.status !== "proposed") throw conflict("Only proposed memories can be rejected.");
  await store.memories.updateOne(
    { _id: m._id, status: "proposed" },
    { $set: { status: "rejected", rejectedAt: nowIso(), rejectedBy: ctx.userId } },
  );
  await audit(store, ctx, "memory.rejected", m._id, client._id, { lineageId: m.lineageId, reason: reason ?? "" });
  return { rejected: m._id };
}

export async function correctMemory(
  ctx: AuthContext,
  memoryId: string,
  input: { statement: string; attributes?: Record<string, Attr>; category?: MemoryCategory; reason: string },
) {
  const { store, m, client } = await loadForAction(ctx, memoryId, "correct memories");
  if (m.status !== "active") throw conflict("Only the current active version can be corrected.");
  const statement = (input.statement ?? "").trim();
  if (statement.length < 5) throw badRequest("Corrected statement is required.");
  const reason = (input.reason ?? "").trim() || "Advisor correction";
  const at = nowIso();
  // The correction itself is recorded as an advisor source, so the new version's evidence is a real quote.
  const srcText = `Correction recorded by ${ctx.user.name}: ${statement} Reason: ${reason}`;
  const src: Source = {
    _id: newId("src"),
    firmId: ctx.firmId,
    clientId: client._id,
    kind: "advisor_note",
    title: "Advisor correction",
    text: srcText,
    sourceDate: at.slice(0, 10),
    createdBy: ctx.userId,
    createdAt: at,
    contentHash: sha(srcText),
    safetyFlags: [],
  };
  await store.sources.insertOne(src);
  // A numeric fact stays numeric even if a client sends it as text, so a correction cannot silently drop it from the lender engine.
  const attributes: Record<string, Attr> = { ...(input.attributes ?? m.structured.attributes) };
  for (const [k, v] of Object.entries(attributes)) {
    if (typeof m.structured.attributes[k] === "number" && typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) {
      attributes[k] = Number(v);
    }
  }
  const next = buildMemory({
    firmId: ctx.firmId,
    clientId: client._id,
    category: input.category ?? m.category,
    statement,
    topic: m.structured.topic,
    attributes,
    evidence: [{ sourceId: src._id, excerpt: statement, sourceDate: src.sourceDate, sourceKind: "advisor_correction" }],
    status: "active",
    basis: "advisor_confirmed",
    createdBy: ctx.userId,
    createdAt: at,
    lineageId: m.lineageId,
    version: m.version + 1,
    visibility: m.visibility,
    allowedUserIds: m.allowedUserIds,
    expiresAt: m.expiresAt,
    reviewAt: m.reviewAt,
    confirmedBy: ctx.userId,
    confirmedAt: at,
    supersedesMemoryId: m._id,
    proposal: {
      kind: "update",
      targetMemoryId: m._id,
      targetVersion: m.version,
      changeSummary: `${m.statement} → ${statement}`,
      extractor: "advisor",
      proposedBy: ctx.userId,
      proposedAt: at,
    },
  });
  Object.assign(next, await embeddingFields(next, at));
  const r = await store.memories.updateOne(
    { _id: m._id, status: "active", version: m.version },
    { $set: { status: "superseded", supersededByMemoryId: next._id } },
  );
  if (!r.matched) throw conflict("This memory changed while you were editing. Reload and try again.");
  await store.memories.insertOne(next);
  const flagged = await flagDependentTasks(
    store,
    ctx.firmId,
    client._id,
    m.lineageId,
    m._id,
    `Corrected by advisor: v${m.version} → v${next.version} ("${statement}")`,
  );
  await audit(store, ctx, "memory.corrected", next._id, client._id, {
    lineageId: m.lineageId,
    from: m._id,
    to: next._id,
    reason,
    flaggedTasks: flagged,
  });
  return { memoryId: next._id, superseded: m._id, flaggedTasks: flagged };
}

export async function restrictMemory(
  ctx: AuthContext,
  memoryId: string,
  input: { visibility: "team" | "restricted"; allowedUserIds?: string[] },
) {
  const { store, m, client } = await loadForAction(ctx, memoryId, "change memory access");
  if (!["team", "restricted"].includes(input.visibility)) throw badRequest("Invalid visibility");
  let allowed: string[] = [];
  if (input.visibility === "restricted") {
    // Only members of this client's team can be granted access; the lead advisor always retains it.
    allowed = [...new Set([client.leadAdvisorId, ...(input.allowedUserIds ?? [])])].filter((u) =>
      client.teamUserIds.includes(u),
    );
  }
  await store.memories.updateMany(
    { lineageId: m.lineageId, firmId: ctx.firmId },
    { $set: { visibility: input.visibility, allowedUserIds: allowed } },
  );
  // Recompute visibility of tasks that depend on this lineage.
  const tasks = await store.tasks.find({ firmId: ctx.firmId, clientId: client._id, "dependsOn.lineageId": m.lineageId });
  for (const t of tasks) {
    const deps = await store.memories.find({ _id: { $in: t.dependsOn.map((d) => d.memoryId) } });
    await store.tasks.updateOne({ _id: t._id }, { $set: taskVisibility(deps) });
  }
  await audit(store, ctx, "memory.access_changed", m._id, client._id, {
    lineageId: m.lineageId,
    visibility: input.visibility,
    allowedUserIds: allowed,
  });
  return { visibility: input.visibility, allowedUserIds: allowed };
}

export async function setExpiration(
  ctx: AuthContext,
  memoryId: string,
  input: { expiresAt?: string | null; reviewAt?: string | null },
) {
  const { store, m, client } = await loadForAction(ctx, memoryId, "change memory expiration");
  if (m.status !== "active") throw conflict("Expiration applies to the current active version.");
  const parse = (v: string | null | undefined) => {
    if (v == null || v === "") return null;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) throw badRequest(`Invalid date: ${v}`);
    return d.toISOString();
  };
  const expiresAt = input.expiresAt === undefined ? (m.expiresAt ?? null) : parse(input.expiresAt);
  const reviewAt = input.reviewAt === undefined ? (m.reviewAt ?? null) : parse(input.reviewAt);
  await store.memories.updateOne(
    { _id: m._id },
    {
      $set: {
        expiresAt,
        reviewAt,
        retrievalExpiresAt: expiresAt ? new Date(expiresAt) : NO_EXPIRY_SENTINEL,
      },
    },
  );
  let flagged: string[] = [];
  if (expiresAt && new Date(expiresAt) <= clock.now()) {
    flagged = await flagDependentTasks(store, ctx.firmId, client._id, m.lineageId, m._id, `Memory v${m.version} expired.`);
  }
  await audit(store, ctx, "memory.expiration_set", m._id, client._id, { lineageId: m.lineageId, expiresAt, reviewAt });
  return { expiresAt, reviewAt, flaggedTasks: flagged };
}

export async function reconfirmMemory(ctx: AuthContext, memoryId: string) {
  const { store, m, client } = await loadForAction(ctx, memoryId, "reconfirm memories");
  if (effectiveStatus(m, clock.now()) !== "active") throw conflict("Only active memories can be reconfirmed.");
  const at = nowIso();
  await store.memories.updateOne({ _id: m._id }, { $set: { lastConfirmedAt: at } });
  await audit(store, ctx, "memory.reconfirmed", m._id, client._id, { lineageId: m.lineageId });
  return { lastConfirmedAt: at };
}

/**
 * Forget semantics:
 *  - every version of the memory is excluded from retrieval immediately (status "forgotten");
 *  - statement, structured content, excerpts and embeddings are removed from the memory documents;
 *  - snapshots of the memory text in run records are redacted;
 *  - a tombstone of one-way fingerprints blocks re-creation from the same source or statement;
 *  - the original source document is retained separately as the firm's record, and
 *    historical task text is retained (dependent open tasks are flagged for review).
 */
export async function forgetMemory(ctx: AuthContext, memoryId: string, reason: string) {
  const { store, m, client } = await loadForAction(ctx, memoryId, "forget memories");
  if (m.status === "forgotten") throw conflict("Already forgotten.");
  const at = nowIso();
  const versions = await store.memories.find({ lineageId: m.lineageId, firmId: ctx.firmId });
  const sources = await store.sources.find({
    _id: { $in: versions.flatMap((v) => v.evidence.map((e) => e.sourceId)) },
    firmId: ctx.firmId,
  });
  const hashOf = new Map(sources.map((s) => [s._id, s.contentHash]));
  const fingerprints = [
    ...new Set(
      versions.flatMap((v) => [
        v.fingerprint,
        ...v.evidence.map((e) => evidenceFingerprint(client._id, hashOf.get(e.sourceId) ?? "", e.excerpt)),
      ]),
    ),
  ].filter((f) => f && f !== "[forgotten]");
  const tomb: Tombstone = {
    _id: newId("tmb"),
    firmId: ctx.firmId,
    clientId: client._id,
    lineageId: m.lineageId,
    category: m.category,
    fingerprints,
    forgottenAt: at,
    forgottenBy: ctx.userId,
    reason: (reason ?? "").slice(0, 300) || "Advisor requested",
  };
  await store.tombstones.insertOne(tomb);
  await store.memories.updateMany(
    { lineageId: m.lineageId, firmId: ctx.firmId },
    {
      $set: {
        status: "forgotten",
        statement: "[forgotten]",
        structured: { topic: "[forgotten]", attributes: {} },
        evidence: [],
        fingerprint: "[forgotten]",
        forgottenAt: at,
        forgottenBy: ctx.userId,
        forgetReason: tomb.reason,
      },
      $unset: { embedding: "", embeddingText: "", embeddingModel: "", embeddingDims: "", embeddedAt: "", proposal: "" },
    },
  );
  // Redact derived copies held in run evidence.
  const versionIds = versions.map((v) => v._id);
  const runs = await store.runs.find({ firmId: ctx.firmId, clientId: client._id });
  for (const r of runs) {
    let touched = false;
    const retrieved = r.retrieved.map((x) => {
      if (x.lineageId !== m.lineageId) return x;
      touched = true;
      return { ...x, statement: "[redacted: memory forgotten]" };
    });
    const redactPoints = (pts: { text: string; memoryIds: string[] }[]) =>
      pts.map((p) => {
        if (!p.memoryIds.some((id) => versionIds.includes(id))) return p;
        touched = true;
        return { ...p, text: "[redacted: relied on a forgotten memory]" };
      });
    const brief = r.brief
      ? {
          ...r.brief,
          context: redactPoints(r.brief.context),
          missingInformation: redactPoints(r.brief.missingInformation),
          conflicts: redactPoints(r.brief.conflicts),
        }
      : null;
    if (touched) await store.runs.updateOne({ _id: r._id }, { $set: { retrieved, brief } });
  }
  const flagged = await flagDependentTasks(
    store,
    ctx.firmId,
    client._id,
    m.lineageId,
    m._id,
    "A supporting memory was forgotten and can no longer be used.",
  );
  await audit(store, ctx, "memory.forgotten", m.lineageId, client._id, {
    versions: versionIds.length,
    reason: tomb.reason,
    flaggedTasks: flagged,
    retained:
      "Minimal metadata (ids, category, timestamps, actor) and one-way fingerprints. Source documents are retained separately; historical task text is retained.",
  });
  return { forgotten: m.lineageId, versions: versionIds.length, flaggedTasks: flagged };
}

export async function exportMemories(ctx: AuthContext, clientId: string) {
  const { memories, hiddenRestricted } = await listMemories(ctx, { clientId });
  return {
    exportedAt: nowIso(),
    exportedBy: ctx.userId,
    clientId,
    note: "Only memories visible to the exporting user are included. Embeddings are omitted.",
    hiddenRestricted,
    memories: memories.map(({ usage: _u, hasEmbedding: _h, ...m }) => m),
  };
}

export function categoryLabel(c: string) {
  return c.replace(/_/g, " ");
}
