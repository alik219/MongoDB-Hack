"""Governed long-term memory for the advisor agent (Track 2: Memory You Can Govern).

Built on LangGraph's MongoDBStore (`hackathon.agent_memory`, vector index `agent_memory_vec`)
with the adjustments proven in docs/MEMORY_AGENT_PLAN.md §6:

* Who can read  — one namespace per client ("client", <id>, "memories") + a `readers` array
                  filtered by the caller's role (the store only supports equality filters).
* How long      — our own TTL index on `value.expires_at`; lifetime is set per kind.
* Correction    — never overwrite: a new memory `supersedes` the old one, which becomes
                  `superseded`; reads only return `status: active`.
* Forgetting    — delete the document (its embedding goes with it); compliance records
                  (`advice_given`) cannot be forgotten, only by a retention expiry.
* Accountability — every write, rejection, read, correction and erasure goes to the
                  hash-chained `audit_log` (app/audit.py). Erasures log a hash, not content.

The Session (user, role, allowed clients) comes from the login, never from the LLM.
"""
from __future__ import annotations

import hashlib
import os
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from langchain_core.runnables import RunnableConfig  # module-level: tool schemas resolve it by name

from app import audit
from app.knowledge_tools import AccessDenied, Session

COLLECTION = "agent_memory"
INDEX_NAME = "agent_memory_vec"
EMBED_MODEL = "voyage-3.5"
DAY = timedelta(days=1)

# kind -> (lifetime if unconfirmed, lifetime if confirmed, may be forgotten?)
# None lifetime = kept until corrected or forgotten.
RETENTION = {
    "preference":   (timedelta(days=90), None, True),        # "prefers no unsecured debt"
    "fact":         (timedelta(days=90), None, True),        # "co-signer no longer available"
    "constraint":   (timedelta(days=90), None, True),        # "can't take on payments before May"
    "session_note": (DAY, DAY, True),                        # working note for today only
    "advice_given": (timedelta(days=7 * 365),) * 2 + (False,),  # compliance record: 7 years
}
WRITER_ROLES = {"advisor", "underwriter", "client"}
ALL_READERS = ["client", "advisor", "underwriter"]
MAX_CONTENT_CHARS = 500


