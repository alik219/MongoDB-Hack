"""Access control and filters for app/knowledge_tools.py (offline: fake vector store + mongomock)."""
import json
from datetime import datetime

import mongomock
import pytest

from app.knowledge_tools import KnowledgeBase, Session, make_knowledge_tools


class FakeVectorStore:
    def __init__(self):
        self.calls = []

    def similarity_search_with_score(self, query, k, pre_filter):
        self.calls.append(pre_filter)
        return []


@pytest.fixture
def coll():
    c = mongomock.MongoClient().db.client_knowledge
    c.insert_many([
        {"doc_type": "approval_policy", "status": "current", "bank": "TD", "product": "mortgage",
         "policy_id": "TD-MORTGAGE-2026-09", "version": "4.0", "date": datetime(2026, 9, 1),
         "policy": {"min_credit_score": 660}, "text": "TD mortgage", "source_path": "p/td.md",
         "embedding": [0.1]},
        {"doc_type": "approval_policy", "status": "current", "bank": "RBC", "product": "mortgage",
         "policy_id": "RBC-MORTGAGE-2026-09", "version": "4.0", "date": datetime(2026, 9, 1),
         "policy": {"min_credit_score": 700}, "text": "RBC mortgage", "source_path": "p/rbc.md"},
    ])
    return c


def tools_for(session, coll):
    vs = FakeVectorStore()
    kb = KnowledgeBase(session, vs, coll)
    return {t.name: t for t in make_knowledge_tools(session, kb)}, vs


def test_advisor_cannot_read_other_clients(coll):
    tools, vs = tools_for(Session("adv", "advisor", {"C1"}), coll)
    out = json.loads(tools["get_client_profile"].invoke({"client_id": "C2"}))
    assert out["error"] == "access_denied"
    assert vs.calls == []  # never reached the database


def test_visibility_filter_follows_role(coll):
    for role, vis in (("advisor", ["advisor"]), ("client", ["advisor"]),
                      ("underwriter", ["advisor", "underwriter"])):
        tools, vs = tools_for(Session("u", role, {"C1"}), coll)
        tools["get_client_profile"].invoke({"client_id": "C1"})
        assert vs.calls[-1]["visibility"] == {"$in": vis}
        assert vs.calls[-1]["client_id"] == "C1"
        assert vs.calls[-1]["doc_type"] == "client_snapshot"


def test_meeting_notes_since_filter(coll):
    tools, vs = tools_for(Session("adv", "advisor", {"C1"}), coll)
    tools["search_meeting_notes"].invoke({"client_id": "C1", "query": "actions", "since": "2026-01-01"})
    assert vs.calls[-1]["date"] == {"$gte": datetime(2026, 1, 1)}


def test_policy_lookup_is_exact(coll):
    tools, _ = tools_for(Session("adv", "advisor", {"C1"}), coll)
    pol = json.loads(tools["get_approval_policy"].invoke({"bank": "td", "product": "mortgage"}))
    assert pol["decision_rules"] == {"min_credit_score": 660}
    assert pol["effective_date"] == "2026-09-01"
    assert "embedding" not in pol
    listed = json.loads(tools["list_products"].invoke({"product": "mortgage"}))
    assert [p["bank"] for p in listed] == ["RBC", "TD"]
    missing = json.loads(tools["get_approval_policy"].invoke({"bank": "BMO", "product": "mortgage"}))
    assert "error" in missing


def test_unknown_role_rejected():
    with pytest.raises(ValueError):
        Session("x", "admin", {"C1"})


def test_check_eligibility_tool_reads_mongo_and_enforces_access(coll):
    from app.client_financials import seed_client_financials
    seed_client_financials(coll.database)
    tools, _ = tools_for(Session("adv", "advisor", {"C2"}), coll)
    out = json.loads(tools["check_eligibility"].invoke({"client_id": "C2", "product": "mortgage"}))
    assert [r["bank"] for r in out] == ["RBC", "TD"]          # both seeded policies compared
    assert all("decision" in r and r["source_path"] for r in out)
    assert "812" not in json.dumps(out)
    denied = json.loads(tools["check_eligibility"].invoke({"client_id": "C1", "product": "mortgage"}))
    assert denied["error"] == "access_denied"
