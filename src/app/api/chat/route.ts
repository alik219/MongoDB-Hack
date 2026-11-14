import { body, handle } from "@/lib/api";
import { chat, type ChatTurn } from "@/lib/services/chat";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(req: Request) {
  const b = await body<{ clientId: string; messages: ChatTurn[] }>(req);
  return handle((ctx) => chat(ctx, b.clientId, b.messages));
}
