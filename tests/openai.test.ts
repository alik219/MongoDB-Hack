import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { llmExtract } from "@/lib/ai/extract";
import { getConfig } from "@/lib/config";

const saved = { planner: process.env.PLANNER_PROVIDER, embedding: process.env.EMBEDDING_PROVIDER };
beforeEach(() => {
  delete process.env.PLANNER_PROVIDER;
  delete process.env.EMBEDDING_PROVIDER;
});
afterEach(() => {
  process.env.PLANNER_PROVIDER = saved.planner;
  process.env.EMBEDDING_PROVIDER = saved.embedding;
  vi.unstubAllGlobals();
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_MODEL;
});

describe("OpenAI provider", () => {
  it("OPENAI_API_KEY selects OpenAI for planning but not for embeddings", () => {
    process.env.OPENAI_API_KEY = "test";
    const cfg = getConfig();
    expect(cfg.planner.provider).toBe("openai");
    expect(cfg.embedding.provider).not.toBe("openai");
  });

  it("sends a strict JSON schema and validates the reply before anything is used", async () => {
    process.env.OPENAI_API_KEY = "test";
    process.env.OPENAI_MODEL = "gpt-test";
    const calls: { body: Record<string, unknown> }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: string }) => {
        calls.push({ body: JSON.parse(init.body) });
        const content = JSON.stringify({
          memories: [
            {
              category: "financial_fact",
              statement: "Priya's household income used by lenders is $315,000 a year.",
              topic: "documented_income",
              attributes: [{ key: "annual_income", value: "315000" }],
              excerpt: "Household income $315,000",
              relation: "new",
              targetMemoryId: null,
              changeSummary: null,
            },
          ],
          ignoredInstructions: [],
        });
        return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }] }), { status: 200 });
      }),
    );
    const out = await llmExtract({ clientName: "Priya Raman", sourceKind: "meeting_note", existing: [], text: "Household income $315,000" });
    expect(out.memories[0].category).toBe("financial_fact");
    const rf = calls[0].body.response_format as { json_schema: { strict: boolean; schema: Record<string, unknown> } };
    expect(calls[0].body.model).toBe("gpt-test");
    expect(rf.json_schema.strict).toBe(true);
    const schema = rf.json_schema.schema as { additionalProperties: boolean; required: string[] };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(["memories", "ignoredInstructions"]);
  });

  it("rejects output that does not match the schema", async () => {
    process.env.OPENAI_API_KEY = "test";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"memories":"nope"}' }, finish_reason: "stop" }] }))),
    );
    await expect(llmExtract({ clientName: "X", sourceKind: "meeting_note", existing: [], text: "hello world" })).rejects.toThrow(/schema/);
  });
});
