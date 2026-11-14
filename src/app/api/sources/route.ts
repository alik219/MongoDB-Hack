import { handle } from "@/lib/api";
import { listSources } from "@/lib/services/memories";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const clientId = new URL(req.url).searchParams.get("clientId") ?? "";
  return handle((ctx) => listSources(ctx, clientId));
}
