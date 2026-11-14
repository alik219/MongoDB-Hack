import { MongoClient, type Collection, type Db, type Document } from "mongodb";
import type { Coll, Filter, FindOptions, ScoredMemory, Store, Update, VectorSearchArgs } from "./types";
import type { Memory } from "../types";

/**
 * LIVE PATH: MongoDB Atlas via the official Node.js driver.
 * Vector retrieval uses the Atlas `$vectorSearch` aggregation stage with a
 * pre-filter on indexed `filter` fields (see scripts/atlas-setup.ts).
 */

class MongoColl<T extends { _id: string }> implements Coll<T> {
  constructor(private c: Collection<Document>) {}
  async findOne(filter: Filter) {
    return (await this.c.findOne(filter)) as unknown as T | null;
  }
  async find(filter: Filter, opts: FindOptions = {}) {
    let cur = this.c.find(filter);
    if (opts.sort) cur = cur.sort(opts.sort);
    if (opts.limit) cur = cur.limit(opts.limit);
    return (await cur.toArray()) as unknown as T[];
  }
  async count(filter: Filter) {
    return this.c.countDocuments(filter);
  }
  async insertOne(doc: T) {
    await this.c.insertOne(doc as unknown as Document);
  }
  async insertMany(docs: T[]) {
    if (docs.length) await this.c.insertMany(docs as unknown as Document[]);
  }
  async updateOne(filter: Filter, update: Update) {
    const r = await this.c.updateOne(filter, toMongoUpdate(update));
    return { matched: r.matchedCount };
  }
  async updateMany(filter: Filter, update: Update) {
    const r = await this.c.updateMany(filter, toMongoUpdate(update));
    return { matched: r.matchedCount };
  }
  async deleteMany(filter: Filter) {
    return (await this.c.deleteMany(filter)).deletedCount;
  }
}

function toMongoUpdate(u: Update): Document {
  const out: Document = {};
  if (u.$set && Object.keys(u.$set).length) out.$set = u.$set;
  if (u.$unset && Object.keys(u.$unset).length) out.$unset = u.$unset;
  if (u.$push && Object.keys(u.$push).length) out.$push = u.$push;
  return out;
}

export const VECTOR_INDEX_NAME = process.env.ATLAS_VECTOR_INDEX ?? "memory_vector_index";

const g = globalThis as unknown as { __continuityMongo?: Promise<MongoClient> };

export async function connectMongo(uri: string): Promise<MongoClient> {
  if (!g.__continuityMongo) {
    g.__continuityMongo = new MongoClient(uri, {
      appName: "continuity",
      serverSelectionTimeoutMS: 8000,
    }).connect();
    g.__continuityMongo.catch(() => {
      g.__continuityMongo = undefined;
    });
  }
  return g.__continuityMongo;
}

export function createMongoStore(db: Db): Store {
  const c = <T extends { _id: string }>(name: string) => new MongoColl<T>(db.collection(name));
  const memoriesRaw = db.collection("memories");
  return {
    kind: "atlas",
    label: `MongoDB Atlas (${db.databaseName})`,
    firms: c("firms"),
    users: c("users"),
    clients: c("clients"),
    sources: c("sources"),
    memories: c<Memory>("memories"),
    tasks: c("tasks"),
    runs: c("runs"),
    audit: c("audit_events"),
    tombstones: c("forget_tombstones"),
    lenderPolicies: c("lender_policies"),
    async vectorSearchMemories(args: VectorSearchArgs): Promise<ScoredMemory[]> {
      const pipeline: Document[] = [
        {
          $vectorSearch: {
            index: VECTOR_INDEX_NAME,
            // Auto-embedding indexes the text field; Atlas embeds the query text with the same model.
            path: args.queryText !== undefined && !args.queryVector ? "embeddingText" : "embedding",
            ...(args.queryText !== undefined && !args.queryVector
              ? { query: { text: args.queryText } }
              : { queryVector: args.queryVector }),
            numCandidates: args.numCandidates,
            limit: args.limit,
            filter: args.filter,
          },
        },
        { $set: { similarity: { $meta: "vectorSearchScore" } } },
        { $project: { embedding: 0, embeddingText: 0 } },
      ];
      return (await memoriesRaw.aggregate(pipeline).toArray()) as unknown as ScoredMemory[];
    },
    async wipe() {
      for (const name of [
        "firms",
        "users",
        "clients",
        "sources",
        "memories",
        "tasks",
        "runs",
        "audit_events",
        "forget_tombstones",
        "lender_policies",
      ]) {
        await db.collection(name).deleteMany({});
      }
    },
  };
}
