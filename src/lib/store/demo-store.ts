import fs from "node:fs";
import path from "node:path";
import type { Coll, Filter, FindOptions, ScoredMemory, Store, Update, VectorSearchArgs } from "./types";
import type { Memory } from "../types";
import { cosine, demoEmbed } from "../ai/embeddings";

/**
 * DEMO MODE STORE. An in-process document store that evaluates the same filter
 * objects the Atlas path sends to MongoDB. Vector search here is exact cosine
 * similarity computed in application code; it is NOT Atlas Vector Search.
 */

/** Resolves dotted paths, traversing arrays like MongoDB ("dependsOn.lineageId" → array of values). */
function getPath(doc: unknown, p: string): unknown {
  let cur: unknown = doc;
  for (const part of p.split(".")) {
    if (Array.isArray(cur)) {
      cur = cur.flatMap((el) => {
        const v = el != null && typeof el === "object" ? (el as Record<string, unknown>)[part] : undefined;
        return v === undefined ? [] : Array.isArray(v) ? v : [v];
      });
      continue;
    }
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function comparable(v: unknown): unknown {
  if (v instanceof Date) return v.getTime();
  return v;
}

function eq(a: unknown, b: unknown): boolean {
  const ca = comparable(a);
  const cb = comparable(b);
  if (ca === cb) return true;
  if (ca === undefined && cb === null) return true;
  return false;
}

function matchCondition(value: unknown, cond: unknown): boolean {
  const values = Array.isArray(value) ? value : [value];
  if (cond && typeof cond === "object" && !Array.isArray(cond) && !(cond instanceof Date)) {
    const ops = cond as Record<string, unknown>;
    const keys = Object.keys(ops);
    if (keys.length && keys.every((k) => k.startsWith("$"))) {
      return keys.every((op) => {
        const arg = ops[op];
        switch (op) {
          case "$eq":
            return values.some((v) => eq(v, arg));
          case "$ne":
            return !values.some((v) => eq(v, arg));
          case "$in":
            return (arg as unknown[]).some((a) => values.some((v) => eq(v, a)));
          case "$nin":
            return !(arg as unknown[]).some((a) => values.some((v) => eq(v, a)));
          case "$gt":
            return values.some((v) => v != null && (comparable(v) as number) > (comparable(arg) as number));
          case "$gte":
            return values.some((v) => v != null && (comparable(v) as number) >= (comparable(arg) as number));
          case "$lt":
            return values.some((v) => v != null && (comparable(v) as number) < (comparable(arg) as number));
          case "$lte":
            return values.some((v) => v != null && (comparable(v) as number) <= (comparable(arg) as number));
          case "$exists":
            return arg ? value !== undefined : value === undefined;
          default:
            throw new Error(`Unsupported operator in demo store: ${op}`);
        }
      });
    }
  }
  return values.some((v) => eq(v, cond)) || eq(value, cond);
}

export function matches(doc: unknown, filter: Filter): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    if (key === "$or") return (cond as Filter[]).some((f) => matches(doc, f));
    if (key === "$and") return (cond as Filter[]).every((f) => matches(doc, f));
    return matchCondition(getPath(doc, key), cond);
  });
}

