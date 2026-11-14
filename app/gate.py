"""execute(): kill-switch check -> authorize -> audit decision -> run -> audit result.

This is the only path from the agent to a tool. The scripted demo calls it directly,
the LLM agent calls it for every tool_use block.
"""
import uuid
from datetime import datetime, timezone

from . import audit
from .policy import Ctx, authorize
from .tools import IMPLS


class Halted(Exception):
    pass


def start_run(db, user_id, prompt):
    run_id = f"run_{uuid.uuid4().hex[:10]}"
    db.agent_runs.insert_one({"_id": run_id, "user_id": user_id, "status": "running",
                              "prompt": prompt, "started": datetime.now(timezone.utc).isoformat()})
    audit.record(db, run_id=run_id, user_id=user_id, event="run_start", args={"prompt": prompt})
    return Ctx(user_id=user_id, run_id=run_id)


def end_run(db, ctx, status="completed"):
    db.agent_runs.update_one({"_id": ctx.run_id, "status": "running"}, {"$set": {"status": status}})
    audit.record(db, run_id=ctx.run_id, user_id=ctx.user_id, event="run_end", result={"status": status})


def execute(db, ctx: Ctx, tool: str, args: dict, model_reason: str = None):
    run = db.agent_runs.find_one({"_id": ctx.run_id}, {"status": 1})
    if not run or run["status"] != "running":
        audit.record(db, run_id=ctx.run_id, user_id=ctx.user_id, event="halt", tool=tool, args=args,
                     reasons=["run is not running (kill switch)"])
        raise Halted(ctx.run_id)

    d = authorize(db, ctx, tool, args)

    if d.effect == "NEEDS_APPROVAL":
        appr_id = f"appr_{uuid.uuid4().hex[:8]}"
        db.approvals.insert_one({
            "_id": appr_id, "status": "pending", "used": False, "user_id": ctx.user_id,
            "run_id": ctx.run_id, "tool": tool,
            "args": {k: v for k, v in args.items() if k != "approval_id"},
            "amount_cents": int(round(float(args.get("amount", 0)) * 100)),
            "reasons": d.reasons, "created": datetime.now(timezone.utc).isoformat()})
        d.approval_id = appr_id

    audit.record(db, run_id=ctx.run_id, user_id=ctx.user_id, event="decision", tool=tool, args=args,
                 model_reason=model_reason, result={"approval_id": d.approval_id}, **d.to_audit())

    if d.effect == "DENY":
        return {"status": "denied", "reasons": d.reasons}
    if d.effect == "NEEDS_APPROVAL":
        return {"status": "pending_approval", "approval_id": d.approval_id, "reasons": d.reasons}

    try:
        result = IMPLS[tool](db, ctx, args)
    except Exception as e:  # record failures too, so the trail is complete
        audit.record(db, run_id=ctx.run_id, user_id=ctx.user_id, event="result", tool=tool,
                     result={"error": repr(e)})
        return {"status": "error", "error": str(e)}
    audit.record(db, run_id=ctx.run_id, user_id=ctx.user_id, event="result", tool=tool,
                 result=result if isinstance(result, dict) else {"rows": len(result)})
    return result
