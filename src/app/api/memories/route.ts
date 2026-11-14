import { handle } from "@/lib/api";
import { listMemories } from "@/lib/services/memories";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const u = new URL(req.url).searchParams;
  return handle((ctx) =>
    listMemories(ctx, {
      clientId: u.get("clientId") || undefined,
      status: u.get("status") || undefined,
      category: u.get("category") || undefined,
      search: u.get("q") || undefined,
    }),
  );
}
