"use client";

import { createElement, useEffect, useState } from "react";
import { api } from "./api";

/**
 * ElevenLabs voice agent. The app mints a short-lived session token for the current persona and
 * hands it to the agent as a dynamic variable; the agent's webhook tools (Go service) verify it.
 * The selected client id is a hint for the agent, but the Go service re-authorizes every call.
 */
export function VoiceAgent({ clientId, clientName }: { clientId: string; clientName: string }) {
  const [cfg, setCfg] = useState<{ token: string; agentId: string; user: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api<{ token: string; agentId: string; user: string }>("/api/voice/session")
      .then((c) => alive && setCfg(c))
      .catch((e: Error) => alive && setErr(e.message));
    return () => {
      alive = false;
    };
  }, [clientId]);

  useEffect(() => {
    if (!cfg || document.querySelector("script[data-elevenlabs-widget]")) return;
    const s = document.createElement("script");
    s.src = "https://unpkg.com/@elevenlabs/convai-widget-embed";
    s.async = true;
    s.dataset.elevenlabsWidget = "1";
    document.body.appendChild(s);
  }, [cfg]);

  if (err) return <p className="text-[12px] text-muted">Voice agent unavailable: {err}</p>;
  if (!cfg) return null;
  return createElement("elevenlabs-convai", {
    key: `${clientId}-${cfg.token.slice(-8)}`,
    "agent-id": cfg.agentId,
    "dynamic-variables": JSON.stringify({
      session_token: cfg.token,
      client_id: clientId,
      client_name: clientName,
      advisor_name: cfg.user,
    }),
  });
}
