"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { useSession } from "./session";
import { ErrorState, Spinner } from "./ui";

const ICON: Record<string, React.ReactNode> = {
  agent: (
    <path d="M8 1.5 2 4.5v3.4c0 3 2.5 5.6 6 6.6 3.5-1 6-3.600 6-6.6V4.5L8 1.5Zm0 3.200a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z" />
  ),
  memory: (
    <path d="M8 1.500c-3.300 0-6 1-6 2.500v8c0 1.500 2.700 2.500 6 2.500s6-1 6-2.500V4c0-1.500-2.700-2.500-6-2.500Zm0 1.500c2.900 0 4.500.800 4.500 1S10.900 5 8 5 3.500 4.200 3.500 4 5.100 3 8 3Zm0 9.500c-2.900 0-4.500-.800-4.500-1V9.800C4.600 10.300 6.200 10.500 8 10.500s3.400-.200 4.500-.700v1.700c0 .200-1.600 1-4.500 1Z" />
  ),
  shield: (
    <path d="M3 2h10v2H3V2Zm0 4h10v2H3V6Zm0 4h6v2H3v-2Zm8.500.500 1 1 2-2.500 1.100.900-3 3.800-2.200-2.100 1.100-1.100Z" />
  ),
};

const NAV: {
  section: string;
  icon: keyof typeof ICON;
  items: { href: string; label: string }[];
}[] = [
  {
    section: "Agent",
    icon: "agent",
    items: [
      { href: "/workspace", label: "Workspace" },
      { href: "/clients", label: "Clients" },
    ],
  },
  {
    section: "Memory",
    icon: "memory",
    items: [
      { href: "/memory", label: "Memories" },
      { href: "/dataset", label: "Dataset" },
    ],
  },
  {
    section: "Governance",
    icon: "shield",
    items: [
      { href: "/activity", label: "Activity Feed" },
      { href: "/compare", label: "Compare Runs" },
    ],
  },
];

const OPEN_W = 264;
const RAIL_W = 64;
const SPRING = { type: "spring", stiffness: 380, damping: 38 } as const;

