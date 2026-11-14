import { NextResponse } from "next/server";
import { getConfig, serviceLabels } from "@/lib/config";
import { getStore } from "@/lib/store";
export const dynamic = "force-dynamic";
export async function GET() {
  const cfg = getConfig();
  try {
    const store = await getStore();
    await store.firms.count({});
    return NextResponse.json({ ok: true, services: serviceLabels(cfg) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message, services: serviceLabels(cfg) }, { status: 503 });
  }
}
