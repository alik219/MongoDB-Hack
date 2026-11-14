"""MongoDB connection, collection validators and indexes.

Money is stored as integer cents everywhere to avoid float drift.
"""
import os
from contextlib import contextmanager

from dotenv import load_dotenv
from pymongo import ASCENDING, DESCENDING, MongoClient
from pymongo.errors import CollectionInvalid, OperationFailure

load_dotenv()

_client = None


def get_client():
    global _client
    if _client is None:
        _client = MongoClient(os.environ["MONGODB_URI"])
    return _client


def get_db():
    return get_client()[os.environ.get("MONGODB_DB", "hackathon")]


@contextmanager
def txn(db):
    """Yield a session inside a multi-document transaction (Atlas replica set).

    Falls back to no session when transactions aren't supported (e.g. mongomock),
    so unit tests still run.
    """
    try:
        with db.client.start_session() as s:
            with s.start_transaction():
                yield s
    except (NotImplementedError, OperationFailure) as e:
        if isinstance(e, OperationFailure) and "Transaction" not in str(e):
            raise
        yield None


# $jsonSchema validators: Atlas rejects malformed writes at the DB layer.
VALIDATORS = {
    "audit_log": {
        "bsonType": "object",
        "required": ["seq", "ts", "run_id", "user_id", "event", "hash", "prev_hash"],
        "properties": {
            "seq": {"bsonType": ["int", "long"]},
            "user_id": {"bsonType": "string"},
            "run_id": {"bsonType": "string"},
            "event": {"enum": ["run_start", "decision", "result", "run_end",
                                "halt", "approval", "rollback",
                                # governed memory (app/memory.py)
                                "memory_write", "memory_rejected", "memory_read",
                                "memory_correct", "memory_forget", "memory_denied"]},
            "decision": {"enum": ["ALLOW", "DENY", "NEEDS_APPROVAL", None]},
            "hash": {"bsonType": "string"},
            "prev_hash": {"bsonType": "string"},
        },
    },
    "accounts": {
        "bsonType": "object",
        "required": ["_id", "owner_ids", "type", "balance_cents"],
        "properties": {
            "owner_ids": {"bsonType": "array", "minItems": 1},
            "type": {"enum": ["CHEQUING", "SAVINGS", "TFSA", "RRSP", "MORTGAGE"]},
            "balance_cents": {"bsonType": ["int", "long"]},
        },
    },
    "ledger": {
        "bsonType": "object",
        "required": ["account_id", "amount_cents", "run_id", "ts"],
    },
    "policies": {
        "bsonType": "object",
        "required": ["_id", "version", "effect", "description", "active"],
        "properties": {"effect": {"enum": ["DENY", "NEEDS_APPROVAL"]}},
    },
}


def init_collections(db=None):
    db = db if db is not None else get_db()
    for name, schema in VALIDATORS.items():
        try:
            db.create_collection(name, validator={"$jsonSchema": schema})
        except CollectionInvalid:
            db.command("collMod", name, validator={"$jsonSchema": schema})
    db.audit_log.create_index([("seq", ASCENDING)], unique=True)
    db.audit_log.create_index([("run_id", ASCENDING), ("seq", ASCENDING)])
    db.audit_log.create_index([("user_id", ASCENDING), ("ts", DESCENDING)])
    db.accounts.create_index([("owner_ids", ASCENDING)])
    db.ledger.create_index([("account_id", ASCENDING), ("ts", DESCENDING)])
    db.ledger.create_index([("run_id", ASCENDING)])
    db.contribution_room.create_index(
        [("user_id", ASCENDING), ("account_type", ASCENDING), ("year", ASCENDING)], unique=True)
