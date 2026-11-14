import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { getStore } from "@/lib/store";
import { seedDemoData } from "@/lib/seed";
export const dynamic = "force-dynamic";
export async function POST() {
  if (!getConfig().allowDemoReset) {
    return NextResponse.json({ error: "Reset is disabled (set ALLOW_DEMO_RESET=true)." }, { status: 403 });
  }
  try {
    await seedDemoData(await getStore());
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 503 });
  }
}
