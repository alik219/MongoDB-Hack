/**
 * Seeds synthetic demo data into the configured store.
 *   MONGODB_URI set   → seeds Atlas (embeddings use the configured provider)
 *   MONGODB_URI unset → seeds the local demo store file (.data/demo-store.json)
 * Run `npm run atlas:setup` first when targeting Atlas.
 *
 * Against Atlas it also stores the raw (sanitized) hackathon dataset in dataset_profiles,
 * dataset_goals and dataset_meeting_notes, so the Go tool service and Atlas tooling can read it.
 */
import { MongoClient } from "mongodb";
import { getConfig, serviceLabels } from "../src/lib/config";
import { loadRawDataset } from "../src/lib/hackathon";
import { getStore } from "../src/lib/store";
import { seedDemoData } from "../src/lib/seed";

async function main() {
  const cfg = getConfig();
  console.log("Seeding with:", serviceLabels(cfg));
  const store = await getStore();
  await store.wipe();
  await seedDemoData(store);
  console.log(`Seeded ${await store.memories.count({})} memories, ${await store.clients.count({})} clients, ${await store.lenderPolicies.count({})} lender policies.`);

  if (cfg.storage.kind === "atlas") {
    const client = await new MongoClient(cfg.storage.uri!).connect();
    const db = client.db(cfg.storage.dbName);
    const raw = loadRawDataset();
    for (const [name, docs] of [
      ["dataset_profiles", raw.profiles],
      ["dataset_goals", raw.goals],
      ["dataset_meeting_notes", raw.notes],
    ] as const) {
      await db.collection(name).deleteMany({});
      await db.collection(name).insertMany(docs as unknown as Record<string, unknown>[]);
      console.log(`✓ ${name}: ${docs.length}`);
    }
    await client.close();
  }
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
