import { beforeEach, describe, expect, it } from "vitest";
import { authorizeClient, contextForUser } from "@/lib/auth";
import { evaluatePolicy, parseCondition, type Facts } from "@/lib/lender/engine";
import { loadLenderPolicies } from "@/lib/hackathon";
import type { Store } from "@/lib/store/types";
import { getRun, runAgent } from "@/lib/services/agent";
import { correctMemory, extractFromSource, forgetMemory, listSources } from "@/lib/services/memories";
import { freshStore } from "./helpers";

let store: Store;
beforeEach(async () => {
  store = await freshStore();
});

const tomas = () => contextForUser("usr_tomas");
const riya = () => contextForUser("usr_riya");
const daniel = () => contextForUser("usr_daniel");
const PRIYA = "cli_c3_priya";
const decisions = (run: { lenderChecks?: { bank: string; product: string; decision: string }[] }, product: string) =>
  Object.fromEntries((run.lenderChecks ?? []).filter((c) => c.product === product).map((c) => [c.bank, c.decision]));

describe("hackathon dataset", () => {
  it("loads 4 clients, all notes as sources, and 9 current lender policies; no SIN or business number is stored", async () => {
    expect(await store.clients.count({ firmId: "frm_lakeshore" })).toBe(4);
    expect(await store.sources.count({ firmId: "frm_lakeshore", kind: "meeting_note" })).toBe(80);
    expect(await store.lenderPolicies.count({ status: "current" })).toBe(9);
    const all = await store.sources.find({ firmId: "frm_lakeshore" });
    expect(all.some((s) => /000-000-00\d/.test(s.text) || /000000000 RC/.test(s.text))).toBe(false);
  });

  it("each client is its own team: one advisor cannot reach another advisor's client", async () => {
    await expect(authorizeClient(await daniel(), PRIYA)).rejects.toMatchObject({ status: 403 });
    await expect(authorizeClient(await contextForUser("usr_maya"), PRIYA)).rejects.toMatchObject({ status: 404 });
  });
});

describe("lender policy engine", () => {
  it("parses only simple policy conditions", () => {
    expect(parseCondition("credit_score < 620")).toEqual({ ident: "credit_score", op: "<", value: 620 });
    expect(() => parseCondition("process.exit()")).toThrow();
  });

  it("CIBC counts assets at CIBC as income; RBC and TD do not (same client, three banks)", () => {
    const facts: Facts = {
      credit_score: { key: "credit_score", value: 760 },
      annual_income: { key: "annual_income", value: 40000, memoryId: "m_income" },
      investable_assets_at_cibc: { key: "investable_assets_at_cibc", value: 900000, memoryId: "m_assets" },
      mortgage_down_payment_pct: { key: "mortgage_down_payment_pct", value: 0.2 },
      mortgage_stressed_gds: { key: "mortgage_stressed_gds", value: 0.5 },
      mortgage_stressed_tds: { key: "mortgage_stressed_tds", value: 0.55 },
    };
    const policies = loadLenderPolicies().filter((p) => p.product === "mortgage");
    const by = Object.fromEntries(policies.map((p) => [p.bank, evaluatePolicy(p, facts)!]));
    expect(by.CIBC.decision).toBe("approve");
    expect(by.RBC.decision).toBe("decline");
    expect(by.TD.decision).toBe("decline");
    // Counterfactual: the CIBC approval depends on the remembered assets.
    expect(by.CIBC.pivotalFacts.find((p) => p.factKey === "investable_assets_at_cibc")).toMatchObject({
      memoryId: "m_assets",
      decisionWithout: "decline",
    });
  });
});

