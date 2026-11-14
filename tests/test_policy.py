"""Policy + gate tests against mongomock (no Atlas, no LLM).  Run: pytest -q"""
import mongomock
import pytest

from app import audit, gate, seed


@pytest.fixture
def db(monkeypatch):
    client = mongomock.MongoClient()
    d = client["test"]
    monkeypatch.setattr(seed, "get_db", lambda: d)
    monkeypatch.setattr(seed, "init_collections", lambda db=None: None)
    seed.main()
    return d


def run(db, user="alice"):
    return gate.start_run(db, user, "test")


def test_owner_can_read(db):
    out = gate.execute(db, run(db), "get_account_summary", {"account_id": "acc_alice_chq"})
    assert out["balance"] == 8400


def test_cannot_read_other_users_account(db):
    out = gate.execute(db, run(db), "get_account_summary", {"account_id": "acc_bob_chq"})
    assert out["status"] == "denied" and "P-OWN-01" in out["reasons"][0]


def test_list_is_scoped(db):
    ids = {a["account_id"] for a in gate.execute(db, run(db), "list_my_accounts", {})}
    assert "acc_bob_chq" not in ids and "acc_joint_sav" in ids


def test_injected_transfer_blocked_and_audited(db):
    ctx = run(db)
    out = gate.execute(db, ctx, "transfer",
                       {"from_account_id": "acc_bob_chq", "to_account_id": "acc_alice_chq", "amount": 500})
    assert out["status"] == "denied"
    assert db.accounts.find_one({"_id": "acc_bob_chq"})["balance_cents"] == 6_300_000
    e = db.audit_log.find_one({"run_id": ctx.run_id, "event": "decision"})
    assert e["decision"] == "DENY" and e["policies"][0]["id"] == "P-OWN-01"


def test_tfsa_contribution_updates_room(db):
    ctx = run(db)
    out = gate.execute(db, ctx, "transfer",
                       {"from_account_id": "acc_alice_chq", "to_account_id": "acc_alice_tfsa", "amount": 2000})
    assert out["status"] == "completed"
    room = gate.execute(db, ctx, "get_contribution_room", {"account_type": "TFSA"})
    assert room["room_remaining"] == 7500


def test_tfsa_overcontribution_denied(db):
    out = gate.execute(db, run(db), "transfer",
                       {"from_account_id": "acc_alice_sav", "to_account_id": "acc_alice_tfsa", "amount": 10000})
    assert out["status"] == "denied" and "P-TFSA-01" in out["reasons"][0]


def test_registered_withdrawal_denied(db):
    out = gate.execute(db, run(db), "transfer",
                       {"from_account_id": "acc_alice_tfsa", "to_account_id": "acc_alice_chq", "amount": 100})
    assert out["status"] == "denied"


def test_large_transfer_needs_approval_then_succeeds(db):
    ctx = run(db)
    args = {"from_account_id": "acc_alice_sav", "to_account_id": "acc_alice_chq", "amount": 15000}
    out = gate.execute(db, ctx, "transfer", args)
    assert out["status"] == "pending_approval"
    db.approvals.update_one({"_id": out["approval_id"]}, {"$set": {"status": "approved"}})
    out2 = gate.execute(db, ctx, "transfer", {**args, "approval_id": out["approval_id"]})
    assert out2["status"] == "completed"
    # approval is single-use
    out3 = gate.execute(db, ctx, "transfer", {**args, "approval_id": out["approval_id"]})
    assert out3["status"] == "pending_approval"


def test_mortgage_min_down(db):
    out = gate.execute(db, run(db), "mortgage_prequalify",
                       {"purchase_price": 750000, "down_payment": 40000, "contract_rate_pct": 4.5})
    assert out["status"] == "denied" and "P-MORT-01" in out["reasons"][0]


def test_mortgage_co_applicant_needs_consent(db):
    out = gate.execute(db, run(db), "mortgage_prequalify",
                       {"purchase_price": 450000, "down_payment": 45000, "contract_rate_pct": 4.5,
                        "co_applicant_id": "bob"})
    assert out["status"] == "denied" and "P-OWN-02" in out["reasons"][0]


def test_kill_switch(db):
    ctx = run(db)
    db.agent_runs.update_one({"_id": ctx.run_id}, {"$set": {"status": "halted"}})
    with pytest.raises(gate.Halted):
        gate.execute(db, ctx, "list_my_accounts", {})


def test_hash_chain_detects_tampering(db):
    ctx = run(db)
    gate.execute(db, ctx, "list_my_accounts", {})
    assert audit.verify_chain(db) == (True, None)
    db.audit_log.update_one({"seq": 2}, {"$set": {"user_id": "mallory"}})
    ok, bad = audit.verify_chain(db)
    assert not ok and bad == 2
