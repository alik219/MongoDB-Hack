"""HTTP wrapper so other apps (e.g. the Next.js Recall.IQ chatbot) can call the advisor agent.

    set -a; source ~/.mongodb-mcp.env; set +a
    AGENT_SERVER_SECRET=<shared secret> .venv/bin/python -m app.agent_server   # :8765

POST /chat   (header  X-Agent-Secret: <AGENT_SERVER_SECRET>)
  {"client_id": "C1", "user_id": "usr_daniel", "role": "advisor",
   "messages": [{"role": "user"|"assistant", "content": "..."}]}
-> {"answer", "citations": [{"memoryId","category","statement"}], "followUps": [],
    "model", "live": true, "retrieved", "engine", "toolCalls": [...]}

The calling app must authenticate the user and authorize the client first; this server trusts
the user/role/client it is given (protected by the shared secret, bind to localhost only).
Uses the existing graph (app/advisor_graph.py) and governed memory (app/memory.py) unchanged.
"""
from __future__ import annotations

import hmac
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from app.advisor_graph import build_graph, llm_provider
from app.advisor_chat import final_text
from app.knowledge_tools import ROLE_VISIBILITY, Session
from app.memory import MemoryService

SECRET = os.environ.get("AGENT_SERVER_SECRET", "")
MAX_TURNS = 12


def run_chat(req: dict) -> dict:
    client_id = req["client_id"]
    role = req.get("role", "advisor")
    if role not in ROLE_VISIBILITY:
        raise ValueError(f"role must be one of {sorted(ROLE_VISIBILITY)}")
    session = Session(req.get("user_id", "unknown"), role, {client_id})
    history = []
    for t in (req.get("messages") or [])[-MAX_TURNS:]:
        text = str(t.get("content", ""))[:4000]
        if text.strip():
            history.append(HumanMessage(text) if t.get("role") == "user" else AIMessage(text))
    if not history or not isinstance(history[-1], HumanMessage):
        raise ValueError("last message must be from the user")

    memory = MemoryService(session, run_id=f"web:{session.user_id}:{client_id}")
    graph = build_graph(session, client_id, memory=memory)          # no checkpointer: app sends history
    out = graph.invoke({"messages": history}, {"configurable": {"thread_id": f"web:{session.user_id}:{client_id}"}})
    new = out["messages"][len(history):]

    calls, citations, seen = [], [], set()
    for m in new:
        for tc in getattr(m, "tool_calls", None) or []:
            calls.append({"name": tc["name"], "args": tc["args"]})
        if isinstance(m, ToolMessage):
            try:
                data = json.loads(m.content)
            except (TypeError, ValueError):
                continue
            for d in data if isinstance(data, list) else [data]:
                if not isinstance(d, dict):
                    continue
                if d.get("memory_id") and d["memory_id"] not in seen:
                    seen.add(d["memory_id"])
                    citations.append({"memoryId": d["memory_id"], "category": f"memory:{d.get('kind', '')}",
                                      "statement": d.get("content") or d.get("stored", "")})
                src = d.get("source_path")
                if src and src not in seen:
                    seen.add(src)
                    label = d.get("section_title") or d.get("decision") or d.get("date") or ""
                    citations.append({"memoryId": src, "category": d.get("doc_type") or "source",
                                      "statement": f"{src}{' · ' + str(label) if label else ''}"})
    answer = final_text(out["messages"][-1])
    return {"answer": answer, "citations": citations[:12], "followUps": [],
            "model": f"advisor-agent:{llm_provider()}", "live": True,
            "retrieved": len(citations), "engine": "LangGraph agent · Atlas Vector Search + governed memory",
            "toolCalls": calls}


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, payload: dict) -> None:
        body = json.dumps(payload, default=str).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            return self._send(200, {"ok": True, "provider": llm_provider()})
        self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/chat":
            return self._send(404, {"error": "not found"})
        if not SECRET or not hmac.compare_digest(self.headers.get("X-Agent-Secret", ""), SECRET):
            return self._send(401, {"error": "unauthorized"})
        try:
            req = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
            self._send(200, run_chat(req))
        except (ValueError, KeyError, PermissionError) as e:
            self._send(400, {"error": str(e)})
        except Exception as e:  # model/provider/database errors
            self._send(502, {"error": f"{type(e).__name__}: {str(e).splitlines()[0][:300]}"})

    def log_message(self, fmt, *args):  # keep request logs short
        print("[agent-server]", fmt % args)


def main() -> None:
    if not SECRET:
        raise SystemExit("Set AGENT_SERVER_SECRET (shared with the calling app).")
    port = int(os.environ.get("AGENT_SERVER_PORT", "8765"))
    print(f"advisor agent on http://127.0.0.1:{port}  (provider: {llm_provider()})")
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()


if __name__ == "__main__":
    main()
