import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { detectInstructionLikeText } from "./ai/extract";
import type { LenderPolicy, LenderProduct } from "./lender/engine";
import { FACT_KEYS } from "./lender/engine";
import { buildMemory, embeddingFields } from "./memory-doc";
import type { Store } from "./store/types";
import type { Attr, Client, Firm, Memory, Source, User } from "./types";
import { sha } from "./util";

/**
 * The MongoDB Agents-in-Context hackathon dataset (data/hackathon): 4 synthetic clients,
 * ~80 dated meeting notes, profiles, goal files, and 9 simulated RBC / TD / CIBC lender policies.
 *
 * Loaded as a separate firm so it is isolated from the original demo firms by the same
 * firm/client pre-filter as everything else.
 */

export const HACKATHON_FIRM_ID = "frm_lakeshore";

export function dataDir() {
  return process.env.HACKATHON_DATA_DIR ?? path.join(process.cwd(), "data", "hackathon");
}

/** Field-sensitivity policy (profile section 8): identifiers are never stored. */
export function sanitize(text: string) {
  return text
    .replace(/(\|\s*SIN\s*\|)\s*[^|\n]*\|/g, "$1 Hidden (on file: yes) |")
    .replace(/(\|\s*Business number\s*\|)\s*[^|\n]*\|/g, "$1 Hidden (on file: yes) |");
}

interface ClientDef {
  key: "C1" | "C2" | "C3" | "C4";
  externalId: string;
  id: string;
  name: string;
  segment: Client["segment"];
  profileFile: string;
  notesDir: string;
  advisor: User;
  profile: Client["profile"];
}

const ADJUDICATOR: User = {
  _id: "usr_riya",
  firmId: HACKATHON_FIRM_ID,
  name: "Riya Kapoor",
  title: "Credit Adjudicator",
  role: "associate",
  clientIds: ["cli_c1_maya", "cli_c2_jonathan", "cli_c3_priya"],
};

const CLIENT_DEFS: ClientDef[] = [
  {
    key: "C1",
    externalId: "C1-STU-001",
    id: "cli_c1_maya",
    name: "Maya Chen",
    segment: "retail",
    profileFile: "profiles/C1_retail_student.md",
    notesDir: "meeting-notes/C1_Maya_Chen",
    advisor: { _id: "usr_daniel", firmId: HACKATHON_FIRM_ID, name: "Daniel Osei", title: "Retail Advisor", role: "lead_advisor", clientIds: ["cli_c1_maya"] },
    profile: { age: 21, occupation: "Computer Science student, part-time barista", household: "Single · no dependants", relationshipSince: "2021", nextReview: "2027-02-01", serviceTier: "Retail: Student" },
  },
  {
    key: "C2",
    externalId: "C2-HNW-001",
    id: "cli_c2_jonathan",
    name: "Jonathan Whitfield",
    segment: "retail",
    profileFile: "profiles/C2_retail_high_net_worth_lawyer.md",
    notesDir: "meeting-notes/C2_Jonathan_Whitfield",
    advisor: { _id: "usr_margaret", firmId: HACKATHON_FIRM_ID, name: "Margaret Liu", title: "Private Wealth Advisor", role: "lead_advisor", clientIds: ["cli_c2_jonathan"] },
    profile: { age: 45, occupation: "Equity partner, law firm", household: "Married · two children (12, 9)", relationshipSince: "2022", nextReview: "2027-01-15", serviceTier: "Retail: High net worth" },
  },
  {
    key: "C3",
    externalId: "C3-BIZ-001",
    id: "cli_c3_priya",
    name: "Priya Raman",
    segment: "business",
    profileFile: "profiles/C3_business_tech_owner.md",
    notesDir: "meeting-notes/C3_Priya_Raman_Lumenwave",
    advisor: { _id: "usr_tomas", firmId: HACKATHON_FIRM_ID, name: "Tomás Reyes", title: "Business & Personal Advisor", role: "lead_advisor", clientIds: ["cli_c3_priya"] },
    profile: { age: 38, occupation: "Founder & CEO, Lumenwave Software", household: "Married · one child (5)", relationshipSince: "2021", nextReview: "2027-01-15", serviceTier: "Business owner" },
  },
  {
    key: "C4",
    externalId: "C4-CORP-001",
    id: "cli_c4_retail_treasury",
    name: "Walmart Finance Dept (synthetic)",
    segment: "corporate",
    profileFile: "profiles/C4_business_walmart_finance_dept.md",
    notesDir: "meeting-notes/C4_Walmart_Finance_Dept",
    advisor: { _id: "usr_hannah", firmId: HACKATHON_FIRM_ID, name: "Hannah Brooks", title: "Commercial Relationship Manager", role: "lead_advisor", clientIds: ["cli_c4_retail_treasury"] },
    profile: { age: 0, occupation: "Large-retailer treasury (synthetic label)", household: "240-person finance department", relationshipSince: "2012", nextReview: "2027-01-15", serviceTier: "Commercial" },
  },
];

