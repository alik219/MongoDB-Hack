"""The single pre-action gate. Every tool call goes through authorize() BEFORE it runs.

Identity (ctx.user_id) comes from the authenticated session, never from the model.
Policies are documents in Atlas, so changing a threshold is a data change, and the
policy version that made each decision is written to the audit log.
"""
from dataclasses import dataclass, field
from typing import List, Optional

from . import finance

REGISTERED = {"TFSA", "RRSP"}


@dataclass
class Ctx:
    user_id: str
    run_id: str


@dataclass
class Decision:
    effect: str = "ALLOW"            # ALLOW | DENY | NEEDS_APPROVAL
    fired: List[dict] = field(default_factory=list)    # policies that blocked/escalated
    checked: List[dict] = field(default_factory=list)  # every policy evaluated
    reasons: List[str] = field(default_factory=list)
    approval_id: Optional[str] = None

    def to_audit(self):
        return {"decision": self.effect, "policies": self.fired or self.checked,
                "reasons": self.reasons}


class _Eval:
    def __init__(self, db):
        self.db = db
        self.d = Decision()
        self._cache = {}

    def pol(self, pid):
        if pid not in self._cache:
            self._cache[pid] = self.db.policies.find_one({"_id": pid, "active": True})
        return self._cache[pid]

    def check(self, pid, ok, reason):
        p = self.pol(pid)
        if p is None:  # policy disabled
            return True
        ref = {"id": pid, "version": p["version"]}
        if ref not in self.d.checked:
            self.d.checked.append(ref)
        if not ok:
            if ref not in self.d.fired:
                self.d.fired.append(ref)
            self.d.reasons.append(f"{pid}: {reason}")
            if p["effect"] == "DENY":
                self.d.effect = "DENY"
            elif self.d.effect == "ALLOW":
                self.d.effect = "NEEDS_APPROVAL"
        return ok


def viewer_perms(db, user_id, client):
    """Permissions the user holds on this client profile (empty set = none)."""
    from .clients import ROLE_PERMS
    if not client:
        return set()
    for m in client.get("members", []) + client.get("advisors", []):
        if m["user_id"] == user_id:
            return set(ROLE_PERMS.get(m["role"], set()))
    return set()


def _owned(ev, ctx, account_id):
    acct = ev.db.accounts.find_one({"_id": account_id})
    # Same message for "doesn't exist" and "not yours" so the agent can't probe for account IDs.
    ok = acct is not None and ctx.user_id in acct["owner_ids"]
    ev.check("P-OWN-01", ok, f"{ctx.user_id} is not an owner of account '{account_id}'")
    return acct if ok else None


def authorize(db, ctx: Ctx, tool: str, args: dict) -> Decision:
    ev = _Eval(db)

    if tool in ("list_my_accounts", "get_contribution_room"):
        pass  # queries are hard-scoped to ctx.user_id in the tool itself

    elif tool in ("get_account_summary", "get_transactions"):
        _owned(ev, ctx, args.get("account_id"))

    elif tool == "transfer":
        _authorize_transfer(ev, ctx, args)

    elif tool == "mortgage_prequalify":
        _authorize_mortgage(ev, ctx, args)

    elif tool == "get_client_snapshot":
        client = db.clients.find_one({"_id": args.get("client_id")})
        perms = viewer_perms(db, ctx.user_id, client)
        # Same message for "no such client" and "not yours", so IDs can't be probed.
        ev.check("P-CLIENT-01", bool(perms & {"snapshot", "snapshot_business"}),
                 f"{ctx.user_id} may not view client '{args.get('client_id')}'")
        if perms:
            ev.check("P-PII-01", True, "")  # recorded as checked; masking happens in the tool

    else:
        ev.d.effect = "DENY"
        ev.d.reasons.append(f"Unknown tool '{tool}'")

    return ev.d


