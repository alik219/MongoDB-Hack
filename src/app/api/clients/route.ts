import { handle } from "@/lib/api";
import { listClients } from "@/lib/services/clients";
export const dynamic = "force-dynamic";
export async function GET() {
  return handle((ctx) => listClients(ctx));
}
