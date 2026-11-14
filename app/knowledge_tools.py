"""Read-only retrieval tools over hackathon.client_knowledge for the LangGraph advisor agent.

Built on LangChain's MongoDBAtlasVectorSearch over the existing `client_knowledge_vec` index
(Voyage voyage-3.5, same model the chunks were embedded with). Who may read what is decided
by the Session the host creates from the login, never by the LLM:

    session = Session(user_id="adv_daniel", role="advisor", client_ids={"C1", "C2"})
    tools = make_knowledge_tools(session)          # list of LangChain tools for the agent

Every vector query carries a pre-filter with the session's visibility, and client-scoped
tools refuse client_ids outside the session.
"""
from __future__ import annotations

import functools
import json
import os
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Callable, Optional

from langchain_core.embeddings import Embeddings
from langchain_core.tools import StructuredTool

# Which chunk visibilities each role may read (mirrors scripts.ingest_clientdata.ROLE_VISIBILITY).
ROLE_VISIBILITY = {
    "client": ["advisor"],
    "advisor": ["advisor"],
    "underwriter": ["advisor", "underwriter"],
}
INDEX_NAME = "client_knowledge_vec"
EMBED_MODEL = "voyage-3.5"
MAX_TEXT_CHARS = 1800


@dataclass(frozen=True)
class Session:
    user_id: str
    role: str
    client_ids: frozenset = field(default_factory=frozenset)  # clients this caller may see

    def __post_init__(self):
        if self.role not in ROLE_VISIBILITY:
            raise ValueError(f"unknown role {self.role!r}")
        object.__setattr__(self, "client_ids", frozenset(self.client_ids))

    @property
    def visibility(self) -> list[str]:
        return ROLE_VISIBILITY[self.role]


class AccessDenied(Exception):
    pass


def _parse_date(s: Optional[str]) -> Optional[datetime]:
    return datetime.strptime(s, "%Y-%m-%d") if s else None


class PatientEmbeddings(Embeddings):
    """Wraps an Embeddings model: one call at a time, waits and retries on rate limits,
    and caches query vectors. Needed while the Voyage key is on the free tier (3 requests/min),
    because the agent often runs several searches in parallel."""

    def __init__(self, inner, retries: int = 4, wait_seconds: int = 25):
        import threading
        self.inner, self.retries, self.wait = inner, retries, wait_seconds
        self._lock = threading.Lock()
        self._cache: dict[str, list[float]] = {}

    def _call(self, fn, arg):
        import time
        for attempt in range(self.retries + 1):
            try:
                with self._lock:
                    return fn(arg)
            except Exception as e:  # voyageai raises RateLimitError; match by name/message
                limited = "RateLimit" in type(e).__name__ or "rate limit" in str(e).lower()
                if not limited or attempt == self.retries:
                    raise
                time.sleep(self.wait)

    def embed_query(self, text: str) -> list[float]:
        if text not in self._cache:
            self._cache[text] = self._call(self.inner.embed_query, text)
        return self._cache[text]

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return self._call(self.inner.embed_documents, texts)


def default_vector_store():
    """MongoDBAtlasVectorSearch bound to the existing collection and index."""
    from langchain_mongodb import MongoDBAtlasVectorSearch
    from langchain_voyageai import VoyageAIEmbeddings

    from scripts.ingest_clientdata import get_collection

    key = os.environ.get("VOYAGE_API_KEY") or os.environ.get("MDB_MCP_VOYAGE_API_KEY")
    embeddings = PatientEmbeddings(VoyageAIEmbeddings(model=EMBED_MODEL, voyage_api_key=key, batch_size=32))
    coll = get_collection()
    store = MongoDBAtlasVectorSearch(collection=coll, embedding=embeddings, index_name=INDEX_NAME,
                                     text_key="text", embedding_key="embedding",
                                     relevance_score_fn="cosine")
    return store, coll


