import { createHash, randomUUID } from "node:crypto";

export const newId = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
export const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);
export const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const g = globalThis as unknown as { __continuityNow?: () => Date };
/** Clock is injectable so tests can move time (expiration checks). */
export const clock = {
  now: (): Date => (g.__continuityNow ? g.__continuityNow() : new Date()),
  set(fn: (() => Date) | undefined) {
    g.__continuityNow = fn;
  },
};
export const nowIso = () => clock.now().toISOString();

export function memoryFingerprint(clientId: string, statement: string) {
  return sha(`stmt|${clientId}|${normalize(statement)}`);
}
export function evidenceFingerprint(clientId: string, sourceHash: string, excerpt: string) {
  return sha(`evid|${clientId}|${sourceHash}|${normalize(excerpt)}`);
}

/** Split text into sentences, preserving exact substrings of the original. */
export function sentences(text: string): string[] {
  const out: string[] = [];
  const re = /[^.!?\n]+[.!?]?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const s = m[0].trim();
    if (s.length > 3) out.push(s);
  }
  return out;
}