function Mark() {
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7 shrink-0" aria-hidden>
      <path d="M12 3.500a8.500 8.500 0 1 0 8.500 8.500" fill="none" stroke="#00ed64" strokeWidth="1.800" strokeLinecap="round" />
      <path d="M12 3.500l2.800-2.200M12 3.500l2.600 2.400" fill="none" stroke="#00ed64" strokeWidth="1.800" strokeLinecap="round" />
      <circle cx="12" cy="12" r="2.600" fill="#00ed64" />
    </svg>
  );
}
function Wordmark() {
  return (
    <span className="whitespace-nowrap font-serif text-[24px] leading-none text-accent">
      Recall<span className="text-ink-soft">.IQ</span>
    </span>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { session, clients, clientId, setClientId, bump, error } = useSession();
  const [busy, setBusy] = useState(false);
  const [showServices, setShowServices] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [closedGroups, setClosedGroups] = useState<Record<string, boolean>>({});
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const open = pinned || hovered;

  useEffect(() => {
    try {
      setPinned(localStorage.getItem("recalliq_sidebar") === "pinned");
    } catch {
      /* storage unavailable: stay on the hover rail */
    }
  }, []);

  // A short delay in each direction stops the rail from flickering when the pointer only passes over it.
  const hover = (on: boolean) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHovered(on), on ? 70 : 220);
  };
  const togglePin = () => {
    const next = !pinned;
    setPinned(next);
    if (!next) setHovered(false);
    try {
      localStorage.setItem("recalliq_sidebar", next ? "pinned" : "rail");
    } catch {
      /* ignore */
    }
  };
  const allLive =
    session &&
    session.live.storage &&
    session.live.embeddings &&
    session.live.planner;
  const anyLive =
    session &&
    (session.live.storage || session.live.embeddings || session.live.planner);

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
    <div className="min-h-screen lg:flex">
      {/* Small screens: compact top bar with horizontal navigation */}
      <div className="z-30 border-b border-line bg-canvas lg:hidden">
        <Link href="/workspace" className="flex items-center gap-2.5 px-4 pb-2 pt-4">
          <Mark />
          <Wordmark />
        </Link>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2">
          {NAV.flatMap((g) => g.items).map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`whitespace-nowrap rounded-md px-3 py-1.5 text-[14px] ${path.startsWith(n.href) ? "bg-accent-soft font-semibold text-ink" : "text-ink-soft"}`}
            >
              {n.label}
            </Link>
          ))}
        </nav>
      </div>

      {/* Large screens: an icon rail that opens on hover, or stays open when pinned (as the Atlas console does) */}
      <motion.div
        className="hidden shrink-0 lg:block"
        initial={false}
        animate={{ width: pinned ? OPEN_W : RAIL_W }}
        transition={SPRING}
        aria-hidden
      />
      <motion.aside
        className={`fixed left-0 top-0 z-40 hidden h-screen overflow-hidden border-r border-line bg-canvas lg:block ${open && !pinned ? "shadow-[8px_0_40px_rgba(0,0,0,0.55)]" : ""}`}
        initial={false}
        animate={{ width: open ? OPEN_W : RAIL_W }}
        transition={SPRING}
        onMouseEnter={() => hover(true)}
        onMouseLeave={() => hover(false)}
        onFocusCapture={() => setHovered(true)}
        onBlurCapture={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHovered(false);
        }}
      >
        <div className="flex h-full flex-col" style={{ width: OPEN_W }}>
          <Link
            href="/workspace"
            className="flex h-[65px] shrink-0 items-center gap-2.5 border-b border-line pl-[18px]"
            aria-label="Recall.IQ workspace"
          >
            <Mark />
            <motion.span initial={false} animate={{ opacity: open ? 1 : 0, x: open ? 0 : -6 }} transition={{ duration: 0.18 }}>
              <Wordmark />
            </motion.span>
          </Link>
          <nav className="flex-1 overflow-y-auto overflow-x-hidden pt-3">
            {NAV.map((g) => {
              const groupActive = g.items.some((n) => path.startsWith(n.href));
              const expanded = open && !closedGroups[g.section];
              return (
                <div key={g.section} className="mb-1">
                  <button
                    type="button"
                    onClick={() => setClosedGroups((c) => ({ ...c, [g.section]: !c[g.section] }))}
                    aria-expanded={expanded}
                    tabIndex={open ? 0 : -1}
                    className="group flex w-full items-center gap-3 py-2.5 pl-3 pr-5 text-left"
                  >
                    <span
                      className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg transition-colors ${!open && groupActive ? "bg-accent-soft text-accent" : "text-accent"}`}
                    >
                      <svg viewBox="0 0 16 16" className="h-[18px] w-[18px]" fill="currentColor" aria-hidden>
                        {ICON[g.icon]}
                      </svg>
                    </span>
                    <motion.span
                      initial={false}
                      animate={{ opacity: open ? 1 : 0 }}
                      transition={{ duration: 0.15 }}
                      className="flex flex-1 items-center justify-between text-[12.5px] font-bold uppercase tracking-[0.08em] text-accent"
                    >
                      {g.section}
                      <motion.svg
                        viewBox="0 0 10 6"
                        className="h-1.5 w-2.5 text-accent"
                        fill="currentColor"
                        initial={false}
                        animate={{ rotate: closedGroups[g.section] ? 180 : 0 }}
                        aria-hidden
                      >
                        <path d="M5 0 10 6H0z" />
                      </motion.svg>
                    </motion.span>
                  </button>
                  <motion.ul
                    initial={false}
                    animate={{ height: expanded ? "auto" : 0, opacity: expanded ? 1 : 0 }}
                    transition={{ height: SPRING, opacity: { duration: 0.15 } }}
                    className="overflow-hidden"
                  >
                    {g.items.map((n) => {
                      const active = path.startsWith(n.href);
                      return (
                        <li key={n.href}>
                          <Link
                            href={n.href}
                            tabIndex={expanded ? 0 : -1}
                            className={`relative block whitespace-nowrap py-2.5 pl-[64px] pr-5 text-[14.5px] transition-colors ${active ? "font-semibold text-ink" : "text-ink-soft hover:bg-raised hover:text-ink"}`}
                          >
                            {active && (
                              <motion.span
                                layoutId="nav-active"
                                className="absolute inset-0 bg-accent-soft"
                                transition={{ type: "spring", stiffness: 420, damping: 36 }}
                              >
                                <span className="absolute inset-y-0 left-0 w-1 rounded-r bg-accent" />
                              </motion.span>
                            )}
                            <span className="relative">{n.label}</span>
                          </Link>
                        </li>
                      );
                    })}
                  </motion.ul>
                </div>
              );
            })}
          </nav>
          <div className="shrink-0 border-t border-line p-3">
            <button
              type="button"
              onClick={togglePin}
              aria-pressed={pinned}
              title={pinned ? "Collapse sidebar" : "Keep sidebar open"}
              className="flex h-10 items-center gap-3 rounded-lg pr-3 text-[13px] text-ink-soft hover:bg-raised hover:text-ink"
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center">
                <motion.svg
                  viewBox="0 0 16 16"
                  className="h-[18px] w-[18px]"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  initial={false}
                  animate={{ rotate: pinned ? 0 : 180 }}
                  aria-hidden
                >
                  <rect x="1.7" y="2.2" width="12.6" height="11.6" rx="2" />
                  <path d="M5.6 2.200v11.600M11 6 9 8l2 2" strokeLinecap="round" strokeLinejoin="round" />
                </motion.svg>
              </span>
              <motion.span initial={false} animate={{ opacity: open ? 1 : 0 }} transition={{ duration: 0.15 }} className="whitespace-nowrap">
                {pinned ? "Collapse sidebar" : "Keep sidebar open"}
              </motion.span>
            </button>
          </div>
        </div>
      </motion.aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 border-b border-line bg-canvas/95 backdrop-blur">
          <div className="flex min-h-[64px] flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5 sm:px-8">
            {session?.firm && (
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-accent">
                  Organization
                </p>
                <p className="truncate text-[14.5px] text-ink">
                  {session.firm.name}
                </p>
              </div>
            )}
            {session?.firm && clients.length > 0 && (
              <span className="text-xl text-muted">›</span>
            )}
            {clients.length > 0 && (
              <label className="min-w-0">
                <span className="block text-[11px] font-bold uppercase tracking-[0.08em] text-accent">
                  Client
                </span>
                <select
                  className="-ml-1 max-w-[60vw] truncate bg-transparent text-[14.5px] text-ink focus:outline-none"
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
            <div className="flex min-w-0 max-w-full flex-wrap items-center gap-3 lg:ml-auto">
              {session && (
                <label className="flex min-w-0 max-w-full items-center gap-2 rounded-lg border border-dashed border-warn/50 bg-warn-soft/60 px-2 py-1 text-sm">
                  <span
                    className="text-[10px] font-bold uppercase tracking-wider text-warn"
                    title="Demonstration persona switcher backed by server-defined identities. Not production authentication."
                  >
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
                        {p.name} ·{" "}
                        {p.role === "lead_advisor"
                          ? "Lead advisor"
                          : "Associate"}{" "}
                        · {p.firmName}
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
                    ●{" "}
                    {allLive
                      ? "Live services"
                      : anyLive
                        ? "Partly live"
                        : "Demo mode"}
                  </button>
                  {showServices && (
                    <div className="absolute right-0 top-9 w-[340px] rounded-xl border border-line bg-raised p-4 text-sm shadow-2xl shadow-black/60">
                      <p className="label mb-2">Backing services</p>
                      {(
                        [
                          [
                            "Storage",
                            session.services.storage,
                            session.live.storage,
                          ],
                          [
                            "Retrieval",
                            session.services.vectorSearch,
                            session.live.storage,
                          ],
                          [
                            "Embeddings",
                            session.services.embeddings,
                            session.live.embeddings,
                          ],
                          [
                            "Extraction & planning",
                            session.services.planner,
                            session.live.planner,
                          ],
                        ] as const
                      ).map(([k, v, live]) => (
                        <div
                          key={k}
                          className="flex items-start justify-between gap-3 border-b border-line py-1.5 last:border-0"
                        >
                          <span className="text-muted">{k}</span>
                          <span
                            className={`text-right ${live ? "text-accent" : "text-warn"}`}
                          >
                            {live ? "LIVE · " : "DEMO · "}
                            {v}
                          </span>
                        </div>
                      ))}
                      <p className="mt-2 text-xs text-muted">
                        Demo components are deterministic stand-ins. Nothing
                        labeled demo came from Atlas or a model.
                      </p>
                      {session.allowDemoReset && (
                        <button
                          className="btn-secondary mt-3 w-full justify-center"
                          onClick={reset}
                          disabled={busy}
                        >
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
        <main className="mx-auto max-w-[1500px] px-4 py-6 sm:px-8">
          {error ? (
            <ErrorState error={error} onRetry={bump} />
          ) : !session ? (
            <div className="flex items-center gap-2 text-sm text-muted">
              <Spinner /> Loading workspace…
            </div>
          ) : clients.length === 0 ? (
            <div className="card p-6 text-sm text-muted">
              You are not assigned to any clients.
            </div>
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}
