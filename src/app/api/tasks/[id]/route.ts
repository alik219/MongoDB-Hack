import { body, handle } from "@/lib/api";
import { badRequest } from "@/lib/auth";
import { explainTask, taskAction } from "@/lib/services/tasks";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };
export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  return handle((ctx) => explainTask(ctx, id));
}
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const b = await body<{ action: string; note?: string }>(req);
  return handle(async (ctx) => {
    if (!["approve", "withdraw", "complete", "reopen"].includes(b.action)) throw badRequest("Unknown action");
    return taskAction(ctx, id, b.action as "approve", b.note);
  });
}
