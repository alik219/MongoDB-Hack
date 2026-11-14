"""Reviewer / compliance CLI.

  python -m app.review watch                 # live change stream of audit_log
  python -m app.review runs                  # recent runs
  python -m app.review replay <run_id>       # reconstruct a run step by step
  python -m app.review verify                # check the hash chain
  python -m app.review denied [user_id]      # every blocked action
  python -m app.review approvals             # pending approvals
  python -m app.review approve <approval_id> [--reviewer name]
  python -m app.review halt <run_id>         # kill switch
  python -m app.review rollback <run_id>     # post compensating ledger entries
"""
import argparse
from datetime import datetime, timezone

from . import audit
from .db import get_db, txn


def _fmt(e):
    pol = ",".join(p["id"] for p in e.get("policies") or [])
    line = f"#{e['seq']:<4} {e['ts'][11:19]} {e['user_id']:<6} {e['event']:<9}"
    if e.get("tool") and e["event"] == "result":
        line += f" {e['tool']} -> {str(e.get('result'))[:120]}"
    elif e.get("tool"):
        line += f" {e['tool']}({e.get('args')})"
    if e.get("decision"):
        line += f" => {e['decision']} [{pol}]"
    if e.get("model_reason"):
        line += f"\n        why: {e['model_reason']}"
    for r in e.get("reasons") or []:
        line += f"\n        - {r}"
    return line


def watch(db):
    print("Watching audit_log (change stream)…")
    with db.audit_log.watch([{"$match": {"operationType": "insert"}}]) as stream:
        for ch in stream:
            print(_fmt(ch["fullDocument"]))


def runs(db):
    for r in db.agent_runs.find().sort("started", -1).limit(20):
        print(f"{r['_id']}  {r['user_id']:<6} {r['status']:<10} {r['prompt'][:60]}")


def replay(db, run_id):
    for e in db.audit_log.find({"run_id": run_id}).sort("seq", 1):
        print(_fmt(e))


def denied(db, user_id=None):
    q = {"event": "decision", "decision": "DENY"}
    if user_id:
        q["user_id"] = user_id
    for e in db.audit_log.find(q).sort("seq", 1):
        print(_fmt(e))


def approvals(db):
    for a in db.approvals.find({"status": "pending"}):
        print(f"{a['_id']}  {a['user_id']}  {a['tool']} {a['args']}  {a['reasons']}")


def approve(db, approval_id, reviewer):
    a = db.approvals.find_one_and_update({"_id": approval_id, "status": "pending"},
                                         {"$set": {"status": "approved", "reviewer": reviewer}})
    if not a:
        print("No pending approval with that id.")
        return
    audit.record(db, run_id=a["run_id"], user_id=a["user_id"], event="approval",
                 args={"approval_id": approval_id, "reviewer": reviewer})
    print(f"Approved {approval_id}. The user can now tell the agent to proceed.")


def halt(db, run_id):
    r = db.agent_runs.find_one_and_update({"_id": run_id, "status": "running"},
                                          {"$set": {"status": "halted"}})
    if not r:
        print("Run not found or not running.")
        return
    audit.record(db, run_id=run_id, user_id=r["user_id"], event="halt", reasons=["halted by reviewer"])
    print(f"Halted {run_id}. The agent stops before its next tool call.")


def rollback(db, run_id):
    rows = list(db.ledger.find({"run_id": run_id, "reversal_of": {"$exists": False}}))
    if not rows:
        print("Nothing to roll back.")
        return
    run = db.agent_runs.find_one({"_id": run_id})
    now = datetime.now(timezone.utc).isoformat()
    with txn(db) as s:
        for r in rows:
            db.accounts.update_one({"_id": r["account_id"]}, {"$inc": {"balance_cents": -r["amount_cents"]}}, session=s)
            db.ledger.insert_one({"account_id": r["account_id"], "amount_cents": -r["amount_cents"],
                                  "memo": f"ROLLBACK of {run_id}", "run_id": f"rollback:{run_id}",
                                  "reversal_of": r["_id"], "ts": now}, session=s)
            acct = db.accounts.find_one({"_id": r["account_id"]}, session=s)
            if acct["type"] in ("TFSA", "RRSP") and r["amount_cents"] > 0:
                db.contribution_room.update_one({"user_id": run["user_id"], "account_type": acct["type"]},
                                                {"$inc": {"room_cents": r["amount_cents"]}}, session=s)
        db.agent_runs.update_one({"_id": run_id}, {"$set": {"status": "rolled_back"}}, session=s)
    audit.record(db, run_id=run_id, user_id=run["user_id"], event="rollback",
                 result={"reversed_entries": len(rows)})
    print(f"Reversed {len(rows)} ledger entries for {run_id}.")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd")
    ap.add_argument("arg", nargs="?")
    ap.add_argument("--reviewer", default="compliance")
    a = ap.parse_args()
    db = get_db()
    if a.cmd == "verify":
        ok, bad = audit.verify_chain(db)
        print("Hash chain OK" if ok else f"TAMPERED at seq {bad}")
    elif a.cmd == "approve":
        approve(db, a.arg, a.reviewer)
    elif a.cmd in ("watch", "runs", "approvals"):
        globals()[a.cmd](db)
    elif a.cmd in ("replay", "halt", "rollback", "denied"):
        globals()[a.cmd](db, a.arg)
    else:
        print(__doc__)


if __name__ == "__main__":
    main()
