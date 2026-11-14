import { handle } from "@/lib/api";
import { listRuns } from "@/lib/services/agent";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const clientId = new URL(req.url).searchParams.get("clientId") ?? "";
  return handle((ctx) => listRuns(ctx, clientId));
}