const read = (rel: string) => fs.readFileSync(path.join(dataDir(), rel), "utf8");

export function loadLenderPolicies(): LenderPolicy[] {
  const dir = path.join(dataDir(), "policies");
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => {
      const text = fs.readFileSync(path.join(dir, f), "utf8");
      const fm = YAML.parse(text.split("---")[1]) as Record<string, unknown>;
      const block = /```yaml\n([\s\S]*?)```/.exec(text);
      if (!block) throw new Error(`No decision_rules block in ${f}`);
      const rules = (YAML.parse(block[1]) as { decision_rules: Record<string, unknown> }).decision_rules;
      return {
        _id: String(fm.policy_id),
        bank: String(fm.bank),
        product: fm.product as LenderProduct,
        version: String(fm.version),
        effectiveDate: String(fm.effective_date),
        status: String(fm.status),
        simulated: fm.simulated === true,
        decisionRules: rules,
        sourceFile: `policies/${f}`,
        contentHash: sha(text),
      };
    });
}

export interface RawDataset {
  profiles: { _id: string; clientId: string; sourceFile: string; contentHash: string; markdown: string }[];
  goals: { _id: string; clientId: string; sourceFile: string; contentHash: string; markdown: string }[];
  notes: { _id: string; clientId: string; meetingDate: string; advisor: string | null; sourceFile: string; contentHash: string; markdown: string }[];
}

/** The raw (sanitized) dataset documents, as stored in Atlas `dataset_*` collections. */
export function loadRawDataset(): RawDataset {
  const out: RawDataset = { profiles: [], goals: [], notes: [] };
  for (const c of CLIENT_DEFS) {
    const profile = sanitize(read(c.profileFile));
    out.profiles.push({ _id: c.externalId, clientId: c.externalId, sourceFile: c.profileFile, contentHash: sha(profile), markdown: profile });
    const goalsFile = `goals/${c.key}_Goal_Preference.md`;
    const goals = sanitize(read(goalsFile));
    out.goals.push({ _id: `${c.externalId}-goals`, clientId: c.externalId, sourceFile: goalsFile, contentHash: sha(goals), markdown: goals });
    for (const f of fs.readdirSync(path.join(dataDir(), c.notesDir)).filter((n) => n.endsWith(".md")).sort()) {
      const rel = `${c.notesDir}/${f}`;
      const text = sanitize(read(rel));
      const date = /Meeting date \|\s*(\d{4}-\d{2}-\d{2})/.exec(text)?.[1] ?? `${f.slice(0, 4)}-${f.slice(4, 6)}-01`;
      const advisor = /\| Advisor \|\s*([^|]+)\|/.exec(text)?.[1].trim() ?? null;
      out.notes.push({ _id: `${c.externalId}-${date}`, clientId: c.externalId, meetingDate: date, advisor, sourceFile: rel, contentHash: sha(text), markdown: text });
    }
  }
  return out;
}

interface FactDef {
  topic: string;
  attributes: Record<string, number>;
  statement: string;
  source: string;
  excerpt: string;
  restricted?: boolean;
  expiresAt?: string;
  reviewAt?: string;
}

function makeSource(client: Client, kind: Source["kind"], title: string, sourceDate: string, text: string, createdBy: string, id: string): Source {
  return {
    _id: id,
    firmId: client.firmId,
    clientId: client._id,
    kind,
    title,
    text,
    sourceDate,
    createdBy,
    createdAt: `${sourceDate}T17:00:00.000Z`,
    contentHash: sha(text),
    safetyFlags: detectInstructionLikeText(text),
  };
}

/**
 * Seeds the hackathon firm: advisors (one per client, so each client is its own team),
 * a credit adjudicator who alone can read exact credit scores, clients, every note/profile/goal
 * file as an evidence source, advisor-confirmed financial facts, and the lender policies.
 * Notes are NOT pre-extracted into memories: the extractor (LLM when configured) does that live.
 */
