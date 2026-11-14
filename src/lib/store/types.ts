import type {
  AuditEvent,
  Client,
  Firm,
  Memory,
  Run,
  Source,
  Task,
  Tombstone,
  User,
} from "../types";
import type { LenderPolicy } from "../lender/engine";

/**
 * A deliberately small subset of MongoDB query syntax:
 * equality (including array membership), $in, $nin, $ne, $gt, $gte, $lt, $lte,
 * $exists, $or, $and. The same filter objects run against Atlas and the demo store.
 */
export type Filter = Record<string, unknown>;

export interface Update {
  $set?: Record<string, unknown>;
  $unset?: Record<string, "" | 1 | true>;
  $push?: Record<string, unknown>;
}

export interface FindOptions {
  sort?: Record<string, 1 | -1>;
  limit?: number;
}

export interface Coll<T extends { _id: string }> {
  findOne(filter: Filter): Promise<T | null>;
  find(filter: Filter, opts?: FindOptions): Promise<T[]>;
  count(filter: Filter): Promise<number>;
  insertOne(doc: T): Promise<void>;
  insertMany(docs: T[]): Promise<void>;
  /** Returns how many documents matched. Use the filter for optimistic concurrency. */
  updateOne(filter: Filter, update: Update): Promise<{ matched: number }>;
  updateMany(filter: Filter, update: Update): Promise<{ matched: number }>;
  deleteMany(filter: Filter): Promise<number>;
}

export interface VectorSearchArgs {
  /** Classic vector index: the embedded query. */
  queryVector?: number[];
  /** Atlas auto-embedding index: the raw query text, embedded by Atlas. */
  queryText?: string;
  /** Pre-filter applied inside the vector search, before candidates are scored. */
  filter: Filter;
  limit: number;
  numCandidates: number;
}

export type ScoredMemory = Omit<Memory, "embedding"> & { similarity: number };

export interface Store {
  kind: "atlas" | "demo";
  label: string;
  firms: Coll<Firm>;
  users: Coll<User>;
  clients: Coll<Client>;
  sources: Coll<Source>;
  memories: Coll<Memory>;
  tasks: Coll<Task>;
  runs: Coll<Run>;
  audit: Coll<AuditEvent>;
  tombstones: Coll<Tombstone>;
  /** Simulated lender policies (bank × product), versioned. Collection: lender_policies. */
  lenderPolicies: Coll<LenderPolicy>;
  vectorSearchMemories(args: VectorSearchArgs): Promise<ScoredMemory[]>;
  /** Drop all application data (used by seed / demo reset). */
  wipe(): Promise<void>;
}
