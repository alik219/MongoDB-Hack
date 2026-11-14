"""Append-only, hash-chained audit log.

Each entry stores prev_hash and hash = sha256(prev_hash + canonical JSON of the
entry). Editing or deleting any past entry breaks verify_chain().
In Atlas, give the app's DB user only insert+find on audit_log.
"""
import hashlib
import json
from datetime import datetime, timezone

from pymongo import ReturnDocument

GENESIS = "0" * 64


def _canonical(entry):
    body = {k: v for k, v in entry.items() if k not in ("_id", "hash")}
    return json.dumps(body, sort_keys=True, default=str, separators=(",", ":"))


def _next_seq(db):
    doc = db.counters.find_one_and_update(
        {"_id": "audit_seq"}, {"$inc": {"value": 1}},
        upsert=True, return_document=ReturnDocument.AFTER)
    return doc["value"]


def record(db, *, run_id, user_id, event, tool=None, args=None, decision=None,
           policies=None, reasons=None, result=None, model_reason=None):
    seq = _next_seq(db)
    prev = db.audit_log.find_one({"seq": seq - 1}, {"hash": 1})
    entry = {
        "seq": seq,
        "ts": datetime.now(timezone.utc).isoformat(),
        "run_id": run_id,
        "user_id": user_id,
        "event": event,
        "tool": tool,
        "args": args,
        "decision": decision,
        "policies": policies or [],   # [{"id": "P-OWN-01", "version": 1}]
        "reasons": reasons or [],
        "model_reason": model_reason,  # what the LLM said it was trying to do
        "result": result,
        "prev_hash": prev["hash"] if prev else GENESIS,
    }
    entry["hash"] = hashlib.sha256((entry["prev_hash"] + _canonical(entry)).encode()).hexdigest()
    db.audit_log.insert_one(entry)
    return entry


def verify_chain(db):
    """Return (ok, first_bad_seq)."""
    prev_hash = GENESIS
    for e in db.audit_log.find().sort("seq", 1):
        expected = hashlib.sha256((prev_hash + _canonical(e)).encode()).hexdigest()
        if e["prev_hash"] != prev_hash or e["hash"] != expected:
            return False, e["seq"]
        prev_hash = e["hash"]
    return True, None