class KnowledgeBase:
    """Role-scoped retrieval. `vector_store` needs similarity_search_with_score(query, k, pre_filter)."""

    def __init__(self, session: Session, vector_store=None, collection=None):
        if vector_store is None or collection is None:
            vector_store, collection = default_vector_store()
        self.session = session
        self.vs = vector_store
        self.coll = collection

    # -- access control -----------------------------------------------------------------
    def _check_client(self, client_id: str) -> None:
        if client_id not in self.session.client_ids:
            raise AccessDenied(f"{self.session.user_id} ({self.session.role}) may not read client {client_id}")

    def _filter(self, **eq: Any) -> dict:
        flt: dict = {"visibility": {"$in": self.session.visibility}}
        for k, v in eq.items():
            if v is None:
                continue
            flt[k] = {"$in": list(v)} if isinstance(v, (list, tuple, set)) else v
        return flt

    # -- core search ----------------------------------------------------------------------
    def search(self, query: str, k: int = 5, since: Optional[str] = None, **eq: Any) -> list[dict]:
        flt = self._filter(**eq)
        if since:
            flt["date"] = {"$gte": _parse_date(since)}
        hits = self.vs.similarity_search_with_score(query, k=k, pre_filter=flt)
        return [_hit(doc, score) for doc, score in hits]

    def get_sections(self, client_id: str, doc_type: str, sections: list[str]) -> list[dict]:
        """Exact lookup of named sections (no embedding call), filtered by the role's visibility."""
        self._check_client(client_id)
        q = {"client_id": client_id, "doc_type": doc_type, "section": {"$in": sections},
             "visibility": {"$in": self.session.visibility}}
        docs = self.coll.find(q, {"_id": 0, "text": 1, "section": 1, "source_path": 1})
        return sorted(docs, key=lambda d: sections.index(d["section"]))

    # -- tool implementations -----------------------------------------------------------
    def get_client_profile(self, client_id: str, topic: str = "overview of the client", k: int = 4) -> list[dict]:
        self._check_client(client_id)
        return self.search(topic, k=k, client_id=client_id, doc_type="client_snapshot")

    def get_client_preferences(self, client_id: str, topic: str = "goals, risk tolerance and preferences",
                               k: int = 4) -> list[dict]:
        self._check_client(client_id)
        return self.search(topic, k=k, client_id=client_id, doc_type="goal_preference")

    def search_meeting_notes(self, client_id: str, query: str, since: Optional[str] = None,
                             k: int = 5) -> list[dict]:
        self._check_client(client_id)
        hits = self.search(query, k=k, since=since, client_id=client_id, doc_type="meeting_note")
        return sorted(hits, key=lambda h: h.get("date") or "", reverse=True)  # newest first

    def list_products(self, bank: Optional[str] = None, product: Optional[str] = None) -> list[dict]:
        q: dict = {"doc_type": "approval_policy", "status": "current"}
        if bank:
            q["bank"] = bank.upper()
        if product:
            q["product"] = product
        proj = {"_id": 0, "bank": 1, "product": 1, "policy_id": 1, "version": 1,
                "date": 1, "source_path": 1}
        return [_clean(d) for d in self.coll.find(q, proj).sort([("product", 1), ("bank", 1)])]

    def check_eligibility(self, client_id: str, product: str, bank: Optional[str] = None,
                          amount_cad: Optional[int] = None, purchase_price_cad: Optional[int] = None,
                          down_payment_cad: Optional[int] = None,
                          investable_assets_at_bank_cad: Optional[int] = None,
                          co_signer_available: Optional[bool] = None) -> list[dict]:
        """Deterministic check of a client against current policies (one bank, or all banks)."""
        from app.client_financials import COLLECTION as FIN
        from app.eligibility import evaluate

        self._check_client(client_id)
        fin = self.coll.database[FIN].find_one({"_id": client_id})
        if not fin:
            return [{"error": f"no financial profile for {client_id}"}]
        q: dict = {"doc_type": "approval_policy", "status": "current", "product": product}
        if bank:
            q["bank"] = bank.upper()
        policies = list(self.coll.find(q, {"embedding": 0, "text": 0}).sort("bank", 1))
        if not policies:
            return [{"error": f"no current policy for product={product} bank={bank}",
                     "available": self.list_products()}]
        request = {k: v for k, v in (("amount_cad", amount_cad), ("purchase_price_cad", purchase_price_cad),
                                     ("down_payment_cad", down_payment_cad),
                                     ("investable_assets_at_bank_cad", investable_assets_at_bank_cad))
                   if v is not None}
        results = []
        for p in policies:
            r = evaluate(fin, p, request, co_signer_available=co_signer_available)
            r["source_path"] = p.get("source_path")
            results.append(r)
        return results

    def get_approval_policy(self, bank: str, product: str) -> dict:
        d = self.coll.find_one({"doc_type": "approval_policy", "status": "current",
                                "bank": bank.upper(), "product": product},
                               {"_id": 0, "embedding": 0})
        if not d:
            return {"error": f"no current {product} policy for {bank}",
                    "available": self.list_products()}
        return _clean({"bank": d["bank"], "product": d["product"], "policy_id": d.get("policy_id"),
                       "version": d.get("version"), "effective_date": d.get("date"),
                       "decision_rules": d.get("policy"), "source_path": d.get("source_path"),
                       "text": d.get("text", "")[:MAX_TEXT_CHARS]})


