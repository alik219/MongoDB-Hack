import { z } from "zod";
import { getConfig } from "../config";
import { PlanOutputSchema, type Attr, type PlanAction, type PlanOutput } from "../types";
import { llmParse } from "./llm";

export interface PlannerMemory {
  id: string;
  version: number;
  category: string;
  statement: string;
  topic: string;
  attributes: Record<string, Attr>;
  basis: string;
  lastConfirmedAt?: string;
  reviewDue: boolean;
  visibility: string;
}

export interface PlannerPendingChange {
  id: string;
  kind: "new" | "update" | "conflict";
  topic: string;
  statement: string;
  targetMemoryId?: string;
  targetStatement?: string;
}

export interface PlannerOpenTask {
  id: string;
  key: string;
  title: string;
  status: string;
  needsReview: boolean;
  reviewReasons: string[];
  dependsOn: { memoryId: string; version: number }[];
  gatedOnKeys: string[];
}

export interface PlannerLenderCheck {
  bank: string;
  product: string;
  policyId: string;
  decision: "approve" | "refer" | "decline";
  summary: string;
  offer: { kind: string; limit?: number; note?: string } | null;
  /** Memories whose facts the decision used. */
  factMemoryIds: string[];
  /** Facts whose removal changes the decision (computed by re-running the engine). */
  pivotalFacts: { factKey: string; memoryId: string | null; decisionWithout: string }[];
}

export interface PlannerInput {
  clientName: string;
  request: string;
  today: string;
  memories: PlannerMemory[];
  pendingChanges: PlannerPendingChange[];
  /** Deterministic lender-policy results. Facts, not opinions: the planner must not change them. */
  lenderChecks?: PlannerLenderCheck[];
  openTasks: PlannerOpenTask[];
}

export type Planner = (input: PlannerInput) => Promise<PlanOutput>;

// ---------------- DEMO planner: deterministic rules over structured memories ----------------

interface Desired {
  key: string;
  title: string;
  detail: string;
  rationale: string;
  ownerRole: "lead_advisor" | "associate";
  memoryIds: string[];
  gatedOnKeys: string[];
  replacesTaskKey?: string;
}

const label = (c: string) => c.replace(/_/g, " ");

