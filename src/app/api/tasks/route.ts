import { handle } from "@/lib/api";
import { listTasks } from "@/lib/services/tasks";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const clientId = new URL(req.url).searchParams.get("clientId") ?? "";
  return handle((ctx) => listTasks(ctx, clientId));
}
