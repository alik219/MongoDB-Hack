"use client";

import Link from "next/link";
import { fmtDate } from "@/components/api";
import { useSession } from "@/components/session";
import { RestrictedBadge } from "@/components/ui";

export default function ClientsPage() {
  const { clients, setClientId, session } = useSession();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Clients</h1>
        <p className="text-sm text-muted">
          Clients assigned to {session?.user.name} at {session?.firm?.name}. Clients outside your assignments or firm are not
          listed and cannot be queried.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {clients.map((c) => (
          <div key={c._id} className="card p-4">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold">{c.name}</h2>
                <p className="text-sm text-muted">
                  {c.profile.age} · {c.profile.occupation}
                </p>
              </div>
              <span className="text-xs text-muted">Next review {fmtDate(c.profile.nextReview)}</span>
            </div>
            <p className="mt-2 text-[13px] text-ink-soft">{c.profile.household}</p>
            <p className="text-[13px] text-ink-soft">Lead: {c.leadAdvisorName}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <span className="chip bg-accent-soft text-accent">{c.counts.active} active</span>
              {c.counts.proposed > 0 && <span className="chip bg-info-soft text-info">{c.counts.proposed} proposed</span>}
              {c.counts.expired > 0 && <span className="chip bg-warn-soft text-warn">{c.counts.expired} expired</span>}
              {c.counts.restricted > 0 && <RestrictedBadge />}
              <span className="chip bg-slate-100 text-slate-600">{c.counts.openTasks} open tasks</span>
              {c.counts.needsReview > 0 && <span className="chip bg-warn-soft text-warn">{c.counts.needsReview} need review</span>}
            </div>
            <div className="mt-4 flex gap-2">
              <Link href="/workspace" className="btn-primary" onClick={() => setClientId(c._id)}>
                Open workspace
              </Link>
              <Link href="/memory" className="btn-secondary" onClick={() => setClientId(c._id)}>
                Memory
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
