"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { useState } from "react";
import { api } from "./api";
import { useSession } from "./session";
import { ErrorState, Spinner } from "./ui";

const NAV = [
  { href: "/workspace", label: "Workspace" },
  { href: "/clients", label: "Clients" },
  { href: "/memory", label: "Memory" },
  { href: "/dataset", label: "Dataset" },
  { href: "/activity", label: "Activity" },
  { href: "/compare", label: "Compare" },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { session, clients, clientId, setClientId, bump, error } = useSession();
  const [busy, setBusy] = useState(false);
  const [showServices, setShowServices] = useState(false);
  const allLive = session && session.live.storage && session.live.embeddings && session.live.planner;
  const anyLive = session && (session.live.storage || session.live.embeddings || session.live.planner);

  const switchPersona = async (userId: string) => {
    setBusy(true);
    await api("/api/session", { body: { userId } });
    setBusy(false);
    bump();
  };

  const reset = async () => {
    if (!confirm("Reset all demo data to the seeded state?")) return;
    setBusy(true);
    await api("/api/demo/reset", { method: "POST" });
    setBusy(false);
    bump();
    window.location.reload();
  };

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-line bg-canvas/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5 sm:px-6">
          <Link href="/workspace" className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-[#5eead4] via-[#7aa7ff] to-[#b79cff] text-[13px] font-bold text-[#03121f] shadow-[0_0_18px_-2px_rgba(94,234,212,0.6)]">
              C
            </span>
            <span className="text-[15px] font-semibold tracking-tight">Continuity</span>
          </Link>
          <nav className="-mx-1 flex max-w-full gap-1 overflow-x-auto text-sm">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={`relative rounded-md px-2.5 py-1.5 font-medium transition-colors ${path.startsWith(n.href) ? "text-ink" : "text-muted hover:text-ink"}`}
              >
                {path.startsWith(n.href) && (
                  <motion.span
                    layoutId="nav-pill"
                    className="absolute inset-0 rounded-md bg-white/8 ring-1 ring-white/10"
                    transition={{ type: "spring", stiffness: 420, damping: 34 }}
                  />
                )}
                <span className="relative">{n.label}</span>
              </Link>
            ))}
          </nav>
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-3 lg:ml-auto">
            {clients.length > 0 && (
              <label className="flex items-center gap-2 text-sm">
                <span className="label">Client</span>
                <select
                  className="rounded-lg border border-line bg-raised px-2 py-1.5 text-sm font-semibold"
                  value={clientId ?? ""}
                  onChange={(e) => setClientId(e.target.value)}
                >
                  {clients.map((c) => (
                    <option key={c._id} value={c._id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {session && (
              <label className="flex min-w-0 max-w-full items-center gap-2 rounded-lg border border-dashed border-warn/50 bg-warn-soft/60 px-2 py-1 text-sm">
                <span className="text-[10px] font-bold uppercase tracking-wider text-warn" title="Demonstration persona switcher backed by server-defined identities. Not production authentication.">
                  Demo persona
                </span>
                <select
                  className="min-w-0 max-w-[62vw] truncate bg-transparent text-sm font-medium sm:max-w-none"
                  value={session.user._id}
                  disabled={busy}
                  onChange={(e) => switchPersona(e.target.value)}
                >
                  {session.personas.map((p) => (
                    <option key={p._id} value={p._id}>
                      {p.name} · {p.role === "lead_advisor" ? "Lead advisor" : "Associate"} · {p.firmName}
                    </option>
                  ))}
                </select>
                {busy && <Spinner />}
              </label>
            )}
            {session && (
              <div className="relative">
                <button
                  className={`chip border px-2 py-1 ${allLive ? "border-accent/30 bg-accent-soft text-accent" : anyLive ? "border-info/30 bg-info-soft text-info" : "border-warn/40 bg-warn-soft text-warn"}`}
                  onClick={() => setShowServices((s) => !s)}
                >
                  ● {allLive ? "Live services" : anyLive ? "Partly live" : "Demo mode"}
                </button>
                {showServices && (
                  <div className="absolute right-0 top-9 w-[340px] rounded-xl border border-line bg-raised p-4 text-sm shadow-2xl shadow-black/60">
                    <p className="label mb-2">Backing services</p>
                    {(
                      [
                        ["Storage", session.services.storage, session.live.storage],
                        ["Retrieval", session.services.vectorSearch, session.live.storage],
                        ["Embeddings", session.services.embeddings, session.live.embeddings],
                        ["Extraction & planning", session.services.planner, session.live.planner],
                      ] as const
                    ).map(([k, v, live]) => (
                      <div key={k} className="flex items-start justify-between gap-3 border-b border-line py-1.5 last:border-0">
                        <span className="text-muted">{k}</span>
                        <span className={`text-right ${live ? "text-accent" : "text-warn"}`}>
                          {live ? "LIVE · " : "DEMO · "}
                          {v}
                        </span>
                      </div>
                    ))}
                    <p className="mt-2 text-xs text-muted">
                      Demo components are deterministic stand-ins. Nothing labeled demo came from Atlas or a model.
                    </p>
                    {session.allowDemoReset && (
                      <button className="btn-secondary mt-3 w-full justify-center" onClick={reset} disabled={busy}>
                        Reset demo data
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1500px] px-4 py-5 sm:px-6">
        {error ? (
          <ErrorState error={error} onRetry={bump} />
        ) : !session ? (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Spinner /> Loading workspace…
          </div>
        ) : clients.length === 0 ? (
          <div className="card p-6 text-sm text-muted">You are not assigned to any clients.</div>
        ) : (
          children
        )}
      </main>
    </div>
  );
}
