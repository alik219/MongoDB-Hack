import { createHash } from "node:crypto";
import type { Store } from "./store/types";
import type { AuditEvent } from "./types";

/**
 * Tamper-evident audit log. Every event carries the hash of the event before it:
 *   hash = sha256(prevHash + canonical JSON of the event without `hash`)
 * so editing, deleting or reordering any past event breaks verification from that point on.
 * There is one chain per firm, so one firm's log can be verified without reading another's.
 */
export const GENESIS_HASH = "0".repeat(64);

/** JSON with object keys sorted at every level, so the same event always hashes the same. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function chainHash(prevHash: string, event: Record<string, unknown>): string {
  const { hash: _ignored, ...body } = event;
  return createHash("sha256").update(prevHash + canonical(body)).digest("hex");
}

/** Appends are serialized per firm in this process; the unique (firmId, seq) index covers other processes. */
const tails = new Map<string, Promise<unknown>>();

const isDuplicateKey = (e: unknown) => (e as { code?: number } | null)?.code === 11000;

export async function appendAudit(store: Store, event: Omit<AuditEvent, "seq" | "prevHash" | "hash">): Promise<AuditEvent> {
  const append = async (): Promise<AuditEvent> => {
    for (let attempt = 0; ; attempt++) {
      const [last] = await store.audit.find({ firmId: event.firmId, seq: { $exists: true } }, { sort: { seq: -1 }, limit: 1 });
      // The JSON round trip drops undefined fields, so what is hashed is exactly what gets stored.
      const entry = JSON.parse(
        JSON.stringify({ ...event, seq: (last?.seq ?? 0) + 1, prevHash: last?.hash ?? GENESIS_HASH }),
      ) as AuditEvent;
      entry.hash = chainHash(entry.prevHash!, entry as unknown as Record<string, unknown>);
      try {
        await store.audit.insertOne(entry);
        return entry;
      } catch (e) {
        // Another process took this sequence number: read the new tail and try again.
        if (!isDuplicateKey(e) || attempt >= 5) throw e;
      }
    }
  };
  const previous = tails.get(event.firmId) ?? Promise.resolve();
  const next = previous.then(append, append);
  tails.set(
    event.firmId,
    next.catch(() => undefined),
  );
  return next;
}

export interface AuditVerification {
  ok: boolean;
  /** Chained events checked, in order. */
  checked: number;
  /** Events written before chaining was added; they carry no hash and are not covered. */
  unchained: number;
  /** Sequence number of the first event that fails, when ok is false. */
  firstBadSeq: number | null;
  problem: string | null;
  /** Hash of the newest event. Publishing it elsewhere lets a reviewer detect a wholesale rewrite. */
  headHash: string | null;
}

export async function verifyAuditChain(store: Store, firmId: string): Promise<AuditVerification> {
  const events = await store.audit.find({ firmId, seq: { $exists: true } }, { sort: { seq: 1 } });
  const unchained = await store.audit.count({ firmId, seq: { $exists: false } });
  let prevHash = GENESIS_HASH;
  let expectedSeq = 1;
  for (const e of events) {
    const fail = (problem: string): AuditVerification => ({
      ok: false,
      checked: expectedSeq - 1,
      unchained,
      firstBadSeq: e.seq ?? expectedSeq,
      problem,
      headHash: null,
    });
    if (e.seq !== expectedSeq) return fail(`Expected event ${expectedSeq} but found ${e.seq}: an event is missing or duplicated.`);
    if (e.prevHash !== prevHash) return fail("The link to the previous event does not match: an earlier event was removed or replaced.");
    if (e.hash !== chainHash(prevHash, e as unknown as Record<string, unknown>)) {
      return fail("The event's contents do not match its hash: it was edited after it was written.");
    }
    prevHash = e.hash!;
    expectedSeq++;
  }
  return { ok: true, checked: events.length, unchained, firstBadSeq: null, problem: null, headHash: events.length ? prevHash : null };
}
