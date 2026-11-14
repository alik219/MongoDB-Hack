import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { AppError, contextForUser } from "@/lib/auth";
import { runAgent } from "@/lib/services/agent";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Server-to-server only: the Go tool service calls this after verifying the voice session token.
 * Identity is the userId the Go service verified; the same governed run (access checks, pre-filtered
 * retrieval, lender engine, validation) applies. Returns a voice-sized summary.
 */
export async function POST(req: Request) {
  const secret = process.env.INTERNAL_API_SECRET ?? "";
  const given = req.headers.get("x-internal-secret") ?? "";
  if (!secret || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    const b = (await req.json()) as { userId?: string; clientId?: string; request?: string };
    const ctx = await contextForUser(String(b.userId ?? ""));
    const { run } = await runAgent(ctx, String(b.clientId ?? ""), String(b.request ?? ""));
    return NextResponse.json({
      runId: run._id,
      status: run.status,
      summary: run.brief?.summary ?? null,
      missingInformation: run.brief?.missingInformation.map((p) => p.text) ?? [],
      lenderChecks: (run.lenderChecks ?? []).map((c) => ({
        bank: c.bank,
        product: c.product,
        decision: c.decision,
        summary: c.summary,
        offer: c.offer ?? null,
        pivotalFacts: c.pivotalFacts.map((p) => `${p.factKey} (without it: ${p.decisionWithout})`),
      })),
      changes: run.appliedActions.map((a) => ({ type: a.type, title: a.title })),
      errors: run.errors.slice(0, 3),
      note: "Drafts only. The advisor reviews and approves in Continuity; nothing was sent to a lender.",
    });
  } catch (err) {
    const status = err instanceof AppError ? err.status : 500;
    return NextResponse.json({ error: err instanceof AppError ? err.message : "Run failed" }, { status });
  }
}
