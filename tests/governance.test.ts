import { beforeEach, describe, expect, it } from "vitest";
import { GENESIS_HASH, verifyAuditChain } from "@/lib/audit-chain";
import { checkMemoryContent } from "@/lib/memory-gate";
import type { Store } from "@/lib/store/types";
import { correctMemory, ingestNote } from "@/lib/services/memories";
import { freshStore, ingestAndApprove, maya, sample } from "./helpers";

let store: Store;
beforeEach(async () => {
  store = await freshStore();
});

const FIRM = "frm_northlight";

describe("tamper-evident audit log", () => {
  it("chains every event to the one before it, per firm", async () => {
    await ingestAndApprove("sarah_may");
    const events = await store.audit.find({ firmId: FIRM }, { sort: { seq: 1 } });
    expect(events.length).toBeGreaterThan(3);
    expect(events[0].seq).toBe(1);
    expect(events[0].prevHash).toBe(GENESIS_HASH);
    for (let i = 1; i < events.length; i++) {
      expect(events[i].seq).toBe(i + 1);
      expect(events[i].prevHash).toBe(events[i - 1].hash);
    }
    const v = await verifyAuditChain(store, FIRM);
    expect(v).toMatchObject({ ok: true, checked: events.length, unchained: 0, firstBadSeq: null });
    expect(v.headHash).toBe(events[events.length - 1].hash);
  });

  it("keeps the chain intact when events are written concurrently", async () => {
    const ctx = await maya();
    const res = await ingestNote(ctx, sample("sarah_may"));
    const { approveProposal } = await import("@/lib/services/memories");
    await Promise.all(res.proposals.map((p) => approveProposal(ctx, p._id)));
    expect((await verifyAuditChain(store, FIRM)).ok).toBe(true);
  });

  it("detects an edited event and names it", async () => {
    await ingestAndApprove("sarah_may");
    const [, second] = await store.audit.find({ firmId: FIRM }, { sort: { seq: 1 } });
    await store.audit.updateOne({ _id: second._id }, { $set: { actorId: "usr_someone_else" } });
    const v = await verifyAuditChain(store, FIRM);
    expect(v.ok).toBe(false);
    expect(v.firstBadSeq).toBe(2);
    expect(v.problem).toMatch(/edited/);
  });

  it("detects a deleted event", async () => {
    await ingestAndApprove("sarah_may");
    const [, second] = await store.audit.find({ firmId: FIRM }, { sort: { seq: 1 } });
    await store.audit.deleteMany({ _id: second._id });
    const v = await verifyAuditChain(store, FIRM);
    expect(v.ok).toBe(false);
    expect(v.firstBadSeq).toBe(3);
  });

  it("verifies each firm separately", async () => {
    await ingestAndApprove("sarah_may");
    const [first] = await store.audit.find({ firmId: FIRM }, { sort: { seq: 1 } });
    await store.audit.updateOne({ _id: first._id }, { $set: { type: "tampered" } });
    expect((await verifyAuditChain(store, FIRM)).ok).toBe(false);
    expect((await verifyAuditChain(store, "frm_harbor")).ok).toBe(true);
  });
});

describe("memory content gate", () => {
  it("rejects identifiers, credentials and exact credit scores", () => {
    expect(checkMemoryContent("Sarah's SIN is 123 456 789.")).toMatchObject({ ok: false, rule: "identifier" });
    expect(checkMemoryContent("Chequing account 123-456-789 is the main account.")).toMatchObject({ ok: false, rule: "identifier" });
    expect(checkMemoryContent("Her online banking password is hunter2.")).toMatchObject({ ok: false, rule: "credential" });
    expect(checkMemoryContent("Card PIN: 4821")).toMatchObject({ ok: false, rule: "credential" });
    expect(checkMemoryContent("Priya's credit score is 742.")).toMatchObject({ ok: false, rule: "exact_credit_score" });
  });

  it("allows bands, thresholds, amounts, dates and ordinary statements", () => {
    for (const ok of [
      "Priya's credit score band is Good (700 to 799).",
      "Credit score band: 700–799.",
      "RBC needs a principal credit score of at least 720 for the business card.",
      "Priya's household income used by lenders is $315,000 a year.",
      "Outstanding balance is $123,456,789.",
      "Sarah wants to keep six months of expenses in cash as a reserve.",
      "Her contract renews on 2026-09-15; revisit after renewal.",
      "She asked us to pin down a date for the next review.",
    ]) {
      expect(checkMemoryContent(ok), ok).toEqual({ ok: true });
    }
  });

  it("allows an exact score only in a restricted memory", () => {
    expect(checkMemoryContent("Priya's credit score is 742.", { visibility: "restricted" })).toEqual({ ok: true });
    expect(checkMemoryContent("Priya's credit score is 742.", { visibility: "team" }).ok).toBe(false);
  });

  it("withholds a gated statement at ingestion and records the rule, not the content", async () => {
    const ctx = await maya();
    const note = sample("sarah_may");
    const res = await ingestNote(ctx, {
      ...note,
      text: "Sarah decided against the previous proposal because her online banking password is Tulip-4491.",
    });
    expect(res.proposals).toHaveLength(0);
    expect(res.skipped.some((s) => /Credentials are never stored/.test(s.reason))).toBe(true);
    for (const p of res.proposals) expect(p.statement).not.toMatch(/Tulip-4491/);
    const stored = await store.memories.find({ clientId: "cli_sarah" });
    for (const m of stored) expect(m.statement).not.toMatch(/Tulip-4491/);
    const audits = await store.audit.find({ firmId: FIRM, type: "source.ingested" });
    expect(JSON.stringify(audits)).not.toMatch(/Tulip-4491/);
  });

  it("refuses a correction that adds an identifier, saves nothing, and audits the refusal", async () => {
    const ctx = await maya();
    const res = await ingestAndApprove("sarah_may");
    const target = res.proposals[0];
    const before = await store.memories.count({ clientId: "cli_sarah" });
    await expect(
      correctMemory(ctx, target._id, { statement: "Sarah's SIN is 123 456 789 and she supports her parents.", reason: "typo" }),
    ).rejects.toThrow(/SIN or account number/);
    expect(await store.memories.count({ clientId: "cli_sarah" })).toBe(before);
    expect((await store.memories.findOne({ _id: target._id }))!.status).toBe("active");
    const rejected = await store.audit.find({ firmId: FIRM, type: "memory.write_rejected" });
    expect(rejected).toHaveLength(1);
    expect(rejected[0].details).toMatchObject({ rule: "identifier" });
    expect(JSON.stringify(rejected)).not.toMatch(/123 456 789/);
  });
});
