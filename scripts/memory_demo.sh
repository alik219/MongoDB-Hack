#!/usr/bin/env bash
# Track 2 demo: memory changes what the agent does on the next run, and can be corrected and forgotten.
# Usage: set -a; source ~/.mongodb-mcp.env; set +a; bash scripts/memory_demo.sh
set -euo pipefail
cd "$(dirname "$0")/.."
PY=.venv/bin/python
CHAT="$PY -u -m app.advisor_chat --user adv_daniel --role advisor --clients C1,C2 --client C1"
RUN=$(date +%H%M%S)

$PY - <<'EOF'
from pymongo.errors import CollectionInvalid
from app.db import VALIDATORS
from scripts.ingest_clientdata import get_collection
db = get_collection().database
try:
    db.create_collection("audit_log", validator={"$jsonSchema": VALIDATORS["audit_log"]})
except CollectionInvalid:
    db.command("collMod", "audit_log", validator={"$jsonSchema": VALIDATORS["audit_log"]})
db.audit_log.create_index("seq", unique=True)
print("audit_log ready")
EOF

echo; echo "===== 1. First conversation: the advisor learns something new ====="
$CHAT --conversation "demo-$RUN-1" --ask "Maya's mother told us today that she can no longer co-sign anything. Please remember that. What flexible credit can Maya get for emergencies?"

echo; echo "===== 2. NEW conversation, fact not mentioned: memory should change the advice ====="
$CHAT --conversation "demo-$RUN-2" --ask "What flexible credit options does Maya have for emergencies?"

echo; echo "===== 3. Correction ====="
$CHAT --conversation "demo-$RUN-3" --ask "Update from Maya: her mother can co-sign again after all. Correct what we remember and tell me what that changes for a line of credit."

echo; echo "===== 4. Right to be forgotten ====="
$CHAT --conversation "demo-$RUN-4" --ask "Maya asked us to forget everything we noted about her mother co-signing. Please do that."

echo; echo "===== What MongoDB holds now ====="
$PY - <<'EOF'
from app.audit import verify_chain
from scripts.ingest_clientdata import get_collection
db = get_collection().database
print("agent_memory docs for C1:")
for d in db.agent_memory.find({"namespace": ["client", "C1", "memories"]}, {"key": 1, "value.status": 1, "value.kind": 1, "value.content": 1}):
    print("  ", d["key"], d["value"]["status"], d["value"]["kind"], "-", d["value"]["content"])
print("memory audit events:", [e["event"] for e in db.audit_log.find({"event": {"$regex": "^memory_"}}).sort("seq", 1)])
print("audit chain intact:", verify_chain(db))
EOF
