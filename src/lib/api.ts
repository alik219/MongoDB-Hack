import { NextResponse } from "next/server";
import { AppError, getAuthContext, type AuthContext } from "./auth";

/** Every API route derives identity from the session and maps errors to safe responses. */
export async function handle<T>(fn: (ctx: AuthContext) => Promise<T>) {
  try {
    const ctx = await getAuthContext();
    return NextResponse.json(await fn(ctx));
  } catch (err) {
    if (err instanceof AppError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    const e = err as Error & { status?: number };
    if (e.status === 404) return NextResponse.json({ error: e.message, code: "not_found" }, { status: 404 });
    const msg = e.message ?? "Unexpected error";
    const disconnected = /ECONN|ENOTFOUND|Server selection|MongoNetwork|timed out|fetch failed/i.test(msg);
    console.error("[continuity]", msg);
    return NextResponse.json(
      {
        error: disconnected ? "A backing service is unreachable. Check your Atlas/model configuration." : msg,
        code: disconnected ? "service_unavailable" : "internal_error",
      },
      { status: disconnected ? 503 : 500 },
    );
  }
}

export async function body<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}
