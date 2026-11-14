import { contextForUser } from "@/lib/auth";
import { seedDemoData } from "@/lib/seed";
import { setStoreForTests } from "@/lib/store";
import { createDemoStore } from "@/lib/store/demo-store";
import { SAMPLE_NOTES } from "@/lib/samples";
import { approveProposal, ingestNote } from "@/lib/services/memories";
import { clock } from "@/lib/util";

export const REQUEST = "Prepare Sarah's quarterly review and create the appropriate follow-ups.";

export async function freshStore() {
  delete process.env.MONGODB_URI;
  const store = createDemoStore();
  setStoreForTests(store);
  clock.set(() => new Date("2026-11-14T16:00:00.000Z"));
  await seedDemoData(store);
  return store;
}

export const maya = () => contextForUser("usr_maya");
export const jordan = () => contextForUser("usr_jordan");
export const elena = () => contextForUser("usr_elena");

export function sample(id: string) {
  const s = SAMPLE_NOTES.find((n) => n.id === id)!;
  return { clientId: s.clientId, title: s.title, kind: s.kind, sourceDate: s.sourceDate, text: s.text };
}

/** Ingest a sample note as Maya and approve every proposal. */
export async function ingestAndApprove(id: string) {
  const ctx = await maya();
  const res = await ingestNote(ctx, sample(id));
  for (const p of res.proposals) await approveProposal(ctx, p._id);
  return res;
}
