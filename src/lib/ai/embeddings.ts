import { createHash } from "node:crypto";
import { getConfig } from "../config";

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

// ---------- DEMO embeddings: deterministic feature hashing, NOT a semantic model ----------

const STOP = new Set(
  "a an the and or of to in on for with her his she he we us our is are was were be been it its this that as at by from after before may would like".split(" "),
);
const SYNONYMS: Record<string, string> = {
  parent: "family",
  parents: "family",
  mother: "family",
  father: "family",
  fund: "support",
  funds: "support",
  funding: "support",
  expenses: "support",
  contract: "employment",
  job: "employment",
  renewal: "renew",
  renews: "renew",
  renewed: "renew",
  revisit: "review",
  quarterly: "review",
  proposal: "plan",
  discussion: "plan",
  followup: "task",
  "follow-ups": "task",
  retire: "retirement",
};

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !STOP.has(t))
    .map((t) => SYNONYMS[t] ?? t.replace(/(ing|ed|s)$/, ""));
}

export function demoEmbed(text: string, dims: number): number[] {
  const v = new Array<number>(dims).fill(0);
  for (const t of tokens(text)) {
    const h = createHash("sha256").update(t).digest();
    const idx = h.readUInt32BE(0) % dims;
    v[idx] += h[4] & 1 ? 1 : -1;
  }
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / n);
}

// ---------- LIVE providers (documented REST APIs) ----------

async function voyageEmbed(texts: string[], inputType: "document" | "query", model: string, dims: number) {
  const base = process.env.VOYAGE_BASE_URL ?? "https://api.voyageai.com/v1";
  const res = await fetch(`${base}/embeddings`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
    },
    body: JSON.stringify({ input: texts, model, input_type: inputType, output_dimension: dims }),
  });
  if (!res.ok) throw new Error(`Voyage embeddings failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { data: { embedding: number[]; index: number }[] };
  return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

async function openaiEmbed(texts: string[], model: string, dims: number) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ input: texts, model, dimensions: dims }),
  });
  if (!res.ok) throw new Error(`OpenAI embeddings failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { data: { embedding: number[]; index: number }[] };
  return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

export async function embed(texts: string[], inputType: "document" | "query"): Promise<number[][]> {
  const { embedding } = getConfig();
  let out: number[][];
  if (embedding.provider === "voyage") out = await voyageEmbed(texts, inputType, embedding.model, embedding.dims);
  else if (embedding.provider === "openai") out = await openaiEmbed(texts, embedding.model, embedding.dims);
  else out = texts.map((t) => demoEmbed(t, embedding.dims));
  for (const v of out) {
    if (v.length !== embedding.dims) {
      throw new Error(
        `Embedding dimension mismatch: got ${v.length}, index expects ${embedding.dims}. Refusing to store or query.`,
      );
    }
  }
  return out;
}

export function memoryEmbeddingText(m: { category: string; statement: string }) {
  return `${m.category.replace(/_/g, " ")}: ${m.statement}`;
}