# --------------------------------------------------------------------------- formatting

def _clean(d: dict) -> dict:
    return {k: (v.strftime("%Y-%m-%d") if isinstance(v, datetime) else v) for k, v in d.items()}


def _hit(doc, score: float) -> dict:
    m = doc.metadata
    out = {"score": round(float(score), 3), "source_path": m.get("source_path"),
           "doc_type": m.get("doc_type"), "client_id": m.get("client_id"),
           "section": m.get("section"), "section_title": m.get("section_title"),
           "date": str(m["date"])[:10] if m.get("date") else None,
           "text": doc.page_content[:MAX_TEXT_CHARS]}
    return _clean({k: v for k, v in out.items() if v is not None})


def _as_tool(fn: Callable, name: str, description: str) -> StructuredTool:
    """Wrap a KnowledgeBase method as a LangChain tool that returns JSON text.

    functools.wraps copies the method's signature and annotations, so LangChain infers the
    argument schema from it. Access denials come back as data instead of exceptions.
    """
    @functools.wraps(fn)
    def run(*args, **kwargs):
        try:
            return json.dumps(fn(*args, **kwargs), default=str, ensure_ascii=False)
        except AccessDenied as e:
            return json.dumps({"error": "access_denied", "detail": str(e)})
    return StructuredTool.from_function(func=run, name=name, description=description)


def make_knowledge_tools(session: Session, kb: Optional[KnowledgeBase] = None) -> list[StructuredTool]:
    kb = kb or KnowledgeBase(session)
    return [
        _as_tool(kb.get_client_profile, "get_client_profile",
                 "Facts about a client from their profile snapshot: identity, income, credit band, "
                 "liabilities, assets, and the bank's product checks (6a credit card, 6b line of credit, "
                 "6c mortgage). Use `topic` to aim the search, e.g. 'line of credit check'."),
        _as_tool(kb.get_client_preferences, "get_client_preferences",
                 "A client's goals by time horizon, risk profile, investment policy, credit and borrowing "
                 "preferences, tax/account preferences and constraints. Use before recommending anything."),
        _as_tool(kb.search_meeting_notes, "search_meeting_notes",
                 "Search a client's advisor meeting notes (2021-12 to 2026-11); results are newest first. "
                 "Use `since` (YYYY-MM-DD) for recent history, e.g. open action items or what changed."),
        _as_tool(kb.list_products, "list_products",
                 "List current bank products with an approval policy. Optional filters: bank (TD, RBC, CIBC), "
                 "product (mortgage, personal_line_of_credit, business_credit_card)."),
        _as_tool(kb.get_approval_policy, "get_approval_policy",
                 "Exact approval rules for one bank product: machine-readable decision_rules "
                 "(min_credit_score, max_gds, max_tds, min_down_payment_pct, auto_decline_if, ...) plus the "
                 "policy text. Use these numbers, not memory, when judging eligibility."),
        _as_tool(kb.check_eligibility, "check_eligibility",
                 "Run the bank's approval rules against the client's verified financials and return "
                 "APPROVE / APPROVE_REDUCED / REFER / DECLINE / NOT_APPLICABLE with every check, the "
                 "figures (GDS, TDS, stress payment) and any limit offers. Omit `bank` to compare TD, "
                 "RBC and CIBC. product: mortgage | personal_line_of_credit | business_credit_card. "
                 "Optional what-ifs: amount_cad, purchase_price_cad, down_payment_cad, "
                 "investable_assets_at_bank_cad. Set co_signer_available from what you remember about "
                 "the client (false if they said the co-signer is no longer available). Always use this "
                 "instead of doing the math yourself; exact credit scores are never returned."),
    ]
