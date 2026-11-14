import { z } from "zod";
import type { LenderCheck } from "./lender/engine";

// ---------- Identities ----------

export type Role = "lead_advisor" | "associate";

export interface Firm {
  _id: string;
  name: string;
}

export interface User {
  _id: string;
  firmId: string;
  name: string;
  title: string;
  role: Role;
  /** Clients this user is assigned to. Server-side source of truth for client access. */
  clientIds: string[];
}

export interface Client {
  _id: string;
  firmId: string;
  name: string;
  /** Hackathon dataset client id, e.g. C2-HNW-001. */
  externalId?: string;
  segment?: "retail" | "business" | "corporate";
  leadAdvisorId: string;
  teamUserIds: string[];
  profile: {
    age: number;
    occupation: string;
    household: string;
    relationshipSince: string;
    nextReview: string;
    serviceTier: string;
  };
}

// ---------- Sources (evidence, never instructions) ----------

export type SourceKind = "meeting_note" | "client_message" | "advisor_note" | "client_profile" | "client_goals";

export interface Source {
  _id: string;
  firmId: string;
  clientId: string;
  kind: SourceKind;
  title: string;
  text: string;
  sourceDate: string; // ISO date
  createdBy: string;
  createdAt: string;
  contentHash: string;
  /** Instruction-like text detected in the source. Recorded, never obeyed. */
  safetyFlags: string[];
}

// ---------- Memories ----------

export const MEMORY_CATEGORIES = [
  "goal",
  "constraint",
  "previous_decision",
  "revisit_condition",
  "preference",
  "advisor_commitment",
  "life_event",
  "financial_fact",
] as const;
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

export const MEMORY_STATUSES = [
  "proposed",
  "active",
  "superseded",
  "expired",
  "forgotten",
  "rejected",
] as const;
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];
/** Stored statuses. "expired" is derived at read time from expiresAt. */
export type StoredMemoryStatus = Exclude<MemoryStatus, "expired">;

export type Visibility = "team" | "restricted";

export interface Evidence {
  sourceId: string;
  /** Verbatim substring of the source text. Verified at write time. */
  excerpt: string;
  sourceDate: string;
  sourceKind: SourceKind | "advisor_correction";
}

export type Attr = string | number | boolean;

export interface Memory {
  _id: string; // one document per version
  lineageId: string; // stable across versions
  version: number;
  firmId: string;
  clientId: string;
  category: MemoryCategory;
  statement: string;
  structured: { topic: string; attributes: Record<string, Attr> };
  status: StoredMemoryStatus;
  /**
   * source_supported: an extractor found it in a source; not yet a confirmed fact.
   * advisor_confirmed: an authorized advisor confirmed it.
   */
  basis: "source_supported" | "advisor_confirmed";
  evidence: Evidence[];
  proposal?: {
    kind: "new" | "update" | "conflict";
    targetMemoryId?: string;
    targetVersion?: number;
    changeSummary?: string;
    extractor: string;
    proposedBy: string;
    proposedAt: string;
  };
  supersedesMemoryId?: string;
  supersededByMemoryId?: string;
  createdAt: string;
  createdBy: string;
  confirmedBy?: string;
  confirmedAt?: string;
  lastConfirmedAt?: string;
  visibility: Visibility;
  allowedUserIds: string[];
  expiresAt?: string | null;
  reviewAt?: string | null;
  /** Filter-only field for vector prefiltering: expiresAt or a far-future sentinel. */
  retrievalExpiresAt: Date;
  embedding?: number[];
  /** Atlas auto-embedding source text (EMBEDDING_PROVIDER=atlas-auto). Removed on forget. */
  embeddingText?: string;
  embeddingModel?: string;
  embeddingDims?: number;
  embeddedAt?: string;
  fingerprint: string;
  forgottenAt?: string;
  forgottenBy?: string;
  forgetReason?: string;
  rejectedAt?: string;
  rejectedBy?: string;
}

export const NO_EXPIRY_SENTINEL = new Date("9999-12-31T00:00:00.000Z");

export interface Tombstone {
  _id: string;
  firmId: string;
  clientId: string;
  lineageId: string;
  category: MemoryCategory;
  fingerprints: string[];
  forgottenAt: string;
  forgottenBy: string;
  reason: string;
}

// ---------- Tasks ----------

export type TaskStatus = "draft" | "approved" | "done" | "withdrawn";

export interface TaskDependency {
  memoryId: string;
  lineageId: string;
  version: number;
}

export interface TaskHistoryEntry {
  at: string;
  actor: string; // user id or "agent"
  runId?: string;
  action: string;
  note: string;
}

export interface Task {
  _id: string;
  firmId: string;
  clientId: string;
  key: string;
  title: string;
  detail: string;
  rationale: string;
  ownerId: string;
  status: TaskStatus;
  needsReview: boolean;
  reviewReasons: { memoryId: string; lineageId: string; reason: string; at: string }[];
  dependsOn: TaskDependency[];
  gatedOnKeys: string[];
  visibility: Visibility;
  allowedUserIds: string[];
  createdByRunId: string;
  lastRunId: string;
  replacesTaskId?: string;
  replacedByTaskId?: string;
  withdrawnReason?: string;
  approvedBy?: string;
  approvedAt?: string;
  history: TaskHistoryEntry[];
  createdAt: string;
  updatedAt: string;
}