describe("governed memory changes the lender outcome", () => {
  it("the advisor sees only the score band, so RBC's 720 card floor is a refer; the adjudicator's exact score resolves it", async () => {
    const adv = await runAgent(await tomas(), PRIYA, "Prepare business card options for Priya.");
    expect(decisions(adv.run, "business_credit_card")).toEqual({ CIBC: "approve", RBC: "refer", TD: "approve" });
    const adj = await runAgent(await riya(), PRIYA, "Prepare business card options for Priya.");
    expect(decisions(adj.run, "business_credit_card").RBC).toBe("approve");
    // The adjudicator's run used the restricted score: the advisor cannot read those checks afterwards.
    const seen = await getRun(await tomas(), adj.run._id);
    expect(seen.lenderChecks?.some((c) => c.bank === "RBC" && c.product === "business_credit_card")).toBe(false);
    expect(JSON.stringify(seen)).not.toContain("745");
  });

  it("correcting the move-up TDS (guaranteed business debt counted) flips the next run's mortgage decisions", async () => {
    const before = await runAgent(await tomas(), PRIYA, "Prepare mortgage options for Priya's move-up home.");
    expect(decisions(before.run, "mortgage")).toEqual({ CIBC: "approve", RBC: "approve", TD: "approve" });
    const fact = (await store.memories.find({ clientId: PRIYA, status: "active", "structured.topic": "move_up_mortgage_request" }))[0];
    await correctMemory(await tomas(), fact._id, {
      statement: "Move-up home stressed TDS is 54.1% once guaranteed business payments are counted.",
      // Sent as text, as a form would: the service must keep these numeric for the lender engine.
      attributes: { mortgage_down_payment_pct: "0.361", mortgage_stressed_gds: "0.344", mortgage_stressed_tds: "0.541" },
      reason: "Lenders count the personal guarantee",
    });
    const after = await runAgent(await tomas(), PRIYA, "Prepare mortgage options for Priya's move-up home.");
    expect(decisions(after.run, "mortgage")).toEqual({ CIBC: "decline", RBC: "decline", TD: "decline" });
    const revised = after.run.appliedActions.find((a) => a.taskKey === "prepare_mortgage_options");
    expect(revised?.type).toBe("revise_task");
    expect(revised?.memoryRefs.some((r) => r.version === 2)).toBe(true);
  });

  it("forgetting the score band removes the advisor's basis for a decision: credit gates become refer", async () => {
    const band = (await store.memories.find({ clientId: PRIYA, status: "active", "structured.topic": "credit_score_band" }))[0];
    await forgetMemory(await tomas(), band._id, "Score band outdated");
    const run = await runAgent(await tomas(), PRIYA, "Prepare line of credit options for Priya.");
    expect(Object.values(decisions(run.run, "personal_line_of_credit"))).toEqual(["refer", "refer", "refer"]);
  });

  it("with persistent memory off, no facts reach the engine", async () => {
    const run = await runAgent(await tomas(), PRIYA, "Prepare mortgage options.", { memoryMode: "none", persist: false });
    expect(run.run.lenderChecks).toEqual([]);
  });
});

describe("technical trace and dataset documents", () => {
  it("records the retrieval query with the server-built access filter, and the policy versions evaluated", async () => {
    const tomas = await contextForUser("usr_tomas");
    const { run } = await runAgent(tomas, "cli_c3_priya", "Prepare mortgage options");
    const r = run.trace!.retrieval!;
    const filter = JSON.stringify(JSON.parse(r.filterJson));
    expect(filter).toContain('"firmId":"frm_lakeshore"');
    expect(filter).toContain('"clientId":"cli_c3_priya"');
    expect(filter).toContain("usr_tomas");
    expect(r.returned - r.droppedAfterRecheck).toBeLessThanOrEqual(run.retrieved.length);
    expect(run.trace!.policies.map((p) => p.bank).sort()).toEqual(["CIBC", "RBC", "TD"]);
    expect(run.trace!.policies.every((p) => p.contentHash.length >= 12)).toBe(true);
    expect(run.trace!.planner.lenderChecksSent).toBe(3);
  });

  it("lists a client's stored documents without text, and only to an assigned advisor", async () => {
    const tomas = await contextForUser("usr_tomas");
    const rows = await listSources(tomas, "cli_c3_priya");
    expect(rows.filter((r) => r.kind === "meeting_note").length).toBe(20);
    expect(rows.some((r) => r.kind === "client_profile")).toBe(true);
    expect(rows.every((r) => !("text" in r))).toBe(true);
    const daniel = await contextForUser("usr_daniel");
    await expect(listSources(daniel, "cli_c3_priya")).rejects.toMatchObject({ status: 403 });
  });

  it("extracting from a stored note only creates proposals, which the next run ignores", async () => {
    const tomas = await contextForUser("usr_tomas");
    const note = (await listSources(tomas, "cli_c3_priya")).find((r) => r.kind === "meeting_note")!;
    const before = await runAgent(tomas, "cli_c3_priya", "Prepare mortgage options", { persist: false });
    const res = await extractFromSource(tomas, note._id);
    expect(res.sourceId).toBe(note._id);
    expect(res.proposals.every((p) => p.status === "proposed")).toBe(true);
    const after = await runAgent(tomas, "cli_c3_priya", "Prepare mortgage options", { persist: false });
    expect(after.run.lenderChecks!.map((c) => c.decision)).toEqual(before.run.lenderChecks!.map((c) => c.decision));
    const daniel = await contextForUser("usr_daniel");
    await expect(extractFromSource(daniel, note._id)).rejects.toMatchObject({ status: 403 });
  });
});