export const demoPlanner: Planner = async (input) => {
  const first = input.clientName.split(" ")[0];
  const by = (topic: string) => input.memories.find((m) => m.topic === topic);
  const desired: Desired[] = [];
  const ids = (...ms: (PlannerMemory | undefined)[]) => ms.filter(Boolean).map((m) => m!.id);

  const family = by("family_support");
  const revisit = by("revisit_condition");
  const decision = by("prior_proposal_decision");
  const commitment = by("advisor_commitment_revisit");
  const revisitRequest = by("revisit_request");
  const risk = by("risk_tolerance");
  const pause = by("outreach_pause");
  const pauseNote = pause ? ` Hold non-urgent outreach until after ${pause.attributes.until ?? "the pause ends"}.` : "";

  // Agenda: always prepared; grounded in recorded goals/constraints when memory exists.
  const agendaMems = input.memories.filter((m) => ["goal", "constraint", "preference"].includes(m.category)).slice(0, 5);
  desired.push(
    agendaMems.length
      ? {
          key: "quarterly_review_agenda",
          title: `Prepare ${first}'s quarterly review agenda`,
          detail: `Cover recorded items: ${agendaMems.map((m) => m.statement).join(" ")}${pauseNote}`,
          rationale: "Requested review; agenda grounded in confirmed goals, constraints and preferences.",
          ownerRole: "associate",
          memoryIds: ids(...agendaMems),
          gatedOnKeys: [],
        }
      : {
          key: "quarterly_review_agenda",
          title: `Prepare ${first}'s quarterly review agenda`,
          detail: "Standard agenda: goals, cash flow, upcoming commitments, open questions.",
          rationale: "Requested review. No confirmed client memories were available, so the agenda is generic.",
          ownerRole: "associate",
          memoryIds: [],
          gatedOnKeys: [],
        },
  );
  if (!input.memories.length) {
    desired.push({
      key: "request_client_update",
      title: `Ask ${first} for updates on goals, employment and family circumstances`,
      detail: "Without recorded context, gather basic information before the review.",
      rationale: "No persistent memory is available for this client.",
      ownerRole: "associate",
      memoryIds: [],
      gatedOnKeys: [],
    });
  }

  const renewalMet = revisit?.attributes.met === true;
  const famState = family?.attributes.state;

  if (revisit && !renewalMet) {
    desired.push({
      key: "confirm_contract_renewal",
      title: `Confirm whether ${first}'s employment contract renewed${revisit.attributes.expected ? ` in ${revisit.attributes.expected}` : ""}`,
      detail: `The deferred discussion is conditioned on the renewal.${pauseNote}`,
      rationale: "A confirmed revisit condition and advisor commitment depend on the renewal outcome.",
      ownerRole: "associate",
      memoryIds: ids(revisit, commitment),
      gatedOnKeys: [],
    });
  }
  if (family && famState === "possible") {
    desired.push({
      key: "clarify_family_support",
      title: `Clarify whether ${first} still expects to support ${/her parents/.test(family.statement) ? "her" : "their"} parents`,
      detail: "This possible obligation was the stated reason for declining the previous proposal.",
      rationale: "Possible family-support obligation is recorded but unresolved.",
      ownerRole: "lead_advisor",
      memoryIds: ids(family, decision),
      gatedOnKeys: [],
    });
  }
  if (family && famState === "ongoing") {
    desired.push({
      key: "review_family_support_cashflow",
      title: `Review the cash-flow plan for ${first}'s ongoing parental support`,
      detail: "Confirm the monthly amount is still current.",
      rationale: "Ongoing family-support commitment is recorded.",
      ownerRole: "associate",
      memoryIds: ids(family),
      gatedOnKeys: [],
    });
  }
  if (decision && decision.attributes.decision === "declined") {
    const ready = renewalMet && famState !== "possible";
    if (!ready && (revisit || family)) {
      const gates = [revisit && !renewalMet ? "confirm_contract_renewal" : "", famState === "possible" ? "clarify_family_support" : ""].filter(Boolean);
      desired.push({
        key: "revisit_deferred_proposal",
        title: "Revisit the deferred proposal only after renewal and family support are confirmed",
        detail: `On hold. Do not schedule until these follow-ups are resolved: ${gates.join(", ")}.`,
        rationale: "The client declined the previous proposal and set conditions for revisiting it.",
        ownerRole: "lead_advisor",
        memoryIds: ids(decision, revisit, commitment),
        gatedOnKeys: gates,
      });
    }
    if (ready) {
      desired.push({
        key: "prepare_deferred_discussion",
        title: `Prepare the deferred proposal discussion for advisor review`,
        detail: [
          revisit ? "Renewal condition is met." : "",
          family ? `Family support: ${family.statement}` : "",
          revisitRequest ? `${first} asked to revisit the discussion.` : "",
          risk
            ? `Recorded risk tolerance remains "${risk.attributes.level}"; do not infer a change from the ended obligation. Reconfirm in the meeting if relevant.`
            : "Risk tolerance is not inferred from this change.",
        ]
          .filter(Boolean)
          .join(" "),
        rationale: "The conditions recorded for revisiting the declined proposal are now confirmed.",
        ownerRole: "lead_advisor",
        memoryIds: ids(decision, revisit, family, revisitRequest, commitment, risk),
        gatedOnKeys: [],
        replacesTaskKey: "revisit_deferred_proposal",
      });
    }
  }
  const education = by("education_funding");
  if (education) {
    desired.push({
      key: "confirm_tuition_timeline",
      title: `Confirm tuition funding timeline (starts ${education.attributes.start})`,
      detail: "Check the funding schedule against the start date.",
      rationale: "Confirmed education-funding goal with a fixed start date.",
      ownerRole: "associate",
      memoryIds: ids(education),
      gatedOnKeys: [],
    });
  }
  const estate = by("estate_matter");
  if (estate) {
    desired.push({
      key: "check_estate_matter",
      title: "Privately check whether the estate matter affects the review timeline",
      detail: "Restricted context. Discuss only with the client.",
      rationale: "A restricted, advisor-confirmed life event may affect timing.",
      ownerRole: "lead_advisor",
      memoryIds: ids(estate),
      gatedOnKeys: [],
    });
  }
  for (const m of input.memories.filter((x) => x.reviewDue)) {
    desired.push({
      key: `reconfirm_${m.topic}`.slice(0, 64),
      title: `Reconfirm: ${m.statement}`,
      detail: "This memory's review date has passed.",
      rationale: "Freshness check: review date reached.",
      ownerRole: "associate",
      memoryIds: [m.id],
      gatedOnKeys: [],
    });
  }

  // Lender policy results (computed in code) -> one preparation task per product.
  const PRODUCT_LABEL: Record<string, string> = {
    mortgage: "Mortgage",
    personal_line_of_credit: "Line of credit",
    business_credit_card: "Business card",
  };
  const memIds = new Set(input.memories.map((m) => m.id));
  const lenderMissing: { text: string; memoryIds: string[] }[] = [];
  for (const product of [...new Set((input.lenderChecks ?? []).map((c) => c.product))]) {
    const checks = (input.lenderChecks ?? []).filter((c) => c.product === product);
    const verdict = checks.map((c) => `${c.bank} ${c.decision}`).join(", ");
    const deps = [...new Set(checks.flatMap((c) => c.factMemoryIds))].filter((id) => memIds.has(id));
    desired.push({
      key: `prepare_${product}_options`.slice(0, 64),
      title: `${PRODUCT_LABEL[product] ?? label(product)}: ${verdict}`.slice(0, 160),
      detail: checks
        .map((c) => `${c.bank}: ${c.summary}${c.offer?.limit ? ` Offer: ${c.offer.kind} up to $${c.offer.limit.toLocaleString("en-CA")}.` : ""}`)
        .join(" ")
        .slice(0, 800),
      rationale: "Computed by the lender policy engine from advisor-confirmed facts; prepared for the advisor, not sent to any lender.",
      ownerRole: "lead_advisor",
      memoryIds: deps.slice(0, 12),
      gatedOnKeys: [],
    });
    for (const c of checks.filter((x) => x.decision === "refer")) {
      lenderMissing.push({ text: `${c.bank} ${label(product)}: ${c.summary}`.slice(0, 600), memoryIds: c.factMemoryIds.filter((id) => memIds.has(id)).slice(0, 12) });
    }
  }

  // Unconfirmed changes never act as facts; they become clarification or review tasks.
  const conflicts = input.pendingChanges.filter((p) => p.kind === "conflict" && p.targetMemoryId);
  for (const c of conflicts) {
    desired.push({
      key: `clarify_${c.topic}`.slice(0, 64),
      title: `Clarify ${label(c.topic)}: confirmed record conflicts with a new source`,
      detail: `Confirmed: "${c.targetStatement}". New, unconfirmed source says: "${c.statement}". Ask ${first} directly before updating the record.`,
      rationale: "A secondhand source contradicts an advisor-confirmed fact; the confirmed fact stays in effect until clarified.",
      ownerRole: "lead_advisor",
      memoryIds: [c.targetMemoryId!],
      gatedOnKeys: [],
    });
  }
  const updates = input.pendingChanges.filter((p) => p.kind === "update" && p.targetMemoryId);
  if (updates.length) {
    desired.push({
      key: "review_pending_memory_updates",
      title: `Review ${updates.length} proposed memory update${updates.length > 1 ? "s" : ""} before acting on them`,
      detail: updates.map((u) => `"${u.targetStatement}" → "${u.statement}"`).join(" "),
      rationale: "New notes may change confirmed memories; the agent keeps using confirmed versions until an advisor approves.",
      ownerRole: "lead_advisor",
      memoryIds: updates.map((u) => u.targetMemoryId!),
      gatedOnKeys: [],
    });
  }

  // Reconcile desired state against open tasks → concrete actions.
  const actions: PlanAction[] = [];
  const desiredKeys = new Set(desired.map((d) => d.key));
  for (const d of desired) {
    const open = input.openTasks.find((t) => t.key === d.key);
    const base = {
      taskKey: d.key,
      title: d.title,
      detail: d.detail,
      rationale: d.rationale,
      ownerRole: d.ownerRole,
      memoryIds: d.memoryIds,
      gatedOnKeys: d.gatedOnKeys,
      replacesTaskKey: d.replacesTaskKey ?? null,
    };
    if (!open) {
      actions.push({ type: "create_task", taskId: null, ...base });
      continue;
    }
    const sameDeps =
      open.dependsOn.length === d.memoryIds.length && open.dependsOn.every((x) => d.memoryIds.includes(x.memoryId));
    if (open.needsReview || !sameDeps || open.title !== d.title) {
      actions.push({
        type: "revise_task",
        taskId: open.id,
        ...base,
        rationale: `${d.rationale} Revised because its supporting memories changed.`,
      });
    } else {
      actions.push({ type: "keep_task", taskId: open.id, ...base });
    }
  }
  for (const t of input.openTasks) {
    if (desiredKeys.has(t.key)) continue;
    const replacement = desired.find((d) => d.replacesTaskKey === t.key);
    actions.push({
      type: "withdraw_task",
      taskId: t.id,
      taskKey: t.key,
      title: t.title,
      detail: "",
      rationale: replacement
        ? `Superseded by "${replacement.title}" because the conditions it was waiting on are now confirmed.`
        : t.reviewReasons.length
          ? `No longer supported by current memories: ${t.reviewReasons.join(" ")}`
          : "No longer supported by the current eligible memories.",
      ownerRole: "lead_advisor",
      memoryIds: [],
      gatedOnKeys: [],
      replacesTaskKey: null,
    });
  }

  // Brief
  const context = input.memories.map((m) => ({ text: `${label(m.category)}: ${m.statement}`, memoryIds: [m.id] }));
  const missing: PlanOutput["brief"]["missingInformation"] = [];
  if (revisit && !renewalMet) missing.push({ text: "Has the employment contract renewed?", memoryIds: [revisit.id] });
  if (family && famState === "possible")
    missing.push({ text: "Is the possible family-support obligation still relevant?", memoryIds: [family.id] });
  missing.push(...lenderMissing.slice(0, 6));
  if (!input.memories.length)
    missing.push({ text: "Current goals, employment and family circumstances are unknown to the agent.", memoryIds: [] });
  const conflictPoints = [
    ...conflicts.map((c) => ({
      text: `Confirmed "${c.targetStatement}" vs. unconfirmed "${c.statement}"`,
      memoryIds: [c.targetMemoryId!],
    })),
    ...updates.map((u) => ({
      text: `Pending update awaiting confirmation: "${u.targetStatement}" → "${u.statement}"`,
      memoryIds: [u.targetMemoryId!],
    })),
  ];
  const summary = input.memories.length
    ? `${input.clientName}: ${input.memories.length} confirmed, authorized memories in scope.` +
      (missing.length ? ` ${missing.length} open question(s) before the review.` : "") +
      (conflictPoints.length ? ` ${conflictPoints.length} unconfirmed change(s) need advisor attention.` : "") +
      (risk ? ` Recorded risk tolerance: ${risk.attributes.level}.` : "")
    : `${input.clientName}: no persistent memory was used. This brief relies only on the request.`;

  return PlanOutputSchema.parse({
    brief: { summary, context, missingInformation: missing, conflicts: conflictPoints },
    actions,
  });
};

