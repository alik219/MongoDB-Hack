import path from "node:path";
import { getConfig } from "../config";
import { createDemoStore } from "./demo-store";
import { connectMongo, createMongoStore } from "./mongo-store";
import type { Store } from "./types";
import { seedDemoData } from "../seed";

const g = globalThis as unknown as { __continuityStore?: Promise<Store>; __continuityTestStore?: Store };

/** Tests inject a store directly. */
export function setStoreForTests(store: Store | undefined) {
  g.__continuityTestStore = store;
}

async function init(): Promise<Store> {
  const cfg = getConfig();
  if (cfg.storage.kind === "atlas") {
    const client = await connectMongo(cfg.storage.uri!);
    return createMongoStore(client.db(cfg.storage.dbName));
  }
  const store = createDemoStore({
    persistPath: process.env.DEMO_STORE_PATH ?? path.join(process.cwd(), ".data", "demo-store.json"),
  });
  if ((await store.firms.count({})) === 0) await seedDemoData(store);
  return store;
}

export async function getStore(): Promise<Store> {
  if (g.__continuityTestStore) return g.__continuityTestStore;
  if (!g.__continuityStore) {
    g.__continuityStore = init();
    g.__continuityStore.catch(() => {
      g.__continuityStore = undefined;
    });
  }
  return g.__continuityStore;
}