describe("offline extraction from a dataset note", () => {
  it("turns the note's bullets into proposals that quote the note verbatim", async () => {
    const tomas = await contextForUser("usr_tomas");
    const note = (await listSources(tomas, "cli_c3_priya")).find((r) => r._id === "src_c3_20261103")!;
    const res = await extractFromSource(tomas, note._id);
    expect(res.proposals.length).toBeGreaterThan(3);
    const src = (await store.sources.findOne({ _id: note._id }))!;
    for (const p of res.proposals) expect(src.text).toContain(p.evidence[0].excerpt);
    expect(res.proposals.some((p) => p.category === "goal" && /Sale of the business/.test(p.statement))).toBe(true);
    const again = await extractFromSource(tomas, note._id);
    expect(again.proposals.length).toBe(0);
  });
});

describe("chat", () => {
  it("answers from authorized memories only and rejects an unassigned advisor", async () => {
    const { chat } = await import("@/lib/services/chat");
    const reply = await chat(await tomas(), PRIYA, [{ role: "user", content: "What do we know about Priya's income?" }]);
    expect(reply.retrieved).toBeGreaterThan(0);
    expect(reply.citations.length).toBeGreaterThan(0);
    const mems = await store.memories.find({ clientId: PRIYA });
    for (const c of reply.citations) expect(mems.some((m) => m._id === c.memoryId)).toBe(true);
    await expect(chat(await daniel(), PRIYA, [{ role: "user", content: "income?" }])).rejects.toMatchObject({ status: 403 });
  });

  it("falls back to structured retrieval when vector search is unavailable", async () => {
    const { chat } = await import("@/lib/services/chat");
    store.vectorSearchMemories = async () => {
      throw new Error("Embedding provider rate limit exceeded, retry later");
    };
    const reply = await chat(await tomas(), PRIYA, [{ role: "user", content: "Summarise Priya" }]);
    expect(reply.engine).toMatch(/structured fallback/);
    expect(reply.retrieved).toBeGreaterThan(0);
    const { run } = await runAgent(await tomas(), PRIYA, "Prepare the review");
    expect(run.status).not.toBe("failed");
    expect(run.trace?.retrieval?.engine).toMatch(/structured fallback/);
  });
});

describe("provider errors", () => {
  it("explains an exhausted OpenAI balance in plain words, without raw JSON", async () => {
    const { openaiErrorMessage } = await import("@/lib/ai/llm");
    const msg = openaiErrorMessage(
      429,
      JSON.stringify({ error: { message: "You have no credits remaining.", type: "insufficient_quota", code: "credit_balance_exhausted" } }),
    );
    expect(msg).toMatch(/no credits left/);
    expect(msg).not.toMatch(/[{}]/);
  });
});