function setPath(doc: Record<string, unknown>, p: string, v: unknown) {
  const parts = p.split(".");
  let cur = doc;
  for (const part of parts.slice(0, -1)) {
    if (typeof cur[part] !== "object" || cur[part] == null) cur[part] = {};
    cur = cur[part] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = v;
}

function unsetPath(doc: Record<string, unknown>, p: string) {
  const parts = p.split(".");
  let cur = doc;
  for (const part of parts.slice(0, -1)) {
    if (typeof cur[part] !== "object" || cur[part] == null) return;
    cur = cur[part] as Record<string, unknown>;
  }
  delete cur[parts[parts.length - 1]];
}

function applyUpdate(doc: Record<string, unknown>, update: Update) {
  for (const [k, v] of Object.entries(update.$set ?? {})) setPath(doc, k, structuredClone(v));
  for (const k of Object.keys(update.$unset ?? {})) unsetPath(doc, k);
  for (const [k, v] of Object.entries(update.$push ?? {})) {
    const arr = (getPath(doc, k) as unknown[]) ?? [];
    arr.push(structuredClone(v));
    setPath(doc, k, arr);
  }
}

class MemColl<T extends { _id: string }> implements Coll<T> {
  constructor(
    public docs: Map<string, T>,
    private onChange: () => void,
  ) {}

  async findOne(filter: Filter) {
    for (const d of this.docs.values()) if (matches(d, filter)) return structuredClone(d);
    return null;
  }

  async find(filter: Filter, opts: FindOptions = {}) {
    let out = [...this.docs.values()].filter((d) => matches(d, filter));
    if (opts.sort) {
      const [[field, dir]] = Object.entries(opts.sort);
      out.sort((a, b) => {
        const av = comparable(getPath(a, field)) as number | string;
        const bv = comparable(getPath(b, field)) as number | string;
        return av < bv ? -dir : av > bv ? dir : 0;
      });
    }
    if (opts.limit) out = out.slice(0, opts.limit);
    return out.map((d) => structuredClone(d));
  }

  async count(filter: Filter) {
    return [...this.docs.values()].filter((d) => matches(d, filter)).length;
  }

  async insertOne(doc: T) {
    if (this.docs.has(doc._id)) throw new Error(`Duplicate _id ${doc._id}`);
    this.docs.set(doc._id, structuredClone(doc));
    this.onChange();
  }

  async insertMany(docs: T[]) {
    for (const d of docs) await this.insertOne(d);
  }

  async updateOne(filter: Filter, update: Update) {
    for (const d of this.docs.values()) {
      if (matches(d, filter)) {
        applyUpdate(d as unknown as Record<string, unknown>, update);
        this.onChange();
        return { matched: 1 };
      }
    }
    return { matched: 0 };
  }

  async updateMany(filter: Filter, update: Update) {
    let matched = 0;
    for (const d of this.docs.values()) {
      if (matches(d, filter)) {
        applyUpdate(d as unknown as Record<string, unknown>, update);
        matched++;
      }
    }
    if (matched) this.onChange();
    return { matched };
  }

  async deleteMany(filter: Filter) {
    let n = 0;
    for (const [id, d] of this.docs) {
      if (matches(d, filter)) {
        this.docs.delete(id);
        n++;
      }
    }
    if (n) this.onChange();
    return n;
  }
}

const COLLECTIONS = [
  "firms",
  "users",
  "clients",
  "sources",
  "memories",
  "tasks",
  "runs",
  "audit",
  "tombstones",
  "lenderPolicies",
] as const;

export function createDemoStore(opts: { persistPath?: string } = {}): Store {
  const maps: Record<string, Map<string, { _id: string }>> = {};
  for (const c of COLLECTIONS) maps[c] = new Map();

  if (opts.persistPath && fs.existsSync(opts.persistPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(opts.persistPath, "utf8")) as Record<string, { _id: string }[]>;
      for (const c of COLLECTIONS) {
        for (const d of raw[c] ?? []) {
          const doc = d as Record<string, unknown>;
          if (c === "memories" && typeof doc.retrievalExpiresAt === "string") {
            doc.retrievalExpiresAt = new Date(doc.retrievalExpiresAt);
          }
          maps[c].set(d._id, d);
        }
      }
    } catch {
      // corrupt demo file: start empty; seed will repopulate
    }
  }

  let timer: NodeJS.Timeout | null = null;
  const onChange = () => {
    if (!opts.persistPath) return;
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      const out: Record<string, unknown[]> = {};
      for (const c of COLLECTIONS) out[c] = [...maps[c].values()];
      fs.mkdirSync(path.dirname(opts.persistPath!), { recursive: true });
      fs.writeFileSync(opts.persistPath!, JSON.stringify(out));
    }, 50);
  };

  const coll = <T extends { _id: string }>(name: string) =>
    new MemColl<T>(maps[name] as unknown as Map<string, T>, onChange);

  const memories = coll<Memory>("memories");

  return {
    kind: "demo",
    label: "Demo store (in-process, not Atlas)",
    firms: coll("firms"),
    users: coll("users"),
    clients: coll("clients"),
    sources: coll("sources"),
    memories,
    tasks: coll("tasks"),
    runs: coll("runs"),
    audit: coll("audit"),
    tombstones: coll("tombstones"),
    lenderPolicies: coll("lenderPolicies"),
    async vectorSearchMemories(args: VectorSearchArgs): Promise<ScoredMemory[]> {
      // Same pre-filter semantics as Atlas: filter first, then score only eligible candidates.
      const candidates = [...memories.docs.values()].filter(
        (m) => (m.embedding || m.embeddingText) && matches(m, args.filter),
      );
      // Auto-embedding queries (queryText) are scored with the demo hash model in demo mode.
      const q = args.queryVector ?? demoEmbed(args.queryText ?? "", 256);
      return candidates
        .map((m) => {
          const { embedding, embeddingText, ...rest } = structuredClone(m);
          const v = args.queryVector && embedding ? embedding : demoEmbed(embeddingText ?? `${m.category}: ${m.statement}`, 256);
          return { ...rest, similarity: cosine(q, v) };
        })
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, args.limit);
    },
    async wipe() {
      for (const c of COLLECTIONS) maps[c].clear();
      onChange();
    },
  };
}
