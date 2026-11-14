import { body, handle } from "@/lib/api";
import { badRequest } from "@/lib/auth";
import {
  approveProposal,
  correctMemory,
  forgetMemory,
  getMemoryDetail,
  reconfirmMemory,
  rejectProposal,
  restrictMemory,
  setExpiration,
} from "@/lib/services/memories";
import type { Attr, MemoryCategory } from "@/lib/types";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  return handle((ctx) => getMemoryDetail(ctx, id));
}

export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const b = await body<Record<string, unknown>>(req);
  return handle(async (ctx) => {
    switch (b.action) {
      case "approve":
        return approveProposal(ctx, id);
      case "reject":
        return rejectProposal(ctx, id, String(b.reason ?? ""));
      case "correct":
        return correctMemory(ctx, id, {
          statement: String(b.statement ?? ""),
          reason: String(b.reason ?? ""),
          attributes: (b.attributes as Record<string, Attr> | undefined) ?? undefined,
          category: (b.category as MemoryCategory | undefined) ?? undefined,
        });
      case "restrict":
        return restrictMemory(ctx, id, {
          visibility: b.visibility === "restricted" ? "restricted" : "team",
          allowedUserIds: Array.isArray(b.allowedUserIds) ? (b.allowedUserIds as string[]) : [],
        });
      case "set_expiration":
        return setExpiration(ctx, id, {
          expiresAt: b.expiresAt as string | null | undefined,
          reviewAt: b.reviewAt as string | null | undefined,
        });
      case "reconfirm":
        return reconfirmMemory(ctx, id);
      case "forget":
        return forgetMemory(ctx, id, String(b.reason ?? ""));
      default:
        throw badRequest("Unknown action");
    }
  });
}
