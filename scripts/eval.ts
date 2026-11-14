/**
 * Scenario evaluation: runs the main demo story and the edge scenarios end to end against an
 * isolated in-process store, using the CONFIGURED planner/extractor and embeddings
 * (demo rules unless ANTHROPIC_API_KEY / embedding keys are set). Storage is always the
 * in-process store here so the evaluation never touches your Atlas data.
 * Writes docs/EVAL_RESULTS.md.
 */
import fs from "node:fs";
import { contextForUser } from "../src/lib/auth";
import { getConfig, serviceLabels } from "../src/lib/config";
import { seedDemoData } from "../src/lib/seed";
import { setStoreForTests } from "../src/lib/store";
import { createDemoStore } from "../src/lib/store/demo-store";
import { SAMPLE_NOTES, DEFAULT_REQUEST } from "../src/lib/samples";
import { runAgent } from "../src/lib/services/agent";
import { compareRuns } from "../src/lib/services/clients";
import { approveProposal, ingestNote } from "../src/lib/services/memories";
import { authorizeClient } from "../src/lib/auth";

interface Check {
  scenario: string;
  expected: string;
  observed: string;
  pass: boolean;
}
const checks: Check[] = [];
const check = (scenario: string, expected: string, observed: string, pass: boolean) =>
  checks.push({ scenario, expected, observed, pass });

const sample = (id: string) => {
  const s = SAMPLE_NOTES.find((n) => n.id === id)!;
  return { clientId: s.clientId, title: s.title, kind: s.kind, sourceDate: s.sourceDate, text: s.text };
};

