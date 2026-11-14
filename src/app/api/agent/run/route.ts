import { body, handle } from "@/lib/api";
import { runAgent } from "@/lib/services/agent";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
export async function POST(req: Request) {
  const b = await body<{ clientId: string; request: string }>(req);
  return handle((ctx) => runAgent(ctx, b.clientId, b.request));
}
