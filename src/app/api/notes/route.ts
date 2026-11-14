import { body, handle } from "@/lib/api";
import { ingestNote } from "@/lib/services/memories";
import type { SourceKind } from "@/lib/types";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  const b = await body<Record<string, string>>(req);
  // Only these fields are read. firmId/role/access fields in the body are ignored.
  return handle((ctx) =>
    ingestNote(ctx, {
      clientId: b.clientId,
      title: b.title ?? "",
      kind: (b.kind ?? "meeting_note") as SourceKind,
      sourceDate: b.sourceDate ?? "",
      text: b.text ?? "",
    }),
  );
}
