import { body, handle } from "@/lib/api";
import { compareRuns } from "@/lib/services/clients";
export const dynamic = "force-dynamic";
export const maxDuration = 180;
export async function POST(req: Request) {
  const b = await body<{ clientId: string; request: string }>(req);
  return handle((ctx) => compareRuns(ctx, b.clientId, b.request));
}
