import { embed, memoryEmbeddingText } from "./ai/embeddings";
import { getConfig } from "./config";
import { NO_EXPIRY_SENTINEL, type Attr, type Evidence, type Memory, type MemoryCategory, type Visibility } from "./types";
import { memoryFingerprint, newId } from "./util";

export function parseAttrs(list: { key: string; value: string }[]): Record<string, Attr> {
  const out: Record<string, Attr> = {};
  for (const { key, value } of list) {
    out[key] = value === "true" ? true : value === "false" ? false : value;
  }
  return out;
}

export interface BuildMemoryParams {
  firmId: string;
  clientId: string;
  category: MemoryCategory;
  statement: string;
  topic: string;
  attributes: Record<string, Attr>;
  evidence: Evidence[];
  status: Memory["status"];
  basis: Memory["basis"];
  createdBy: string;
  createdAt: string;
  lineageId?: string;
  version?: number;
  visibility?: Visibility;
  allowedUserIds?: string[];
  expiresAt?: string | null;
  reviewAt?: string | null;
  confirmedBy?: string;
  confirmedAt?: string;
  proposal?: Memory["proposal"];
  supersedesMemoryId?: string;
}

export function buildMemory(p: BuildMemoryParams): Memory {
  const lineageId = p.lineageId ?? newId("lin");
  const version = p.version ?? 1;
  return {
    _id: newId("mem"),
    lineageId,
    version,
    firmId: p.firmId,
    clientId: p.clientId,
    category: p.category,
    statement: p.statement,
    structured: { topic: p.topic, attributes: p.attributes },
    status: p.status,
    basis: p.basis,
    evidence: p.evidence,
    proposal: p.proposal,
    supersedesMemoryId: p.supersedesMemoryId,
    createdAt: p.createdAt,
    createdBy: p.createdBy,
    confirmedBy: p.confirmedBy,
    confirmedAt: p.confirmedAt,
    lastConfirmedAt: p.confirmedAt,
    visibility: p.visibility ?? "team",
    allowedUserIds: p.allowedUserIds ?? [],
    expiresAt: p.expiresAt ?? null,
    reviewAt: p.reviewAt ?? null,
    retrievalExpiresAt: p.expiresAt ? new Date(p.expiresAt) : NO_EXPIRY_SENTINEL,
    fingerprint: memoryFingerprint(p.clientId, p.statement),
  };
}

/** Compute embedding fields. Only approved (active) memories are embedded. */
export async function embeddingFields(m: Pick<Memory, "category" | "statement">, at: string) {
  const cfg = getConfig();
  if (cfg.embedding.provider === "atlas-auto") {
    // Atlas generates the vector from this field at index time (autoEmbed index on memories.embeddingText).
    return { embeddingText: memoryEmbeddingText(m), embeddingModel: cfg.embedding.id, embeddedAt: at };
  }
  const [vector] = await embed([memoryEmbeddingText(m)], "document");
  return {
    embedding: vector,
    embeddingModel: cfg.embedding.id,
    embeddingDims: cfg.embedding.dims,
    embeddedAt: at,
  };
}
