import { NextResponse } from "next/server";
import { body, handle } from "@/lib/api";
import { PERSONA_COOKIE } from "@/lib/auth";
import { getStore } from "@/lib/store";
import { sessionInfo } from "@/lib/services/clients";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle((ctx) => sessionInfo(ctx));
}

/** Demo persona switch. The server only accepts ids of server-defined users. */
export async function POST(req: Request) {
  const { userId } = await body<{ userId: string }>(req);
  const store = await getStore();
  const user = typeof userId === "string" ? await store.users.findOne({ _id: userId }) : null;
  if (!user) return NextResponse.json({ error: "Unknown persona" }, { status: 400 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(PERSONA_COOKIE, user._id, { httpOnly: true, sameSite: "lax", path: "/" });
  return res;
}