// ---------- Runs ----------

export interface RunStage {
  key: string;
  label: string;
  status: "done" | "failed" | "skipped";
  ms: number;
  detail: string;
}

export interface RetrievedMemoryRef {
  memoryId: string;
  lineageId: string;
  version: number;
  category: MemoryCategory;
  statement: string; // snapshot; redacted if the memory is later forgotten
  /** Vector similarity. Used for ranking only; never a measure of factual truth. */
  similarity: number;
  freshness: "current" | "review_due";
}

export interface PolicyDecision {
  rule: string;
  outcome: string;
  count?: number;
}

export interface AppliedAction {
  type: "create_task" | "revise_task" | "withdraw_task" | "keep_task" | "flag_for_review";
  taskId: string;
  taskKey: string;
  title: string;
  rationale: string;
  memoryRefs: TaskDependency[];
  changedBecause?: string[];
}

export interface RejectedAction {
  action: unknown;
  reason: string;
}

export interface Run {
  _id: string;
  firmId: string;
  clientId: string;
  actorId: string;
  request: string;
  services: { storage: string; embeddings: string; planner: string };
  status: "completed" | "stale" | "failed";
  stages: RunStage[];
  retrieved: RetrievedMemoryRef[];
  pendingChanges: { memoryId: string; kind: string; summary: string }[];
  policy: PolicyDecision[];
  brief: Brief | null;
  proposedActions: PlanAction[];
  appliedActions: AppliedAction[];
  rejectedActions: RejectedAction[];
  /** Lender policy decisions computed in code from authorized financial_fact memories. */
  lenderChecks?: LenderCheck[];
  /** How the run was computed: the exact retrieval query and the policy documents evaluated. No memory text. */
  trace?: RunTrace;
  errors: string[];
  staleReason?: string;
  createdAt: string;
  durationMs: number;
}

export interface RunTrace {
  retrieval: {
    engine: string;
    index: string | null;
    path: string | null;
    queryMode: "auto_embed_text" | "query_vector" | "version_history";
    queryText: string;
    embeddingModel: string;
    numCandidates: number;
    limit: number;
    /** The authorization pre-filter, serialized. Built from the session, never from the request. */
    filterJson: string;
    returned: number;
    droppedAfterRecheck: number;
  } | null;
  policies: { policyId: string; bank: string; product: string; version: string; effectiveDate: string; contentHash: string; sourceFile: string }[];
  factsLoaded: number;
  planner: { provider: string; model: string; memoriesSent: number; lenderChecksSent: number; openTasksSent: number };
}

export interface AuditEvent {
  _id: string;
  firmId: string;
  clientId?: string;
  actorId: string;
  type: string;
  targetId: string;
  at: string;
  details: Record<string, unknown>;
  /** Tamper-evident chain (see audit-chain.ts). Absent on events written before chaining existed. */
  seq?: number;
  prevHash?: string;
  hash?: string;
}

// ---------- Planner I/O (validated) ----------

export const BriefPointSchema = z.object({
  text: z.string().min(1).max(600),
  memoryIds: z.array(z.string()).max(12),
});

export const BriefSchema = z.object({
  summary: z.string().min(1).max(1200),
  context: z.array(BriefPointSchema).max(20),
  missingInformation: z.array(BriefPointSchema).max(12),
  conflicts: z.array(BriefPointSchema).max(12),
});
export type Brief = z.infer<typeof BriefSchema>;

export const PlanActionSchema = z.object({
  type: z.enum(["create_task", "revise_task", "withdraw_task", "keep_task"]),
  taskKey: z
    .string()
    .regex(/^[a-z0-9_]{3,64}$/, "taskKey must be snake_case"),
  taskId: z.string().nullable(),
  title: z.string().min(3).max(160),
  detail: z.string().max(800),
  rationale: z.string().min(3).max(600),
  ownerRole: z.enum(["lead_advisor", "associate"]),
  memoryIds: z.array(z.string()).max(12),
  gatedOnKeys: z.array(z.string()).max(6),
  replacesTaskKey: z.string().nullable(),
});
export type PlanAction = z.infer<typeof PlanActionSchema>;

export const PlanOutputSchema = z.object({
  brief: BriefSchema,
  actions: z.array(PlanActionSchema).max(15),
});
export type PlanOutput = z.infer<typeof PlanOutputSchema>;

// ---------- Extraction I/O (validated) ----------

export const ExtractedMemorySchema = z.object({
  category: z.enum(MEMORY_CATEGORIES),
  statement: z.string().min(5).max(400),
  topic: z.string().regex(/^[a-z0-9_]{2,64}$/),
  attributes: z.array(
    z.object({ key: z.string().regex(/^[a-z0-9_]{1,40}$/), value: z.string().max(120) }),
  ),
  excerpt: z.string().min(5).max(800),
  relation: z.enum(["new", "update", "conflict"]),
  targetMemoryId: z.string().nullable(),
  changeSummary: z.string().max(300).nullable(),
});
export type ExtractedMemory = z.infer<typeof ExtractedMemorySchema>;

export const ExtractionOutputSchema = z.object({
  memories: z.array(ExtractedMemorySchema).max(20),
  ignoredInstructions: z.array(z.string().max(300)).max(10),
});
export type ExtractionOutput = z.infer<typeof ExtractionOutputSchema>;
