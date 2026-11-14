import { authorizeClient, type AuthContext } from "../auth";
import { getStore } from "../store";
import type { ChatReply, ChatTurn } from "./chat";
import { audit } from "./common";

/**
 * Bridge to the Python LangGraph advisor agent (MongoDB-Hack-agent: Atlas Vector Search over the
 * hackathon dataset, deterministic eligibility, governed long-term memory).
 * Enabled when ADVISOR_AGENT_URL is set; otherwise the built-in chat engine answers.
 * The app still authenticates the user and authorizes the client before anything is sent.
 */
export function advisorAgentEnabled(): boolean {
  return Boolean(process.env.ADVISOR_AGENT_URL);
}

/** App client ids look like "cli_c1_maya"; the agent's dataset uses "C1". */
export function toAgentClientId(clientId: string): string | null {
  const m = /^cli_c(\d+)_/i.exec(clientId);
  return m ? `C${m[1]}` : null;
}

export async function chatViaAdvisorAgent(ctx: AuthContext, clientId: string, turns: ChatTurn[]): Promise<ChatReply> {
  await authorizeClient(ctx, clientId); // same access check as the built-in chat
  const agentClient = toAgentClientId(clientId);
  if (!agentClient) throw new Error(`The advisor agent has no data for client ${clientId}.`);

  const res = await fetch(`${process.env.ADVISOR_AGENT_URL!.replace(/\/$/, "")}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Agent-Secret": process.env.AGENT_SERVER_SECRET ?? "" },
    body: JSON.stringify({
      client_id: agentClient,
      user_id: ctx.userId,
      role: "advisor", // app roles (lead_advisor, associate) both map to the agent's advisor view
      messages: (turns ?? []).slice(-12),
    }),
    signal: AbortSignal.timeout(170_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Advisor agent error (${res.status}): ${data.error ?? "no details"}`);

  const store = await getStore();
  await audit(store, ctx, "chat.answered", clientId, clientId, {
    model: data.model,
    retrieved: data.retrieved,
    cited: (data.citations ?? []).length,
    engine: "advisor-agent",
  });
  return data as ChatReply;
}
