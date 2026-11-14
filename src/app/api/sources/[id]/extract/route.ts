import { handle } from "@/lib/api";
import { extractFromSource } from "@/lib/services/memories";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
/** Propose memories from a stored document. Identity and client scope come from the session. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle((ctx) => extractFromSource(ctx, id));
}
