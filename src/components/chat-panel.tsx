"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { CategoryBadge, ErrorState, Spinner } from "./ui";

interface Citation {
  memoryId: string;
  category: string;
  statement: string;
}
interface Reply {
  answer: string;
  citations: Citation[];
  followUps: string[];
  model: string;
  live: boolean;
  retrieved: number;
  engine: string;
}
type Msg = { role: "user"; content: string } | { role: "assistant"; content: string; reply: Reply };

const STARTERS = (first: string) => [
  `What changed for ${first} since the last review?`,
  `What should I be careful about with ${first}?`,
  `Which lender fits ${first} best, and why?`,
];

export function ChatPanel({
  clientId,
  clientName,
  onOpenMemory,
}: {
  clientId: string;
  clientName: string;
  onOpenMemory: (id: string) => void;
}) {
  const first = clientName.split(" ")[0];
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const scroller = useRef<HTMLDivElement>(null);

  // A conversation belongs to one client: switching client or persona starts clean.
  useEffect(() => {
    setMsgs([]);
    setErr(null);
    setDraft("");
  }, [clientId]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [msgs, busy]);

  const send = async (text: string, base: Msg[] = msgs) => {
    const q = text.trim();
    if (q.length < 2 || busy) return;
    const next: Msg[] = [...base, { role: "user", content: q }];
    setMsgs(next);
    setDraft("");
    setErr(null);
    setBusy(true);
    try {
      const reply = await api<Reply>("/api/chat", {
        body: { clientId, messages: next.map((m) => ({ role: m.role, content: m.content })) },
      });
      setMsgs([...next, { role: "assistant", content: reply.answer, reply }]);
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };

  const retry = () => {
    const lastUser = [...msgs].reverse().find((m) => m.role === "user");
    if (lastUser) void send(lastUser.content, msgs.slice(0, -1));
  };

  const lastReply = [...msgs].reverse().find((m) => m.role === "assistant");
  const suggestions = msgs.length === 0 ? STARTERS(first) : lastReply?.role === "assistant" ? lastReply.reply.followUps : [];

  return (
    <section className="card relative overflow-clip p-5">
      <div className="pointer-events-none absolute -right-24 -top-24 h-56 w-56 rounded-full bg-accent/10 blur-3xl" />
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="label">Ask Recall.IQ</p>
          <h2 className="mt-1 text-[22px] font-semibold leading-tight tracking-tight">
            Ask anything about <span className="text-gradient">{first}</span>
          </h2>
        </div>
        {msgs.length > 0 && (
          <button className="btn-ghost text-[12.5px]" onClick={() => { setMsgs([]); setErr(null); }}>
            New chat
          </button>
        )}
      </div>

      {msgs.length > 0 && (
        <div ref={scroller} className="mt-4 max-h-[560px] space-y-3 overflow-y-auto pr-1">
          <AnimatePresence initial={false}>
            {msgs.map((m, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.22 }}
                className={m.role === "user" ? "flex justify-end" : "flex justify-start"}
              >
                {m.role === "user" ? (
                  <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-accent-soft px-3.5 py-2 text-[14px] text-ink">
                    {m.content}
                  </div>
                ) : (
                  <div className="max-w-[92%] rounded-2xl rounded-bl-sm border border-line bg-canvas px-3.5 py-3">
                    <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-ink">{m.content}</p>
                    {m.reply.citations.length > 0 && (
                      <div className="mt-3 border-t border-line pt-2">
                        <p className="label mb-1.5">Grounded in {m.reply.citations.length} confirmed memories</p>
                        <ul className="space-y-1">
                          {m.reply.citations.map((c) => (
                            <li key={c.memoryId}>
                              <button
                                onClick={() => onOpenMemory(c.memoryId)}
                                className="flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-left text-[12.5px] text-ink-soft hover:bg-white/5"
                              >
                                <CategoryBadge category={c.category} />
                                <span className="min-w-0 flex-1">{c.statement}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <p className="mt-2 font-mono text-[10.5px] text-muted">
                      {m.reply.live ? m.reply.model : "no model configured"} · {m.reply.retrieved} memories in context · {m.reply.engine}
                    </p>
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
          {busy && (
            <div className="flex items-center gap-2 text-[12.5px] text-muted">
              <Spinner /> Retrieving what you may see, then thinking…
            </div>
          )}
        </div>
      )}

      {err != null && (
        <div className="mt-3">
          <ErrorState error={err} onRetry={retry} />
        </div>
      )}

      {suggestions.length > 0 && !busy && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => void send(s)}
              className="rounded-full border border-line px-3 py-1 text-[12.5px] text-ink-soft hover:border-accent hover:text-accent"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <form
        className="mt-3 flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send(draft);
        }}
      >
        <textarea
          aria-label={`Ask about ${first}`}
          className="input min-h-[44px] flex-1 text-[14px]"
          rows={1}
          placeholder={`Ask a question about ${first}…`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(draft);
            }
          }}
        />
        <button className="btn-primary px-4 py-2.5" disabled={busy || draft.trim().length < 2}>
          {busy ? <Spinner className="text-white" /> : "Ask"}
        </button>
      </form>
      <p className="mt-2 text-xs text-muted">
        Answers use only confirmed memories you are allowed to see for {clientName}. The chat cannot change memory or tasks.
      </p>
    </section>
  );
}
