import { body, handle } from "@/lib/api";
import { advisorAgentEnabled, chatViaAdvisorAgent } from "@/lib/services/advisor-agent";
import { chat, type ChatTurn } from "@/lib/services/chat";
export const dynamic = "force-dynamic";
// The LangGraph advisor agent runs several tool calls per turn; allow it time.
export const maxDuration = 180;
export async function POST(req: Request) {
  const b = await body<{ clientId: string; messages: ChatTurn[] }>(req);
  return handle((ctx) =>
    advisorAgentEnabled() ? chatViaAdvisorAgent(ctx, b.clientId, b.messages) : chat(ctx, b.clientId, b.messages),
  );
}
