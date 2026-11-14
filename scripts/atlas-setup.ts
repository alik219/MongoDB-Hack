/**
 * Creates collections with JSON-schema validation, standard indexes, and the Atlas Vector Search
 * index used for scoped memory retrieval. Idempotent. Requires MONGODB_URI (Atlas cluster, M0+).
 *
 * The vector index's numDimensions comes from the embedding config, and `embeddingModel` is a
 * filter field, so vectors from a different model are never mixed into the same retrieval.
 */
import { MongoClient } from "mongodb";
import { getConfig } from "../src/lib/config";
import { VECTOR_INDEX_NAME } from "../src/lib/store/mongo-store";

const str = { bsonType: "string" };
const validators: Record<string, object> = {
  firms: { $jsonSchema: { bsonType: "object", required: ["_id", "name"], properties: { _id: str, name: str } } },
  users: {
    $jsonSchema: {
      bsonType: "object",
      required: ["_id", "firmId", "name", "role", "clientIds"],
      properties: { role: { enum: ["lead_advisor", "associate"] }, clientIds: { bsonType: "array", items: str } },
    },
  },
  clients: {
    $jsonSchema: { bsonType: "object", required: ["_id", "firmId", "name", "leadAdvisorId", "teamUserIds"] },
  },
  sources: {
    $jsonSchema: {
      bsonType: "object",
      required: ["_id", "firmId", "clientId", "kind", "text", "contentHash", "sourceDate"],
      properties: { kind: { enum: ["meeting_note", "client_message", "advisor_note", "client_profile", "client_goals"] } },
    },
  },
  memories: {
    $jsonSchema: {
      bsonType: "object",
      required: ["_id", "lineageId", "version", "firmId", "clientId", "category", "statement", "status", "basis", "visibility", "allowedUserIds", "retrievalExpiresAt", "evidence"],
      properties: {
        version: { bsonType: ["int", "long", "double"], minimum: 1 },
        status: { enum: ["proposed", "active", "superseded", "forgotten", "rejected"] },
        basis: { enum: ["source_supported", "advisor_confirmed"] },
        category: { enum: ["goal", "constraint", "previous_decision", "revisit_condition", "preference", "advisor_commitment", "life_event", "financial_fact"] },
        visibility: { enum: ["team", "restricted"] },
        allowedUserIds: { bsonType: "array", items: str },
        retrievalExpiresAt: { bsonType: "date" },
        evidence: {
          bsonType: "array",
          items: { bsonType: "object", required: ["sourceId", "excerpt", "sourceDate"] },
        },
      },
    },
  },
  tasks: {
    $jsonSchema: {
      bsonType: "object",
      required: ["_id", "firmId", "clientId", "key", "title", "status", "dependsOn", "visibility", "createdByRunId"],
      properties: { status: { enum: ["draft", "approved", "done", "withdrawn"] } },
    },
  },
  runs: { $jsonSchema: { bsonType: "object", required: ["_id", "firmId", "clientId", "actorId", "status", "createdAt"] } },
  audit_events: { $jsonSchema: { bsonType: "object", required: ["_id", "firmId", "actorId", "type", "at"] } },
  forget_tombstones: {
    $jsonSchema: { bsonType: "object", required: ["_id", "firmId", "clientId", "lineageId", "fingerprints", "forgottenAt"] },
  },
  lender_policies: {
    $jsonSchema: {
      bsonType: "object",
      required: ["_id", "bank", "product", "version", "status", "decisionRules", "contentHash"],
      properties: { product: { enum: ["mortgage", "personal_line_of_credit", "business_credit_card"] } },
    },
  },
};

const indexes: Record<string, [Record<string, 1 | -1>, object?][]> = {
  users: [[{ firmId: 1 }]],
  clients: [[{ firmId: 1 }]],
  sources: [[{ firmId: 1, clientId: 1, createdAt: -1 }]],
  memories: [
    [{ firmId: 1, clientId: 1, status: 1 }],
    [{ lineageId: 1, version: 1 }, { unique: true, partialFilterExpression: { status: { $in: ["active", "superseded"] } } }],
    [{ firmId: 1, clientId: 1, fingerprint: 1 }],
    [{ "evidence.sourceId": 1 }],
  ],
  tasks: [[{ firmId: 1, clientId: 1, status: 1 }], [{ "dependsOn.lineageId": 1 }], [{ firmId: 1, clientId: 1, key: 1, status: 1 }]],
  runs: [[{ firmId: 1, clientId: 1, createdAt: -1 }]],
  audit_events: [
    [{ firmId: 1, clientId: 1, at: -1 }],
    [{ targetId: 1 }],
    // One hash chain per firm: a sequence number can be used once (see src/lib/audit-chain.ts).
    [{ firmId: 1, seq: 1 }, { unique: true, partialFilterExpression: { seq: { $exists: true } } }],
  ],
  forget_tombstones: [[{ firmId: 1, clientId: 1 }], [{ fingerprints: 1 }]],
  lender_policies: [[{ product: 1, status: 1 }]],
};

async function main() {
  const cfg = getConfig();
  if (!cfg.storage.uri) throw new Error("Set MONGODB_URI to your Atlas connection string.");
  const client = await new MongoClient(cfg.storage.uri).connect();
  const db = client.db(cfg.storage.dbName);
  const existing = new Set((await db.listCollections().toArray()).map((c) => c.name));
  for (const [name, validator] of Object.entries(validators)) {
    if (existing.has(name)) await db.command({ collMod: name, validator, validationLevel: "strict" });
    else await db.createCollection(name, { validator, validationLevel: "strict" });
    for (const [keys, opts] of indexes[name] ?? []) await db.collection(name).createIndex(keys, opts ?? {});
    console.log(`✓ ${name}`);
  }

  // atlas-auto: Atlas embeds `embeddingText` itself (Voyage, managed by Atlas) and embeds query text at search time.
  const vectorField =
    cfg.embedding.provider === "atlas-auto"
      ? { type: "autoEmbed", path: "embeddingText", model: cfg.embedding.model, modality: "text" }
      : { type: "vector", path: "embedding", numDimensions: cfg.embedding.dims, similarity: "cosine" };
  const definition = {
    fields: [
      vectorField,
      { type: "filter", path: "firmId" },
      { type: "filter", path: "clientId" },
      { type: "filter", path: "status" },
      { type: "filter", path: "visibility" },
      { type: "filter", path: "allowedUserIds" },
      { type: "filter", path: "retrievalExpiresAt" },
      { type: "filter", path: "embeddingModel" },
    ],
  };
  const memories = db.collection("memories");
  const current = await memories.listSearchIndexes(VECTOR_INDEX_NAME).toArray();
  if (current.length) {
    await memories.updateSearchIndex(VECTOR_INDEX_NAME, definition);
    console.log(`✓ updated vector index ${VECTOR_INDEX_NAME} (${cfg.embedding.dims}d, ${cfg.embedding.id})`);
  } else {
    await memories.createSearchIndex({ name: VECTOR_INDEX_NAME, type: "vectorSearch", definition });
    console.log(`✓ created vector index ${VECTOR_INDEX_NAME} (${cfg.embedding.dims}d, ${cfg.embedding.id})`);
  }
  console.log("Waiting for the vector index to become queryable…");
  for (let i = 0; i < 60; i++) {
    const [idx] = (await memories.listSearchIndexes(VECTOR_INDEX_NAME).toArray()) as { queryable?: boolean }[];
    if (idx?.queryable) {
      console.log("✓ vector index is queryable");
      break;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
