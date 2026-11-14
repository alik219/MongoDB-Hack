import { handle } from "@/lib/api";
import { verifyAudit } from "@/lib/services/clients";
export const dynamic = "force-dynamic";
/** Re-computes the caller's firm audit hash chain. Returns counts and hashes only, never event contents. */
export async function GET() {
  return handle((ctx) => verifyAudit(ctx));
}
