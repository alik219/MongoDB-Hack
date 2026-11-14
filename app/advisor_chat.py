"""Chat with the advisor agent about one client. Conversations persist in MongoDB (24 h TTL).

    set -a; source ~/.mongodb-mcp.env; set +a   # MongoDB, Voyage and LANGSMITH_API_KEY (or GOOGLE_/OPENAI_/ANTHROPIC_API_KEY)
    python -m app.advisor_chat --user adv_daniel --role advisor --clients C1,C2 --client C1
    python -m app.advisor_chat ... --conversation <id>          # resume an earlier conversation
    python -m app.advisor_chat ... --ask "What credit can Maya get?"   # one question, then exit

In the real app the session (user, role, allowed clients) comes from the login, not flags.
"""
from __future__ import annotations

import argparse
import uuid

from app.advisor_graph import build_graph, mongo_checkpointer, thread_config
from app.knowledge_tools import Session


def final_text(msg) -> str:
    if isinstance(msg.content, str):
        return msg.content
    return "\n".join(b.get("text", "") for b in msg.content if isinstance(b, dict) and b.get("type") == "text")


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--user", required=True)
    ap.add_argument("--role", default="advisor", choices=["advisor", "underwriter", "client"])
    ap.add_argument("--clients", required=True, help="comma-separated client ids this user may see")
    ap.add_argument("--client", required=True, help="client this conversation is about")
    ap.add_argument("--conversation", help="resume this conversation id")
    ap.add_argument("--ask", help="ask one question and exit")
    ap.add_argument("--no-memory", action="store_true", help="run without long-term memory")
    args = ap.parse_args(argv)

    session = Session(args.user, args.role, set(args.clients.split(",")))
    conv = args.conversation or uuid.uuid4().hex[:12]
    config = thread_config(session, args.client, conv)
    memory = None
    if not args.no_memory:
        from app.memory import MemoryService
        memory = MemoryService(session, run_id=config["configurable"]["thread_id"])
    graph = build_graph(session, args.client, checkpointer=mongo_checkpointer(), memory=memory)
    print(f"conversation {conv} · {args.user} ({args.role}) · client {args.client}  (Ctrl-D to quit)")

    def turn(text: str) -> None:
        try:
            for update in graph.stream({"messages": [("user", text)]}, config, stream_mode="updates"):
                for node, out in update.items():
                    for m in (out or {}).get("messages", []):
                        for tc in getattr(m, "tool_calls", None) or []:
                            print(f"  · {tc['name']}({', '.join(f'{k}={v!r}' for k, v in tc['args'].items())})")
                        if node == "advisor" and not getattr(m, "tool_calls", None):
                            print(f"\nassistant> {final_text(m)}\n")
        except Exception as e:  # provider errors: no credits, bad key, rate limit, network
            print(f"\n[error] {type(e).__name__}: {str(e).splitlines()[0][:300]}\n")

    if args.ask:
        turn(args.ask)
        return
    while True:
        try:
            text = input("you> ").strip()
        except (EOFError, KeyboardInterrupt):
            print(f"\nresume with --conversation {conv}")
            return
        if text:
            turn(text)


if __name__ == "__main__":
    main()
