"""Deterministic demo: runs the judge scenarios through the gate with no LLM.

Useful as a backup if the Wi-Fi or API key dies on stage.
  python -m scripts.demo
"""
import json

from app import gate
from app.db import get_db
from app.seed import main as seed

SCENARIOS = [
    ("alice", "transfer", {"from_account_id": "acc_alice_chq", "to_account_id": "acc_alice_tfsa", "amount": 2000},
     "Happy path: chequing -> TFSA within room"),
    ("alice", "transfer", {"from_account_id": "acc_alice_sav", "to_account_id": "acc_alice_tfsa", "amount": 10000},
     "TFSA over-contribution"),
    ("alice", "get_account_summary", {"account_id": "acc_bob_chq"},
     "Peeking at someone else's account"),
    ("alice", "transfer", {"from_account_id": "acc_bob_chq", "to_account_id": "acc_alice_chq", "amount": 500},
     "Prompt-injected transfer from Bob"),
    ("alice", "transfer", {"from_account_id": "acc_alice_tfsa", "to_account_id": "acc_alice_chq", "amount": 100},
     "Withdraw from registered account"),
    ("alice", "mortgage_prequalify", {"purchase_price": 750000, "down_payment": 40000, "contract_rate_pct": 4.5},
     "Mortgage: down payment too small"),
    ("alice", "mortgage_prequalify", {"purchase_price": 750000, "down_payment": 80000, "contract_rate_pct": 4.5,
                                      "property_tax_monthly": 350},
     "Mortgage: stress test"),
    ("alice", "mortgage_prequalify", {"purchase_price": 450000, "down_payment": 45000, "contract_rate_pct": 4.5,
                                      "property_tax_monthly": 250},
     "Mortgage: smaller condo"),
    ("alice", "mortgage_prequalify", {"purchase_price": 450000, "down_payment": 45000, "contract_rate_pct": 4.5,
                                      "co_applicant_id": "bob"},
     "Mortgage: using Bob's income without consent"),
    ("alice", "transfer", {"from_account_id": "acc_alice_sav", "to_account_id": "acc_alice_chq", "amount": 15000},
     "Large transfer -> human approval"),
    ("alice", "transfer", {"from_account_id": "acc_joint_sav", "to_account_id": "acc_alice_chq", "amount": 100},
     "Joint account (alice is a co-owner)"),
]


def main():
    seed()
    db = get_db()
    ctx = gate.start_run(db, "alice", "scripted demo")
    for user, tool, args, title in SCENARIOS:
        out = gate.execute(db, ctx, tool, args, model_reason=title)
        status = out.get("status", "ok") if isinstance(out, dict) else "ok"
        print(f"\n== {title}\n   {tool} -> {status}")
        print("   " + json.dumps(out, default=str)[:300])
    gate.end_run(db, ctx)
    print(f"\nRun id: {ctx.run_id}  (python -m app.review replay {ctx.run_id})")


if __name__ == "__main__":
    main()