class MemoryRejected(Exception):
    pass


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _hash(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()[:16]


def check_content(content: str) -> str:
    """Governance gate for what may be stored. Returns cleaned content or raises."""
    from scripts.ingest_clientdata import redact

    content = " ".join((content or "").split())
    if not content:
        raise MemoryRejected("empty memory")
    if len(content) > MAX_CONTENT_CHARS:
        raise MemoryRejected(f"memory too long ({len(content)} > {MAX_CONTENT_CHARS} chars); store one fact")
    if re.search(r"\b\d{3}[- ]?\d{3}[- ]?\d{3}\b", content):
        raise MemoryRejected("looks like a SIN or account number; never store identifiers")
    if re.search(r"(?i)\b(credit\s*)?score\b\D{0,15}\b[3-8]\d{2}\b", content):
        raise MemoryRejected("exact credit score; store the band only")
    if re.search(r"(?i)\b(password|pin|cvv)\b", content):
        raise MemoryRejected("credentials must never be stored")
    return redact(content)


class MemoryService:
    def __init__(self, session: Session, store=None, db=None, run_id: Optional[str] = None):
        if store is None or db is None:
            store, db = default_store()
        self.session, self.store, self.db = session, store, db
        self.run_id = run_id or f"mem-{uuid.uuid4().hex[:8]}"

    # -- helpers ------------------------------------------------------------------------
    @staticmethod
    def ns(client_id: str) -> tuple[str, str, str]:
        return ("client", client_id, "memories")

    def _audit(self, event: str, client_id: str, **kw) -> None:
        # Dates as ISO text: BSON drops the timezone on read, which would break the hash chain.
        args = {k: (v.isoformat() if isinstance(v, datetime) else v) for k, v in kw.pop("args", {}).items()}
        audit.record(self.db, run_id=self.run_id, user_id=self.session.user_id, event=event,
                     args={"client_id": client_id, "role": self.session.role, **args}, **kw)

    def _check_client(self, client_id: str, action: str) -> None:
        if client_id not in self.session.client_ids:
            self._audit("memory_denied", client_id, reasons=[f"{action}: client not in session scope"])
            raise AccessDenied(f"{self.session.user_id} ({self.session.role}) may not {action} memories of {client_id}")

    def _visible(self, value: dict) -> bool:
        exp = value.get("expires_at")
        if exp is not None and exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        return (value.get("status") == "active" and self.session.role in value.get("readers", [])
                and (exp is None or exp > _now()))

    @staticmethod
    def _view(item) -> dict:
        v = item.value
        exp = v.get("expires_at")
        return {"memory_id": item.key, "kind": v["kind"], "content": v["content"],
                "confirmed": v.get("confirmed", False), "source": v.get("source"),
                "created_by": v.get("created_by"), "created_at": str(v.get("created_at"))[:10],
                "expires": str(exp)[:10] if exp else "until corrected or forgotten",
                **({"supersedes": v["supersedes"]} if v.get("supersedes") else {}),
                **({"score": round(item.score, 3)} if getattr(item, "score", None) is not None else {})}

    def _expiry(self, kind: str, confirmed: bool) -> Optional[datetime]:
        life = RETENTION[kind][1 if confirmed else 0]
        return _now() + life if life else None

    # -- write ----------------------------------------------------------------------------
    def remember(self, client_id: str, content: str, kind: str, source: dict,
                 confirmed: bool = False, readers: Optional[list[str]] = None,
                 supersedes: Optional[str] = None) -> dict:
        self._check_client(client_id, "write")
        try:
            if self.session.role not in WRITER_ROLES:
                raise MemoryRejected(f"role {self.session.role} may not write memories")
            if kind not in RETENTION:
                raise MemoryRejected(f"unknown kind {kind!r}; use one of {sorted(RETENTION)}")
            if not source or not source.get("type"):
                raise MemoryRejected("every memory needs a source")
            readers = readers or list(ALL_READERS)
            if not set(readers) <= set(ALL_READERS):
                raise MemoryRejected(f"readers must be within {ALL_READERS}")
            if self.session.role not in readers:
                raise MemoryRejected("you can't write a memory you can't read")
            if self.session.role == "client" and kind == "advice_given":
                raise MemoryRejected("clients cannot record advice")
            clean = check_content(content)
        except MemoryRejected as e:
            self._audit("memory_rejected", client_id, reasons=[str(e)],
                        args={"kind": kind, "content_hash": _hash(content or "")})
            raise
        key = f"mem_{uuid.uuid4().hex[:10]}"
        value = {"content": clean, "client_id": client_id, "kind": kind, "status": "active",
                 "readers": readers, "confirmed": confirmed, "source": source,
                 "created_by": self.session.user_id, "created_at": _now(),
                 "expires_at": self._expiry(kind, confirmed), "supersedes": supersedes}
        self.store.put(self.ns(client_id), key, value)
        self._audit("memory_write", client_id, tool="remember",
                    args={"memory_id": key, "kind": kind, "confirmed": confirmed,
                          "expires_at": value["expires_at"], "content_hash": _hash(clean),
                          "supersedes": supersedes}, result={"status": "stored"})
        return {"memory_id": key, "stored": clean, "expires": str(value["expires_at"])[:10] if value["expires_at"] else "until corrected or forgotten"}

    # -- read -----------------------------------------------------------------------------
    def active(self, client_id: str, limit: int = 20) -> list[dict]:
        """All active memories this role may read (exact filter; no embedding call)."""
        self._check_client(client_id, "read")
        items = self.store.search(self.ns(client_id), filter={"status": "active",
                                                              "readers": self.session.role}, limit=limit)
        out = [self._view(i) for i in items if self._visible(i.value)]
        self._audit("memory_read", client_id, args={"mode": "list", "memory_ids": [m["memory_id"] for m in out]})
        return out

    def recall(self, client_id: str, query: str, k: int = 5) -> list[dict]:
        """Semantic search over this client's active memories the role may read."""
        self._check_client(client_id, "read")
        items = self.store.search(self.ns(client_id), query=query, limit=k,
                                  filter={"status": "active", "readers": self.session.role})
        out = [self._view(i) for i in items if self._visible(i.value)]
        self._audit("memory_read", client_id, args={"mode": "search", "query_hash": _hash(query),
                                                     "memory_ids": [m["memory_id"] for m in out]})
        return out

    def _get(self, client_id: str, memory_id: str):
        item = self.store.get(self.ns(client_id), memory_id)
        if item is None or not self._visible(item.value):
            raise MemoryRejected(f"no active memory {memory_id} visible to you")
        return item

    # -- correct / forget -------------------------------------------------------------------
    def correct(self, client_id: str, memory_id: str, new_content: str, reason: str,
                confirmed: bool = True) -> dict:
        self._check_client(client_id, "correct")
        old = self._get(client_id, memory_id)
        if not reason:
            raise MemoryRejected("a correction needs a reason")
        new = self.remember(client_id, new_content, old.value["kind"],
                            source={"type": "correction", "of": memory_id, "reason": reason},
                            confirmed=confirmed, readers=old.value["readers"], supersedes=memory_id)
        self.store.put(self.ns(client_id), memory_id,
                       {**old.value, "status": "superseded", "superseded_by": new["memory_id"],
                        "superseded_at": _now()})
        self._audit("memory_correct", client_id, tool="correct_memory",
                    args={"memory_id": memory_id, "superseded_by": new["memory_id"]}, reasons=[reason])
        return {"superseded": memory_id, **new}

    def forget(self, client_id: str, memory_id: str, reason: str) -> dict:
        self._check_client(client_id, "forget")
        item = self._get(client_id, memory_id)
        if not reason:
            raise MemoryRejected("forgetting needs a reason")
        if not RETENTION[item.value["kind"]][2]:
            self._audit("memory_rejected", client_id, reasons=["compliance record cannot be forgotten"],
                        args={"memory_id": memory_id})
            raise MemoryRejected("advice records are kept for compliance (7 years) and cannot be forgotten")
        # Erase the memory and every earlier version it replaced.
        chain, cur = [], item
        while cur is not None:
            chain.append(cur.key)
            prev = cur.value.get("supersedes")
            cur = self.store.get(self.ns(client_id), prev) if prev else None
        for key in chain:
            self.store.delete(self.ns(client_id), key)
        self._audit("memory_forget", client_id, tool="forget_memory", reasons=[reason],
                    args={"memory_ids": chain, "content_hash": _hash(item.value["content"])})
        return {"forgotten": chain}


# --------------------------------------------------------------------------- agent tools

def make_memory_tools(svc: MemoryService, client_id: str) -> list:
    """LangChain tools bound to this conversation's client (the LLM can't pick another)."""
    import json

    from langchain_core.tools import StructuredTool

    def _run(fn):
        try:
            return json.dumps(fn(), default=str, ensure_ascii=False)
        except (MemoryRejected, AccessDenied) as e:
            return json.dumps({"error": type(e).__name__, "detail": str(e)})

    def remember(content: str, kind: str, confirmed_by_client: bool = False,
                 config: RunnableConfig = None) -> str:
        thread = ((config or {}).get("configurable") or {}).get("thread_id")
        return _run(lambda: svc.remember(client_id, content, kind,
                                         source={"type": "conversation", "thread_id": thread},
                                         confirmed=confirmed_by_client))

    def recall_memories(query: str) -> str:
        return _run(lambda: svc.recall(client_id, query))

    def correct_memory(memory_id: str, new_content: str, reason: str) -> str:
        return _run(lambda: svc.correct(client_id, memory_id, new_content, reason))

    def forget_memory(memory_id: str, reason: str) -> str:
        return _run(lambda: svc.forget(client_id, memory_id, reason))

    return [
        StructuredTool.from_function(remember, name="remember",
            description="Save ONE durable fact about this client that should change future advice, "
                        "e.g. 'Mother can no longer co-sign loans (said 2026-11)'. kind: preference | fact | "
                        "constraint | session_note | advice_given. Set confirmed_by_client=true only if the "
                        "client/advisor stated it directly; unconfirmed memories expire in 90 days. Never "
                        "store identifiers, exact credit scores or anything already in the client files."),
        StructuredTool.from_function(recall_memories, name="recall_memories",
            description="Semantic search of what we remember about this client (active memories only)."),
        StructuredTool.from_function(correct_memory, name="correct_memory",
            description="Replace a remembered fact that is now wrong. The old memory is kept as "
                        "'superseded' for the audit trail. Needs the memory_id and a reason."),
        StructuredTool.from_function(forget_memory, name="forget_memory",
            description="Erase a memory (and its earlier versions) when the client asks us to forget it. "
                        "Needs a reason. Advice records cannot be forgotten."),
    ]


# --------------------------------------------------------------------------- Atlas store

def default_store():
    """MongoDBStore on hackathon.agent_memory with vector search + per-memory TTL."""
    from langchain_voyageai import VoyageAIEmbeddings
    from langgraph.store.mongodb import MongoDBStore, create_vector_index_config

    from app.knowledge_tools import PatientEmbeddings
    from scripts.ingest_clientdata import get_collection

    db = get_collection().database
    key = os.environ.get("VOYAGE_API_KEY") or os.environ.get("MDB_MCP_VOYAGE_API_KEY")
    emb = PatientEmbeddings(VoyageAIEmbeddings(model=EMBED_MODEL, voyage_api_key=key))
    cfg = create_vector_index_config(dims=1024, embed=emb, fields=["content"], name=INDEX_NAME,
                                     filters=["status", "readers", "kind", "client_id"])
    store = MongoDBStore(db[COLLECTION], index_config=cfg, auto_index_timeout=180)
    db[COLLECTION].create_index("value.expires_at", expireAfterSeconds=0, name="memory_expires_at_ttl")
    return store, db
