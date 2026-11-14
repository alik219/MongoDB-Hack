import type { Visibility } from "./types";

/**
 * Content gate for governed memory: what may be stored at all, checked before a memory is written.
 * The model and the advisor can both propose text; neither can get these past the gate.
 */
export type GateResult = { ok: true } | { ok: false; rule: string; reason: string };

/** Nine digits in SIN / account-number grouping (123 456 789, 123-456-789, 123456789). */
const IDENTIFIER = /(?<![\d$.,])\b\d{3}[- ]?\d{3}[- ]?\d{3}\b(?![\d.,]*\d)/;
/** A secret given with its value ("PIN is 4821", "password: hunter2"). */
const CREDENTIAL = /\b(password|passcode|passphrase|pin|cvv|cvc|security code)\b\s*(?:is|was|:|=)\s*\S+/i;
/** "score" followed closely by a three-digit number in the credit-score range. */
const SCORE = /\b(?:credit\s*)?score\b[^\d]{0,24}\b([3-8]\d{2})\b/gi;
/** The number is one end of a band ("700 to 799", "700–799") or a threshold ("at least 720"). */
const RANGE_AFTER = /^\s*(?:to|and|through|–|—|-)\s*\d{3}\b/i;
const THRESHOLD_BEFORE = /(?:≥|>=|<=|≤|>|<|at least|at most|minimum|min\.?|maximum|above|over|below|under|floor|needs?|requires?)\s*(?:of\s*)?$/i;

function exactCreditScore(text: string): boolean {
  for (const m of text.matchAll(SCORE)) {
    const numberStart = m.index! + m[0].length - m[1].length;
    const before = text.slice(0, numberStart);
    const after = text.slice(numberStart + m[1].length);
    if (RANGE_AFTER.test(after) || THRESHOLD_BEFORE.test(before)) continue;
    return true;
  }
  return false;
}

export function checkMemoryContent(text: string, opts: { visibility?: Visibility } = {}): GateResult {
  const content = (text ?? "").replace(/\s+/g, " ").trim();
  if (IDENTIFIER.test(content)) {
    return { ok: false, rule: "identifier", reason: "Looks like a SIN or account number. Identifiers are never stored in memory." };
  }
  if (CREDENTIAL.test(content)) {
    return { ok: false, rule: "credential", reason: "Contains a password, PIN or security code. Credentials are never stored in memory." };
  }
  if (opts.visibility !== "restricted" && exactCreditScore(content)) {
    return {
      ok: false,
      rule: "exact_credit_score",
      reason: "Contains an exact credit score. Store the band (for example 700 to 799), or keep the exact score in a restricted memory.",
    };
  }
  return { ok: true };
}
