import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { getConfig } from "../config";

/** Server-only. The API key never leaves the server. */
let client: Anthropic | null = null;
function getClient() {
  if (!client) client = new Anthropic(); // reads ANTHROPIC_API_KEY
  return client;
}

/**
 * One structured-output call. The model gets no tools and no database access:
 * it only returns JSON that the server validates and then decides whether to apply.
 */
export async function anthropicParse<T extends z.ZodType>(system: string, user: string, schema: T): Promise<z.infer<T>> {
  const cfg = getConfig();
  const response = await getClient().messages.parse({
    model: cfg.planner.model,
    max_tokens: 16000,
    system,
    messages: [{ role: "user", content: user }],
    output_config: {
      format: zodOutputFormat(schema),
      effort: cfg.planner.effort,
    },
  });
  if (response.stop_reason === "refusal") {
    throw new Error("The model declined this request (refusal). No changes were made.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error("The model response was truncated (max_tokens). No changes were made.");
  }
  if (response.parsed_output == null) throw new Error("The model returned output that did not match the schema.");
  return response.parsed_output as z.infer<T>;
}
