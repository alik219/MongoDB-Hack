import { handle } from "@/lib/api";
import { clientActivity } from "@/lib/services/clients";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const clientId = new URL(req.url).searchParams.get("clientId") || undefined;
  return handle((ctx) => clientActivity(ctx, clientId));
}