async function main() {
  delete process.env.MONGODB_URI;
  const cfg = getConfig();
  const store = createDemoStore();
  setStoreForTests(store);
  await seedDemoData(store);
  const maya = await contextForUser("usr_maya");
  const jordan = await contextForUser("usr_jordan");
  const elena = await contextForUser("usr_elena");
  const REQ = DEFAULT_REQUEST.cli_sarah;
  const openKeys = async (clientId = "cli_sarah") =>
    (await store.tasks.find({ clientId, status: { $in: ["draft", "approved"] } })).map((t) => t.key).sort();
  const topics = async (ids: string[]) =>
    (await store.memories.find({ _id: { $in: ids } })).map((m) => m.structured.topic);

  // S1 ingestion → confirmation → fresh run
  const may = await ingestNote(maya, sample("sarah_may"));
  const mayTopics = may.proposals.map((p) => p.structured.topic).sort();
  check(
    "S1 Extraction",
    "4 separate proposals: family support, rejection reason, revisit condition, advisor commitment; excerpts verbatim",
    `${mayTopics.join(", ")}; verbatim=${may.proposals.every((p) => sample("sarah_may").text.includes(p.evidence[0].excerpt))}`,
    may.proposals.length >= 4 &&
      ["family_support", "prior_proposal_decision", "revisit_condition"].every((t) => mayTopics.includes(t)),
  );
  for (const p of may.proposals) await approveProposal(maya, p._id);
  const r1 = await runAgent(maya, "cli_sarah", REQ);
  const k1 = await openKeys();
  check(
    "S1 Fresh run uses confirmed memory",
    "Tasks to confirm renewal, clarify family support, and a gated revisit task",
    k1.join(", "),
    ["confirm_contract_renewal", "clarify_family_support", "revisit_deferred_proposal"].every((k) => k1.includes(k)),
  );

  // S2 repeat run is idempotent
  const r1b = await runAgent(maya, "cli_sarah", REQ);
  check(
    "S2 Repeat run",
    "No duplicate open tasks; all actions are keep",
    `${(await openKeys()).length} open (was ${k1.length}); actions: ${[...new Set(r1b.run.appliedActions.map((a) => a.type))].join(",")}`,
    (await openKeys()).length === k1.length && r1b.run.appliedActions.every((a) => a.type === "keep_task"),
  );

  // S3 correction → next run revises
  const nov = await ingestNote(maya, sample("sarah_nov"));
  check(
    "S3 Update detection",
    "Updates proposed for family support and revisit condition; nothing replaced before confirmation",
    nov.proposals.map((p) => `${p.structured.topic}:${p.proposal?.kind}`).join(", "),
    nov.proposals.some((p) => p.structured.topic === "family_support" && p.proposal?.kind === "update") &&
      (await store.memories.count({ clientId: "cli_sarah", status: "superseded" })) === 0,
  );
  for (const p of nov.proposals) await approveProposal(maya, p._id);
  const flagged = await store.tasks.count({ clientId: "cli_sarah", needsReview: true, status: "draft" });
  check("S3 Dependent drafts flagged", "Drafts depending on superseded memories marked for review", `${flagged} flagged`, flagged >= 3);
  const r2 = await runAgent(maya, "cli_sarah", REQ);
  const k2 = await openKeys();
  const withdrawn = r2.run.appliedActions.filter((a) => a.type === "withdraw_task").map((a) => a.taskKey);
  check(
    "S3 Corrected memory changes next action",
    "Withdraw confirm-renewal, clarify-family-support and gated revisit; create 'prepare deferred discussion'",
    `withdrawn: ${withdrawn.join(", ")}; open: ${k2.join(", ")}`,
    !k2.includes("confirm_contract_renewal") && !k2.includes("clarify_family_support") && k2.some((k) => /deferred|discussion|revisit/.test(k)),
  );
  const risk = await store.memories.find({ clientId: "cli_sarah", "structured.topic": "risk_tolerance" });
  check(
    "S3 No risk-tolerance inference",
    "Risk tolerance memory unchanged (single active v1)",
    risk.map((m) => `v${m.version}:${m.status}`).join(", "),
    risk.length === 1 && risk[0].status === "active",
  );
  check(
    "S3 Explanation",
    "Changed tasks cite the memory version change",
    r2.run.appliedActions.filter((a) => a.changedBecause?.length).map((a) => `${a.taskKey}: ${a.changedBecause![0]}`).slice(0, 2).join(" | "),
    r2.run.appliedActions.some((a) => a.changedBecause?.some((c) => /v1 → v2/.test(c))),
  );

  // S4/S5 isolation
  const allRetrieved = (await store.runs.find({ clientId: "cli_sarah" })).flatMap((r) => r.retrieved.map((x) => x.memoryId));
  const foreign = await store.memories.count({ _id: { $in: allRetrieved }, clientId: { $ne: "cli_sarah" } });
  check("S4 Same-firm client isolation", "0 memories from Daniel Okafor in Sarah's runs", `${foreign} foreign`, foreign === 0);
  let crossFirm = "allowed";
  try {
    await authorizeClient(elena, "cli_sarah");
  } catch (e) {
    crossFirm = `denied (${(e as { status: number }).status})`;
  }
  check("S5 Cross-firm isolation", "Harbor Ridge advisor cannot access Sarah Chen; Sara Chen never retrieved", crossFirm, crossFirm.startsWith("denied"));

  // S6 restricted
  const rj = await runAgent(jordan, "cli_sarah", REQ);
  const jt = await topics(rj.run.retrieved.map((r) => r.memoryId));
  check("S6 Restricted memory", "Associate's run excludes the restricted estate memory", `estate retrieved: ${jt.includes("estate_matter")}`, !jt.includes("estate_matter"));

  // S7 expired / forgotten
  const mt = await topics(r2.run.retrieved.map((r) => r.memoryId));
  check("S7 Expired memory", "Outreach pause (expired Jul 1) excluded", `retrieved: ${mt.includes("outreach_pause")}`, !mt.includes("outreach_pause"));
  const again = await ingestNote(maya, sample("sarah_march_again"));
  check(
    "S8 Forgotten memory",
    "Re-ingesting the source does not recreate the forgotten memory",
    `proposals: ${again.proposals.length}; suppressed: ${again.skipped.filter((s) => /forgotten/.test(s.reason)).length}`,
    !again.proposals.some((p) => /brother/i.test(p.statement)),
  );

  // S9 contradictory note
  const rd = await runAgent(maya, "cli_daniel", DEFAULT_REQUEST.cli_daniel);
  const dk = await openKeys("cli_daniel");
  const retire = await store.memories.find({ clientId: "cli_daniel", "structured.topic": "retirement_age", status: "active" });
  check(
    "S9 Contradictory note",
    "Clarification task created; confirmed retirement age (62) unchanged",
    `tasks: ${dk.filter((k) => /retire|clarify/.test(k)).join(", ")}; active: ${retire.map((m) => m.statement).join("; ")}`,
    dk.some((k) => /clarify/.test(k)) && retire.length === 1 && /62/.test(retire[0].statement) && rd.run.status === "completed",
  );

  // S10 injection
  const inj = await ingestNote(jordan, sample("sarah_injection"));
  const estate = (await store.memories.findOne({ "structured.topic": "estate_matter" }))!;
  check(
    "S10 Instructions in sources",
    "Flagged and ignored; access unchanged",
    `ignored: ${inj.ignoredInstructions.length}; estate visibility: ${estate.visibility}`,
    inj.ignoredInstructions.length > 0 && estate.visibility === "restricted",
  );

  // S11 comparison
  const cmp = await compareRuns(maya, "cli_sarah", REQ);
  const sets = cmp.columns.map((c) => c.run.appliedActions.map((a) => a.taskKey).sort());
  check(
    "S11 Comparison view",
    "Three different task sets: generic → condition-gated → deferred discussion prepared",
    cmp.columns.map((c, i) => `${c.label}: ${sets[i].join(", ")}`).join(" || "),
    new Set(sets.map((s) => s.join("|"))).size === 3,
  );

  const passed = checks.filter((c) => c.pass).length;
  const services = serviceLabels(cfg);
  const md = [
    "# Scenario evaluation results",
    "",
    `Generated ${new Date().toISOString()} by \`npm run eval\`.`,
    "",
    `Services: planner/extractor = **${services.planner}**; embeddings = **${services.embeddings}**; storage = isolated in-process store (the eval never writes to Atlas).`,
    "",
    `**${passed}/${checks.length} checks passed.**`,
    "",
    "| Result | Scenario | Expected | Observed |",
    "|---|---|---|---|",
    ...checks.map((c) => `| ${c.pass ? "PASS" : "**FAIL**"} | ${c.scenario} | ${c.expected} | ${c.observed.replace(/\|/g, "\\|")} |`),
    "",
  ].join("\n");
  fs.mkdirSync("docs", { recursive: true });
  fs.writeFileSync("docs/EVAL_RESULTS.md", md);
  for (const c of checks) console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.scenario}\n      ${c.observed}`);
  console.log(`\n${passed}/${checks.length} passed (${services.planner})`);
  process.exit(passed === checks.length ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
