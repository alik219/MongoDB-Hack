"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, ApiError } from "./api";

export interface SessionInfo {
  user: { _id: string; name: string; title: string; role: string; firmId: string };
  firm: { _id: string; name: string } | null;
  personas: { _id: string; name: string; title: string; role: string; firmName: string }[];
  services: { storage: string; vectorSearch: string; embeddings: string; planner: string };
  live: { storage: boolean; embeddings: boolean; planner: boolean };
  allowDemoReset: boolean;
}

export interface ClientSummary {
  _id: string;
  name: string;
  leadAdvisorId: string;
  leadAdvisorName: string;
  teamUserIds: string[];
  profile: {
    age: number;
    occupation: string;
    household: string;
    relationshipSince: string;
    nextReview: string;
    serviceTier: string;
  };
  counts: { active: number; proposed: number; expired: number; restricted: number; openTasks: number; needsReview: number };
}

interface Ctx {
  session: SessionInfo | null;
  clients: ClientSummary[];
  clientId: string | null;
  client: ClientSummary | null;
  setClientId: (id: string) => void;
  refresh: () => Promise<void>;
  error: ApiError | null;
  version: number;
  bump: () => void;
}

const SessionCtx = createContext<Ctx | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [clientId, setClientIdState] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [version, setVersion] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const [s, c] = await Promise.all([api<SessionInfo>("/api/session"), api<ClientSummary[]>("/api/clients")]);
      setSession(s);
      setClients(c);
      setError(null);
      setClientIdState((cur) => {
        let stored: string | null = null;
        try {
          stored = localStorage.getItem("continuity.client");
        } catch {}
        const url = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("client") : null;
        const pick = [url, cur, stored].find((id) => id && c.some((x) => x._id === id));
        return pick ?? c[0]?._id ?? null;
      });
    } catch (e) {
      setError(e as ApiError);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, version]);

  const setClientId = (id: string) => {
    setClientIdState(id);
    try {
      localStorage.setItem("continuity.client", id);
    } catch {}
  };

  return (
    <SessionCtx.Provider
      value={{
        session,
        clients,
        clientId,
        client: clients.find((c) => c._id === clientId) ?? null,
        setClientId,
        refresh,
        error,
        version,
        bump: () => setVersion((v) => v + 1),
      }}
    >
      {children}
    </SessionCtx.Provider>
  );
}

export function useSession() {
  const c = useContext(SessionCtx);
  if (!c) throw new Error("useSession outside provider");
  return c;
}
