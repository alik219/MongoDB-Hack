"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { api } from "./api";
import { useSession } from "./session";
import { ErrorState, Spinner } from "./ui";

const NAV: { section: string; icon: React.ReactNode; items: { href: string; label: string }[] }[] = [
  {
    section: "Agent",
    icon: <path d="M8 1 2.5 3v4.2c0 3.3 2.3 6.3 5.5 7.3 3.2-1 5.5-4 5.5-7.3V3L8 1Zm0 4.3a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4Z" />,
    items: [
      { href: "/workspace", label: "Workspace" },
      { href: "/clients", label: "Clients" },
    ],
  },
  {
    section: "Memory",
    icon: <path d="M8 1.5c-3 0-5.5 1-5.5 2.500v8c0 1.500 2.500 2.500 5.500 2.500s5.500-1 5.500-2.500V4c0-1.500-2.500-2.500-5.500-2.500ZM4 7.200c1 .5 2.400.8 4 .8s3-.3 4-.8v1.600c-.7.5-2.200.9-4 .9s-3.300-.4-4-.9V7.200Z" />,
    items: [
      { href: "/memory", label: "Memories" },
      { href: "/dataset", label: "Dataset" },
    ],
  },
  {
    section: "Governance",
    icon: <path d="M2 3h12v1.800H2V3Zm0 4.100h8v1.800H2V7.100Zm0 4.100h5V13H2v-1.800Zm8.300 1.500 1.500 1.500 3-3.200-1.100-1-1.900 2.100-.5-.5-1 1.100Z" />,
    items: [
      { href: "/activity", label: "Activity Feed" },
      { href: "/compare", label: "Compare Runs" },
    ],
  },
];

const EYEBROW = "text-[10.5px] font-bold uppercase tracking-[0.12em] text-spring";

function Brand() {
  return (
    <Link href="/workspace" className="flex items-center gap-2.5">
      <svg className="h-7 w-7 text-spring" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
        <path d="M20 12a8 8 0 1 1-3.200-6.400" />
        <path d="M12 3.500V8" />
        <circle cx="12" cy="12" r="1.800" fill="currentColor" stroke="none" />
      </svg>
      <span className="font-serif text-[26px] leading-none tracking-tight">
        <span className="text-spring">Recall</span>
        <span className="text-ink-soft">.IQ</span>
      </span>
    </Link>
  );
}

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
    <div className="min-h-screen lg:pl-[232px]">
      {/* Sidebar (desktop) */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[232px] flex-col border-r border-line bg-canvas lg:flex">
        <div className="px-5 py-6">
          <Brand />
        </div>
        <nav className="flex-1 space-y-6 overflow-y-auto pb-6 pt-2">
          {NAV.map((group) => (
            <div key={group.section}>
              <p className="mb-1.5 flex items-center gap-2 px-5 text-[11.5px] font-bold uppercase tracking-[0.12em] text-spring">
                <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                  {group.icon}
                </svg>
                {group.section}
              </p>
              {group.items.map((n) => {
                const active = path.startsWith(n.href);
                return (
                  <Link
                    key={n.href}
                    href={n.href}
                    aria-current={active ? "page" : undefined}
                    className={`block border-l-[3px] py-2 pl-[37px] pr-4 text-[14.5px] transition ${
                      active
                        ? "border-spring bg-evergreen-3 font-semibold text-ink"
                        : "border-transparent text-ink-soft hover:bg-evergreen-2 hover:text-ink"
                    }`}
                  >
                    {n.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <p className="border-t border-line px-5 py-3 text-[11px] leading-snug text-muted">
          Governed memory on <span className="text-spring">MongoDB Atlas</span> Vector Search
        </p>
      </aside>

      {/* Top bar */}
      <header className="sticky top-0 z-20 border-b border-line bg-canvas/95 backdrop-blur">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-7">
          <div className="lg:hidden">
            <Brand />
          </div>
          <div className="flex items-center gap-4">
            {session?.firm && (
              <div>
                <p className={EYEBROW}>Organization</p>
                <p className="text-sm text-ink">{session.firm.name}</p>
              </div>
            )}
            {session?.firm && clients.length > 0 && <span className="text-muted">›</span>}
            {clients.length > 0 && (
              <label className="block">
                <span className={`block ${EYEBROW}`}>Client</span>
                <select
                  className="-ml-1 cursor-pointer rounded bg-transparent pl-1 pr-1 text-sm text-ink hover:bg-evergreen-2 focus:outline-none focus:ring-1 focus:ring-spring/50"
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
          </div>
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-3 lg:ml-auto">
            {session && (
              <label className="flex min-w-0 max-w-full items-center gap-2 rounded-md border border-dashed border-warn/50 bg-warn-soft/50 px-2.5 py-1.5 text-sm">
                <span
                  className="text-[10px] font-bold uppercase tracking-wider text-warn"
                  title="Demonstration persona switcher backed by server-defined identities. Not production authentication."
                >
                  Demo persona
                </span>
                <select
                  className="min-w-0 max-w-[62vw] cursor-pointer truncate bg-transparent text-sm text-ink focus:outline-none sm:max-w-none"
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
                  className={`chip border px-2.5 py-1.5 ${allLive ? "border-accent/40 bg-accent-soft text-accent" : anyLive ? "border-info/40 bg-info-soft text-info" : "border-warn/40 bg-warn-soft text-warn"}`}
                  onClick={() => setShowServices((s) => !s)}
                >
                  ● {allLive ? "Live services" : anyLive ? "Partly live" : "Demo mode"}
                </button>
                {showServices && (
                  <div className="absolute right-0 top-10 z-40 w-[340px] rounded-xl border border-line bg-slate-50 p-4 text-sm shadow-2xl">
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
        {/* Navigation (narrow screens) */}
        <nav className="flex gap-1 overflow-x-auto border-t border-line px-3 py-1.5 text-sm lg:hidden">
          {NAV.flatMap((g) => g.items).map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`whitespace-nowrap rounded-md px-2.5 py-1.5 font-medium ${path.startsWith(n.href) ? "bg-evergreen-3 text-spring" : "text-ink-soft hover:text-ink"}`}
            >
              {n.label}
            </Link>
          ))}
        </nav>
      </header>

      <main className="px-4 py-6 sm:px-7">
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
