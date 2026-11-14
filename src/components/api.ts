"use client";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? (opts.body ? "POST" : "GET"),
      headers: opts.body ? { "content-type": "application/json" } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "network", "Cannot reach the Continuity server.");
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, json.code ?? "error", json.error ?? `Request failed (${res.status})`);
  return json as T;
}

export const fmtDate = (s?: string | null) =>
  s ? new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
export const fmtDateTime = (s?: string | null) =>
  s
    ? new Date(s).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : "—";
export const label = (s: string) => s.replace(/_/g, " ");