def _authorize_transfer(ev, ctx, args):
    amount = int(round(float(args.get("amount", 0)) * 100))
    src = _owned(ev, ctx, args.get("from_account_id"))
    dst = _owned(ev, ctx, args.get("to_account_id"))
    if src is None or dst is None:
        return
    ev.check("P-XFER-01", amount > 0, "amount must be positive")
    ev.check("P-XFER-01", src["balance_cents"] >= amount,
             f"insufficient funds: {src['_id']} has ${src['balance_cents']/100:,.2f}")
    ev.check("P-REG-01", src["type"] not in REGISTERED | {"MORTGAGE"},
             f"agent may not withdraw from a {src['type']} account")

    if dst["type"] in REGISTERED:
        room = ev.db.contribution_room.find_one({"user_id": ctx.user_id, "account_type": dst["type"]},
                                                sort=[("year", -1)])
        room_c = room["room_cents"] if room else 0
        if dst["type"] == "TFSA":
            ev.check("P-TFSA-01", amount <= room_c,
                     f"TFSA room left is ${room_c/100:,.2f}; ${amount/100:,.2f} would over-contribute")
        else:
            buf = ev.pol("P-RRSP-01")["params"]["buffer_cents"]
            ev.check("P-RRSP-01", amount <= room_c + buf,
                     f"RRSP room left is ${room_c/100:,.2f} (+${buf/100:,.0f} buffer)")

    # Business clients: the signing-authority matrix replaces the retail threshold.
    approval_pid, threshold = "P-XFER-02", None
    user = ev.db.users.find_one({"_id": ctx.user_id}) or {}
    client = ev.db.clients.find_one({"_id": user.get("client_id")}) if user.get("client_id") else None
    biz = (client or {}).get("business") or {}
    if biz.get("payment_limits_cents"):
        limit = biz["payment_limits_cents"].get(user.get("role"), 0)
        ev.check("P-ROLE-01", amount <= limit,
                 f"role '{user.get('role')}' may move at most ${limit/100:,.0f}; requested ${amount/100:,.2f}")
        approval_pid, threshold = "P-ROLE-02", biz["dual_approval_over_cents"]

    if ev.d.effect == "DENY":
        return  # never create approval requests for actions that would be denied anyway

    p = ev.pol(approval_pid)
    if p and threshold is None:
        threshold = p["params"]["threshold_cents"]
    if p and amount > threshold:
        appr_id = args.get("approval_id")
        approved = appr_id and ev.db.approvals.find_one({
            "_id": appr_id, "status": "approved", "user_id": ctx.user_id, "tool": "transfer",
            "args.from_account_id": src["_id"], "args.to_account_id": dst["_id"],
            "amount_cents": amount, "used": False})
        if approved:
            ev.d.checked.append({"id": approval_pid, "version": p["version"]})
            ev.d.reasons.append(f"{approval_pid}: satisfied by approval {appr_id}")
            ev.d.approval_id = appr_id
        else:
            ev.check(approval_pid, False,
                     f"${amount/100:,.2f} exceeds ${threshold/100:,.0f}; a second approver is required")


def _authorize_mortgage(ev, ctx, args):
    co = args.get("co_applicant_id")
    if co:
        consent = ev.db.consents.find_one({"grantor": co, "grantee": ctx.user_id,
                                           "scope": "mortgage_income", "revoked": False})
        ev.check("P-OWN-02", consent is not None,
                 f"no consent on file from '{co}' to use their income")

    price = int(round(float(args["purchase_price"]) * 100))
    down = int(round(float(args["down_payment"]) * 100))
    p1 = ev.pol("P-MORT-01")["params"]
    need = finance.min_down_payment_cents(price, p1["tier1_cap_cents"], p1["insured_cap_cents"])
    ev.check("P-MORT-01", down >= need,
             f"minimum down payment on ${price/100:,.0f} is ${need/100:,.2f}; you entered ${down/100:,.2f}")
    if ev.d.effect == "DENY":
        return

    user = ev.db.users.find_one({"_id": ctx.user_id})["profile"]
    p2 = ev.pol("P-MORT-02")["params"]
    q = finance.qualifying_rate_pct(float(args["contract_rate_pct"]), p2["stress_add_pct"], p2["stress_floor_pct"])
    r = finance.debt_ratios(
        principal=price - down, qual_rate_pct=q, amort_years=int(args.get("amortization_years", 25)),
        tax_monthly=int(round(float(args.get("property_tax_monthly", 0)) * 100)),
        heat_monthly=int(round(float(args.get("heating_monthly", 100)) * 100)),
        other_debt_monthly=user["monthly_debt_payments_cents"],
        gross_annual_income=user["gross_annual_income_cents"])
    ev.check("P-MORT-02", r["gds"] <= p2["max_gds"] and r["tds"] <= p2["max_tds"],
             f"at qualifying rate {q:.2f}%: GDS {r['gds']:.1%} (max {p2['max_gds']:.0%}), "
             f"TDS {r['tds']:.1%} (max {p2['max_tds']:.0%})")