export async function seedHackathon(store: Store) {
  const firm: Firm = { _id: HACKATHON_FIRM_ID, name: "Lakeshore Financial (fictional)" };
  await store.firms.insertMany([firm]);
  await store.users.insertMany([...CLIENT_DEFS.map((c) => c.advisor), ADJUDICATOR]);
  const clients: Client[] = CLIENT_DEFS.map((c) => ({
    _id: c.id,
    firmId: HACKATHON_FIRM_ID,
    name: c.name,
    externalId: c.externalId,
    segment: c.segment,
    leadAdvisorId: c.advisor._id,
    teamUserIds: [c.advisor._id, ...(ADJUDICATOR.clientIds.includes(c.id) ? [ADJUDICATOR._id] : [])],
    profile: c.profile,
  }));
  await store.clients.insertMany(clients);

  const raw = loadRawDataset();
  const facts = JSON.parse(read("facts.json")) as { clients: Record<string, FactDef[]> };
  const sources: Source[] = [];
  const memories: Memory[] = [];

  for (const def of CLIENT_DEFS) {
    const client = clients.find((c) => c._id === def.id)!;
    const notes = raw.notes.filter((n) => n.clientId === def.externalId);
    const latest = notes.at(-1)?.meetingDate ?? "2026-11-01";
    const bySourceFile = new Map<string, Source>();
    const profile = raw.profiles.find((p) => p.clientId === def.externalId)!;
    const p = makeSource(client, "client_profile", `Client profile (${def.externalId})`, latest, profile.markdown, def.advisor._id, `src_${def.key.toLowerCase()}_profile`);
    bySourceFile.set(profile.sourceFile, p);
    const goals = raw.goals.find((g) => g.clientId === def.externalId)!;
    const goalsDate = /Effective date \|\s*(\d{4}-\d{2}-\d{2})/.exec(goals.markdown)?.[1] ?? latest;
    const g = makeSource(client, "client_goals", "Goals & preferences", goalsDate, goals.markdown, def.advisor._id, `src_${def.key.toLowerCase()}_goals`);
    bySourceFile.set(goals.sourceFile, g);
    sources.push(p, g);
    for (const n of notes) {
      const s = makeSource(client, "meeting_note", `Meeting note · ${n.meetingDate}`, n.meetingDate, n.markdown, def.advisor._id, `src_${def.key.toLowerCase()}_${n.meetingDate.replace(/-/g, "")}`);
      bySourceFile.set(n.sourceFile, s);
      sources.push(s);
    }

    for (const f of facts.clients[def.key] ?? []) {
      const src = bySourceFile.get(f.source);
      if (!src) throw new Error(`facts.json: unknown source ${f.source}`);
      if (!src.text.includes(f.excerpt)) throw new Error(`facts.json: excerpt not found verbatim in ${f.source}: ${f.excerpt}`);
      for (const k of Object.keys(f.attributes)) if (!(k in FACT_KEYS)) throw new Error(`facts.json: unknown fact key ${k}`);
      const confirmedAt = `${latest}T18:00:00.000Z`;
      const m = buildMemory({
        firmId: HACKATHON_FIRM_ID,
        clientId: client._id,
        category: "financial_fact",
        statement: f.statement,
        topic: f.topic,
        attributes: f.attributes as Record<string, Attr>,
        evidence: [{ sourceId: src._id, excerpt: f.excerpt, sourceDate: src.sourceDate, sourceKind: src.kind }],
        status: "active",
        basis: "advisor_confirmed",
        createdBy: def.advisor._id,
        createdAt: confirmedAt,
        confirmedBy: def.advisor._id,
        confirmedAt,
        visibility: f.restricted ? "restricted" : "team",
        allowedUserIds: f.restricted ? [ADJUDICATOR._id] : [],
        expiresAt: f.expiresAt ? `${f.expiresAt}T00:00:00.000Z` : null,
        reviewAt: f.reviewAt ? `${f.reviewAt}T00:00:00.000Z` : null,
        proposal: { kind: "new", extractor: "hackathon-dataset", proposedBy: def.advisor._id, proposedAt: confirmedAt },
      });
      Object.assign(m, await embeddingFields(m, confirmedAt));
      memories.push(m);
    }
  }
  await store.sources.insertMany(sources);
  await store.memories.insertMany(memories);
  await store.lenderPolicies.insertMany(loadLenderPolicies());
  return { clients: clients.length, sources: sources.length, facts: memories.length };
}
