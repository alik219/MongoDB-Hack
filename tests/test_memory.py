"""Governed memory rules (app/memory.py): who reads, how long, correction, forgetting, audit."""
import json
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import mongomock
import pytest

from app.audit import verify_chain
from app.knowledge_tools import AccessDenied, Session
from app.memory import MemoryRejected, MemoryService, make_memory_tools


@dataclass
class Item:
    key: str
    value: dict
    score: float = None


class FakeStore:
    """Mimics MongoDBStore semantics we rely on: namespaces, equality filters where an array
    field matches if it contains the value, get/put/delete. Query text is ignored."""
    def __init__(self):
        self.data = {}

    def put(self, ns, key, value):
        self.data[(ns, key)] = dict(value)

    def get(self, ns, key):
        v = self.data.get((ns, key))
        return Item(key, v) if v is not None else None

    def delete(self, ns, key):
        self.data.pop((ns, key), None)

    def search(self, prefix, query=None, filter=None, limit=10):
        def match(v):
            for k, want in (filter or {}).items():
                have = v.get(k)
                if not (want in have if isinstance(have, list) else have == want):
                    return False
            return True
        out = [Item(k, v, 0.9 if query else None) for (ns, k), v in self.data.items()
               if ns[:len(prefix)] == prefix and match(v)]
        return out[:limit]


@pytest.fixture
def env():
    db = mongomock.MongoClient().hackathon
    store = FakeStore()
    mk = lambda user, role, clients=("C1",): MemoryService(Session(user, role, set(clients)), store, db)
    return mk, store, db


SRC = {"type": "conversation", "thread_id": "adv:C1:t1"}


def test_remember_and_read_back_with_expiry_by_kind(env):
    mk, _, _ = env
    adv = mk("adv", "advisor")
    m = adv.remember("C1", "Mother can no longer co-sign loans (said 2026-11)", "fact", SRC)
    fact = adv.active("C1")[0]
    assert fact["memory_id"] == m["memory_id"] and fact["confirmed"] is False
    days = (datetime.fromisoformat(m["expires"]) - datetime.now()).days
    assert 88 <= days <= 90                                    # unconfirmed: 90 days
    assert adv.remember("C1", "Prefers no unsecured debt", "preference", SRC,
                        confirmed=True)["expires"] == "until corrected or forgotten"
    note = adv.remember("C1", "Comparing secured card vs limit increase today", "session_note", SRC)
    assert (datetime.fromisoformat(note["expires"]).date() - datetime.now().date()).days <= 1


def test_readers_and_client_scope(env):
    mk, _, db = env
    uw = mk("uw", "underwriter")
    uw.remember("C1", "Co-signer income needs verification", "fact", SRC, readers=["underwriter"])
    adv = mk("adv", "advisor")
    assert adv.active("C1") == []                              # underwriter-only memory hidden
    assert len(uw.active("C1")) == 1
    with pytest.raises(AccessDenied):
        adv.remember("C2", "anything", "fact", SRC)
    with pytest.raises(AccessDenied):
        adv.active("C2")
    assert db.audit_log.count_documents({"event": "memory_denied"}) == 2


@pytest.mark.parametrize("content,kind,source", [
    ("SIN is 046 454 286", "fact", SRC),
    ("Her credit score is 662 now", "fact", SRC),
    ("Online banking password is hunter2", "fact", SRC),
    ("Likes TD", "gossip", SRC),
    ("Likes TD", "fact", None),
    ("x" * 600, "fact", SRC),
])
def test_gate_rejects_and_audits(env, content, kind, source):
    mk, store, db = env
    with pytest.raises(MemoryRejected):
        mk("adv", "advisor").remember("C1", content, kind, source)
    assert store.data == {}
    rej = db.audit_log.find_one({"event": "memory_rejected"})
    assert rej and content not in json.dumps(rej, default=str)   # rejected content is not logged


def test_client_cannot_record_advice(env):
    mk, _, _ = env
    with pytest.raises(MemoryRejected):
        mk("c1_maya", "client").remember("C1", "Advised to take a LOC", "advice_given", SRC)


def test_correction_supersedes_instead_of_overwriting(env):
    mk, store, db = env
    adv = mk("adv", "advisor")
    old = adv.remember("C1", "Mother can no longer co-sign loans", "fact", SRC)
    new = adv.correct("C1", old["memory_id"], "Mother can co-sign again (said 2026-12)", reason="client update")
    active = adv.active("C1")
    assert [m["memory_id"] for m in active] == [new["memory_id"]]
    assert active[0]["supersedes"] == old["memory_id"] and active[0]["confirmed"] is True
    kept = store.get(("client", "C1", "memories"), old["memory_id"]).value
    assert kept["status"] == "superseded" and kept["superseded_by"] == new["memory_id"]
    assert db.audit_log.count_documents({"event": "memory_correct"}) == 1


def test_forget_erases_all_versions_and_logs_only_a_hash(env):
    mk, store, db = env
    adv = mk("adv", "advisor")
    old = adv.remember("C1", "Mother can no longer co-sign loans", "fact", SRC)
    new = adv.correct("C1", old["memory_id"], "Mother can co-sign again", reason="update")
    out = adv.forget("C1", new["memory_id"], reason="client request under privacy policy")
    assert set(out["forgotten"]) == {old["memory_id"], new["memory_id"]}
    assert store.data == {}
    log = json.dumps(list(db.audit_log.find({}, {"_id": 0})), default=str)
    assert "co-sign" not in log                                   # no content anywhere in the audit log
    assert db.audit_log.count_documents({"event": "memory_forget"}) == 1


def test_advice_records_cannot_be_forgotten(env):
    mk, store, _ = env
    adv = mk("adv", "advisor")
    rec = adv.remember("C1", "Advised against a LOC; suggested card limit increase", "advice_given", SRC)
    with pytest.raises(MemoryRejected):
        adv.forget("C1", rec["memory_id"], reason="client request")
    assert len(store.data) == 1


def test_expired_memory_is_hidden_before_ttl_sweep(env):
    mk, store, _ = env
    adv = mk("adv", "advisor")
    m = adv.remember("C1", "Temporary note", "session_note", SRC)
    store.data[(("client", "C1", "memories"), m["memory_id"])]["expires_at"] = \
        datetime.now(timezone.utc) - timedelta(minutes=1)
    assert adv.active("C1") == []


def test_audit_chain_is_intact(env):
    mk, _, db = env
    adv = mk("adv", "advisor")
    m = adv.remember("C1", "Prefers emails over calls", "preference", SRC)
    adv.recall("C1", "contact preference")
    adv.forget("C1", m["memory_id"], reason="test")
    events = [e["event"] for e in db.audit_log.find().sort("seq", 1)]
    assert events == ["memory_write", "memory_read", "memory_forget"]
    assert verify_chain(db) == (True, None)


def test_tools_bind_client_and_record_conversation(env):
    mk, store, _ = env
    tools = {t.name: t for t in make_memory_tools(mk("adv", "advisor"), "C1")}
    out = json.loads(tools["remember"].invoke(
        {"content": "Mother can no longer co-sign", "kind": "fact"},
        config={"configurable": {"thread_id": "adv:C1:conv9"}}))
    saved = store.get(("client", "C1", "memories"), out["memory_id"]).value
    assert saved["source"] == {"type": "conversation", "thread_id": "adv:C1:conv9"}
    bad = json.loads(tools["remember"].invoke({"content": "score 700", "kind": "fact"}))
    assert bad["error"] == "MemoryRejected"
