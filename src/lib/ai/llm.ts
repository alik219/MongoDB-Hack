import { z } from "zod";
import { getConfig } from "../config";
import { anthropicParse } from "./anthropic";

/**
 * One structured-output model call, provider-agnostic. The model gets no tools and no database
 * access: it only returns JSON that the server validates and then decides whether to apply.
 */
export async function llmParse<T extends z.ZodType>(system: string, user: string, schema: T): Promise<z.infer<T>> {
  const cfg = getConfig();
  if (cfg.planner.provider === "openai") return openaiParse(system, user, schema);
  return anthropicParse(system, user, schema);
}

/** OpenAI structured outputs need every property required and no extra properties. */
function strictify(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strictify);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (k === "$schema") continue;
    out[k] = strictify(v);
  }
  if (out.type === "object" && out.properties && typeof out.properties === "object") {
    out.additionalProperties = false;
    out.required = Object.keys(out.properties as object);
  }
  return out;
}

export async function openaiParse<T extends z.ZodType>(system: string, user: string, schema: T): Promise<z.infer<T>> {
  const cfg = getConfig();
  const base = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: cfg.planner.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "output", strict: true, schema: strictify(z.toJSONSchema(schema)) },
      },
    }),
  });
  if (!res.ok) throw new Error(`OpenAI request failed: ${res.status} ${(await res.text()).slice(0, 400)}`);
  const json = (await res.json()) as {
    choices: { message: { content: string | null; refusal?: string | null }; finish_reason: string }[];
  };
  const choice = json.choices?.[0];
  if (!choice) throw new Error("OpenAI returned no choices. No changes were made.");
  if (choice.message.refusal) throw new Error("The model declined this request (refusal). No changes were made.");
  if (choice.finish_reason === "length") throw new Error("The model response was truncated. No changes were made.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(choice.message.content ?? "");
  } catch {
    throw new Error("The model returned output that was not valid JSON. No changes were made.");
  }
  const checked = schema.safeParse(parsed);
  if (!checked.success) throw new Error("The model returned output that did not match the schema.");
  return checked.data;
}