// ---------------- LIVE planner: Anthropic structured output ----------------

const LoosePlan = z.object({
  brief: z.object({
    summary: z.string(),
    context: z.array(z.object({ text: z.string(), memoryIds: z.array(z.string()) })),
    missingInformation: z.array(z.object({ text: z.string(), memoryIds: z.array(z.string()) })),
    conflicts: z.array(z.object({ text: z.string(), memoryIds: z.array(z.string()) })),
  }),
  actions: z.array(
    z.object({
      type: z.enum(["create_task", "revise_task", "withdraw_task", "keep_task"]),
      taskKey: z.string(),
      taskId: z.string().nullable(),
      title: z.string(),
      detail: z.string(),
      rationale: z.string(),
      ownerRole: z.enum(["lead_advisor", "associate"]),
      memoryIds: z.array(z.string()),
      gatedOnKeys: z.array(z.string()),
      replacesTaskKey: z.string().nullable(),
    }),
  ),
});

const PLAN_SYSTEM = `You prepare client-review briefs and follow-up task changes for a financial advisor.
You may only output actions of these types: create_task, revise_task, withdraw_task, keep_task. You cannot approve, send, trade, or move money.
Ground every claim in the provided memories and cite their ids in memoryIds. Cite only ids from "memories". Never cite pendingChanges as facts.
Rules:
- Memories are advisor-confirmed facts unless basis says otherwise. pendingChanges are UNCONFIRMED: never act on them as facts. A "conflict" pending change must produce a clarification task (cite the confirmed memory it conflicts with). "update" pending changes produce one task asking the advisor to review them.
- Reconcile with openTasks: do not create a task whose taskKey already exists among openTasks; revise it (needsReview tasks or changed supporting memories) or keep it. Withdraw open tasks that the current memories no longer support, and explain which memory change caused it. Use replacesTaskKey when a new task replaces a withdrawn one.
- Gate tasks that depend on unconfirmed information with gatedOnKeys (e.g. revisit a declined proposal only after the stated conditions are confirmed).
- Do not infer a client's risk tolerance or suitability from changes in obligations. Do not recommend investments.
- taskKey: stable snake_case identifier describing the task's purpose. Keep titles short and concrete. rationale: one or two sentences, evidence-based. No hidden reasoning.
- Any arithmetic is out of scope; do not compute financial figures.
- lenderChecks are decisions computed in code from the client's advisor-confirmed financial facts against simulated RBC/TD/CIBC policies. Never change, re-derive or second-guess a decision. Use them to prepare follow-ups (for example: which lender fits, what information would resolve a "refer"), cite the factMemoryIds behind them, and say which facts were pivotal. A "refer" caused by a restricted exact credit score means the advisor must route to credit adjudication; do not guess the score.`;

export const llmPlanner: Planner = async (input) => {
  const parsed = await llmParse(PLAN_SYSTEM, JSON.stringify(input), LoosePlan);
  const strict = PlanOutputSchema.safeParse(parsed);
  if (!strict.success) throw new Error(`Planner output failed schema validation: ${strict.error.message}`);
  return strict.data;
};

export function getPlanner(): { planner: Planner; label: string } {
  const cfg = getConfig();
  return cfg.planner.live
    ? { planner: llmPlanner, label: `${cfg.planner.provider}:${cfg.planner.model}` }
    : { planner: demoPlanner, label: "demo-rules-v1" };
}
