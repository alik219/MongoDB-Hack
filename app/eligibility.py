"""Deterministic eligibility check: client financials × a bank's `decision_rules`.

The LLM never does this arithmetic. `evaluate()` is pure (no DB) and returns every check with
its threshold, so an advisor or reviewer can see exactly why a decision came out as it did.

Decisions: APPROVE · DECLINE · REFER (needs an underwriter, e.g. passes only without
contingent business debt, or only with a co-signer) · NOT_APPLICABLE (product doesn't fit).

Exact credit scores never leave this module: checks show the score band instead.
"""
from __future__ import annotations

import re
from typing import Any, Optional

from app.finance import monthly_payment_cents

DEFAULT_CONTRACT_RATE = 0.05     # snapshots use a ~5% contract rate ($5.81 per $1,000)
DEFAULT_AMORTIZATION = 25
PLC_PAYMENT_PCT = 0.03           # lender rule of thumb used in the snapshots
RENTAL_INCOME_COUNTED = 0.50     # snapshots count 50% of rent
CONDO_FEE_COUNTED = 0.50


def score_band(score: Optional[int]) -> str:
    if score is None:
        return "n/a"
    for floor, label in ((800, "Exceptional (800+)"), (700, "Good (700 to 799)"),
                         (600, "Fair (600 to 699)")):
        if score >= floor:
            return label
    return "Poor (below 600)"


def _rate(expr: str, contract: float) -> float:
    """'max(contract_rate + 0.02, 0.0525)' -> qualifying rate."""
    m = re.search(r"contract_rate\s*\+\s*([\d.]+)\s*,\s*([\d.]+)", expr or "")
    return max(contract + float(m.group(1)), float(m.group(2))) if m else contract + 0.02


def _formula(expr: str, ctx: dict) -> float:
    """'0.50 * annual_income' -> number."""
    m = re.fullmatch(r"\s*([\d.]+)\s*\*\s*(\w+)\s*", expr or "")
    if not m or ctx.get(m.group(2)) is None:
        raise ValueError(f"unsupported formula {expr!r}")
    return float(m.group(1)) * ctx[m.group(2)]


def _condition(expr: str, ctx: dict) -> Optional[bool]:
    """'credit_score < 620' -> bool; None if the field is unknown (e.g. no foreclosure ever)."""
    m = re.fullmatch(r"\s*(\w+)\s*(<=|>=|<|>)\s*([\d.]+)\s*", expr)
    if not m:
        raise ValueError(f"unsupported condition {expr!r}")
    val = ctx.get(m.group(1))
    if val is None:
        return None
    x, op = float(m.group(3)), m.group(2)
    return {"<": val < x, "<=": val <= x, ">": val > x, ">=": val >= x}[op]


def _clip(x: float, floor: Optional[float] = None, cap: Optional[float] = None) -> float:
    if cap is not None:
        x = min(x, cap)
    if floor is not None and x < floor:
        return 0.0
    return x


class _Checks:
    def __init__(self, score: Optional[int]):
        self.items: list[dict] = []
        self.score = score

    def add(self, rule: str, value: Any, threshold: Any, passed: Optional[bool], note: str = "") -> bool:
        if rule.endswith("credit_score") and isinstance(value, (int, float)):
            value = score_band(int(value))      # never expose the exact score
        self.items.append({"rule": rule, "client_value": value, "threshold": threshold,
                           "passed": passed, **({"note": note} if note else {})})
        return bool(passed)

    @property
    def failed(self) -> list[str]:
        return [c["rule"] for c in self.items if c["passed"] is False]


# --------------------------------------------------------------------------- public API

def evaluate(fin: dict, policy: dict, request: Optional[dict] = None,
             co_signer_available: Optional[bool] = None) -> dict:
    """fin: client_financials doc. policy: approval_policy chunk (bank, product, policy, ...).

    request overrides the client's default scenario for this product. co_signer_available
    lets the agent apply what it remembers (e.g. "parent can no longer co-sign").
    """
    product = policy["product"]
    req = {**(fin.get("default_requests") or {}).get(product, {}), **(request or {})}
    out = {"client_id": fin["_id"], "bank": policy["bank"], "product": product,
           "policy_id": policy.get("policy_id"), "policy_version": policy.get("version"),
           "request": req}
    res = _evaluate(fin, policy, req)

    # Co-signer: policies define no co-signer rules, so a co-signer can only turn a decline
    # into a referral for an underwriter (never an approval). Re-run with the co-signer's
    # income added and the better of the two scores.
    cs = fin.get("co_signer")
    if res["decision"] == "DECLINE" and cs and fin.get("entity_type") == "individual":
        if co_signer_available is False:
            res["reasons"].append("Co-signer on file is currently NOT available, so no co-signed referral.")
        else:
            joint = {**fin, "annual_income_cad": fin["annual_income_cad"] + cs["annual_income_cad"],
                     "credit_score": max(fin["credit_score"], cs["credit_score"]), "co_signer": None}
            joint_res = _evaluate(joint, policy, req)
            if joint_res["decision"].startswith("APPROVE"):
                res["decision"] = "REFER"
                res["reasons"].append(f"Would pass with the {cs['relationship']} co-signer on file "
                                      "(policy has no co-signer rule): refer to an underwriter.")
                res["with_co_signer"] = {k: joint_res.get(k) for k in ("decision", "offers", "figures")}
            else:
                res["reasons"].append("Still fails with the co-signer: " + ", ".join(joint_res["failed"]))
    out.update(res)
    return out


def _evaluate(fin: dict, policy: dict, req: dict) -> dict:
    product, rules = policy["product"], policy.get("policy") or {}
    if product == "business_credit_card":
        res = _business_card(fin, rules, req)
    elif fin.get("entity_type") != "individual":
        res = {"decision": "NOT_APPLICABLE",
               "reasons": ["Retail policy; corporate clients need a commercial credit review."]}
    elif product == "mortgage":
        res = _mortgage(fin, rules, req, policy["bank"])
    elif product == "personal_line_of_credit":
        res = _plc(fin, rules, req, policy["bank"])
    else:
        res = {"decision": "NOT_APPLICABLE", "reasons": [f"No evaluator for product {product}"]}
    return res


# --------------------------------------------------------------------------- products

def _common_gates(fin: dict, rules: dict, ctx: dict, c: _Checks) -> bool:
    ok = True
    for cond in rules.get("auto_decline_if", []):
        hit = _condition(cond, ctx)
        field = cond.split()[0]
        c.add(f"auto_decline_if: {field}", _shown(field, ctx.get(field)), f"not {cond}",
              None if hit is None else not hit, "no such event on file" if hit is None else "")
        ok = ok and hit is not True
    return ok


def _shown(field: str, v: Any) -> Any:
    if "credit_score" in field and isinstance(v, (int, float)):
        return score_band(int(v))
    if isinstance(v, float):
        return round(v, 3)
    return v


def _down_payment_funds(fin: dict, req: dict) -> tuple[float, str]:
    if req.get("occupancy") == "rental":
        return fin["investable_assets_cad"], "investable assets (liquid, registered, brokerage)"
    if req.get("replaces_current_housing", True):
        equity = fin["property_value_cad"] - fin["property_debt_cad"]
        return fin["liquid_assets_cad"] + equity, "liquid assets + equity in current home"
    return fin["liquid_assets_cad"], "liquid assets"


def _mortgage(fin: dict, rules: dict, req: dict, bank: str) -> dict:
    c = _Checks(fin["credit_score"])
    price, down = req["purchase_price_cad"], req["down_payment_cad"]
    principal = price - down
    contract = req.get("contract_rate", DEFAULT_CONTRACT_RATE)
    amort = req.get("amortization_years", DEFAULT_AMORTIZATION)
    qual = _rate((rules.get("stress_test") or {}).get("qualifying_rate"), contract)
    pi = monthly_payment_cents(principal * 100, qual * 100, amort) / 100
    new_costs = (req.get("property_tax_monthly_cad", 0) + req.get("heating_monthly_cad", 0)
                 + CONDO_FEE_COUNTED * req.get("condo_fee_monthly_cad", 0))

    income_m = fin["annual_income_cad"] / 12 + RENTAL_INCOME_COUNTED * req.get("rental_income_monthly_cad", 0)
    asset_income_m = 0.0
    if rules.get("asset_based_income_allowed") and rules.get("asset_based_income"):
        at_bank = req.get("investable_assets_at_bank_cad",
                          (fin.get("assets_by_bank") or {}).get(bank, 0))
        asset_income_m = at_bank / 180
        income_m += asset_income_m
    if req.get("occupancy", "owner") == "owner":
        housing = pi + new_costs + (0 if req.get("replaces_current_housing", True) else fin["housing_monthly_cad"])
        other = fin["other_debt_monthly_cad"]
    else:  # rental: current home stays the housing cost; new property is another debt
        housing = fin["housing_monthly_cad"]
        other = fin["other_debt_monthly_cad"] + pi + new_costs
    gds, tds = housing / income_m, (housing + other) / income_m
    tds_contingent = (housing + other + fin.get("contingent_debt_monthly_cad", 0)) / income_m
    dp_pct = down / price

    ctx = {"credit_score": fin["credit_score"], "down_payment_pct": dp_pct,
           "foreclosure_last_months": fin.get("foreclosure_last_months")}
    gates_ok = _common_gates(fin, rules, ctx, c)
    c.add("min_credit_score", fin["credit_score"], rules.get("min_credit_score"),
          fin["credit_score"] >= rules.get("min_credit_score", 0))
    if "min_annual_income" in rules:
        met = fin["annual_income_cad"] >= rules["min_annual_income"] or (
            asset_income_m > 0 and income_m * 12 >= rules["min_annual_income"])
        c.add("min_annual_income", fin["annual_income_cad"], rules["min_annual_income"], met,
              f"incl. asset-based income {income_m*12:,.0f}/yr" if asset_income_m else "")
    min_dp = rules.get("min_down_payment_pct", 0)
    if "min_down_payment_pct_if_assets_ge_500000" in rules and \
            req.get("investable_assets_at_bank_cad", (fin.get("assets_by_bank") or {}).get(bank, 0)) >= 500_000:
        min_dp = rules["min_down_payment_pct_if_assets_ge_500000"]
    c.add("min_down_payment_pct", round(dp_pct, 3), min_dp, dp_pct >= min_dp)
    funds, source = _down_payment_funds(fin, req)
    c.add("down_payment_funds", funds, down, funds >= down, source)
    if "max_amortization_years" in rules:
        c.add("max_amortization_years", amort, rules["max_amortization_years"], amort <= rules["max_amortization_years"])
    c.add("max_gds", round(gds, 3), rules.get("max_gds"), gds <= rules.get("max_gds", 1))
    tds_ok = c.add("max_tds", round(tds, 3), rules.get("max_tds"), tds <= rules.get("max_tds", 1),
                   "personal debts only" if fin.get("contingent_debt_monthly_cad") else "")
    contingent_fail = False
    if fin.get("contingent_debt_monthly_cad"):
        contingent_fail = not c.add("max_tds_incl_guaranteed_debt", round(tds_contingent, 3), rules.get("max_tds"),
                                    tds_contingent <= rules.get("max_tds", 1),
                                    "includes personally guaranteed business payments")

    reasons, failed = [], c.failed
    if not gates_ok or (set(failed) - {"max_tds_incl_guaranteed_debt"}):
        decision = "DECLINE"
        reasons.append("Fails: " + ", ".join(failed))
    elif contingent_fail and tds_ok:
        decision = "REFER"
        reasons.append("Passes on personal debts only; underwriter must confirm the business pays "
                       "its own guaranteed loans.")
    else:
        decision = "APPROVE"
    return {"decision": decision, "reasons": reasons, "failed": failed, "checks": c.items,
            "figures": {"mortgage_cad": principal, "qualifying_rate": round(qual, 4),
                        "stress_payment_monthly_cad": round(pi), "qualifying_income_monthly_cad": round(income_m),
                        "gds": round(gds, 3), "tds": round(tds, 3)}}


def _plc(fin: dict, rules: dict, req: dict, bank: str) -> dict:
    c = _Checks(fin["credit_score"])
    income = fin["annual_income_cad"]
    at_bank = req.get("investable_assets_at_bank_cad", (fin.get("assets_by_bank") or {}).get(bank, 0))
    amount = req.get("amount_cad", 10_000)
    income_m = income / 12
    tds_after = (fin["housing_monthly_cad"] + fin["other_debt_monthly_cad"]
                 + PLC_PAYMENT_PCT * amount) / income_m
    ctx = {"credit_score": fin["credit_score"], "annual_income": income, "tds_after_new_limit": tds_after}
    gates_ok = _common_gates(fin, rules, ctx, c)
    c.add("min_credit_score", fin["credit_score"], rules.get("min_credit_score"),
          fin["credit_score"] >= rules.get("min_credit_score", 0))
    waived = "investable_assets_at_cibc" in str(rules) and at_bank >= 250_000
    c.add("min_annual_income", income, rules.get("min_annual_income"),
          waived or income >= rules.get("min_annual_income", 0),
          "waived: investable assets at bank >= 250,000" if waived else "")
    c.add("max_tds", round(tds_after, 3), rules.get("max_tds"), tds_after <= rules.get("max_tds", 1),
          f"includes {PLC_PAYMENT_PCT:.0%} payment on the requested {amount:,} line")

    offers = []
    uns = rules.get("unsecured") or {}
    if uns:
        lim = _clip(_formula(uns["limit_formula"], {"annual_income": income}), uns.get("floor"), uns.get("cap"))
        offers.append({"type": "unsecured", "max_limit_cad": round(lim)})
    inv = rules.get("investment_secured") or {}
    if inv and at_bank >= 500_000:
        lim = _clip(_formula(inv["limit_formula"], {"investable_assets_at_cibc": at_bank}), None, inv.get("cap"))
        offers.append({"type": "investment_secured", "max_limit_cad": round(lim)})
    sec = rules.get("secured") or {}
    equity = fin["property_value_cad"] - fin["property_debt_cad"]
    if sec and equity > 0:
        lim = max(0, fin["property_value_cad"] * sec["max_ltv"] - fin["property_debt_cad"])
        offers.append({"type": "secured_home_equity", "max_limit_cad": round(lim),
                       "note": f"{sec['max_ltv']:.0%} LTV less existing property debt"})

    failed = c.failed
    if not gates_ok or failed:
        decision, reasons = "DECLINE", ["Fails: " + ", ".join(failed)]
        offers = []
    else:
        best = max((o["max_limit_cad"] for o in offers), default=0)
        decision = "APPROVE" if best >= amount else "APPROVE_REDUCED"
        reasons = [] if best >= amount else [f"Requested {amount:,} exceeds the largest offer {best:,}."]
    return {"decision": decision, "reasons": reasons, "failed": failed, "checks": c.items,
            "offers": offers, "figures": {"tds_after_new_limit": round(tds_after, 3)}}


def _business_card(fin: dict, rules: dict, req: dict) -> dict:
    biz = fin.get("business")
    if not biz:
        return {"decision": "NOT_APPLICABLE", "reasons": ["Client has no business on file."]}
    if fin.get("entity_type") != "individual" or fin.get("credit_score") is None:
        return {"decision": "NOT_APPLICABLE",
                "reasons": ["Small-business card policy needs an owner-principal's credit score; "
                            "corporate clients need a commercial card program review."]}
    c = _Checks(fin["credit_score"])
    score, months = fin["credit_score"], biz["months_in_business"]
    revenue, debt = biz["annual_revenue_cad"], biz["business_debt_cad"]
    bank_rel = req.get("bank_relationship", {})
    ctx = {"principal_credit_score": score, "months_in_business": months,
           "bankruptcy_last_months": fin.get("bankruptcy_last_months")}
    gates_ok = _common_gates(fin, rules, ctx, c)
    min_score = rules.get("min_principal_credit_score", 0)
    if "min_principal_credit_score_if_relationship" in rules and bank_rel.get("deposit_balance_cad", 0) >= 25_000:
        min_score = rules["min_principal_credit_score_if_relationship"]
    c.add("min_principal_credit_score", score, min_score, score >= min_score)
    min_months = rules.get("min_months_in_business", 0)
    if "min_months_in_business_if_primary_account" in rules and bank_rel.get("primary_business_account"):
        min_months = rules["min_months_in_business_if_primary_account"]
    c.add("min_months_in_business", months, min_months, months >= min_months)
    c.add("min_annual_business_revenue", revenue, rules.get("min_annual_business_revenue"),
          revenue >= rules.get("min_annual_business_revenue", 0))
    ratio = debt / revenue
    c.add("max_business_debt_to_revenue", round(ratio, 3), rules.get("max_business_debt_to_revenue"),
          ratio <= rules.get("max_business_debt_to_revenue", 1))

    cl = rules.get("credit_limit") or {}
    formula = cl.get("formula") or (cl.get("formula_if_aum_ge_250000")
                                    if bank_rel.get("aum_cad", 0) >= 250_000 else cl.get("formula_default"))
    limit = _clip(_formula(formula, {"annual_business_revenue": revenue}), cl.get("floor"), cl.get("cap")) if formula else 0
    secured = bool(rules.get("security_deposit_required")) or (
        "security_deposit_required_if" in rules and _condition(rules["security_deposit_required_if"], ctx))
    failed = c.failed
    if not gates_ok or failed:
        return {"decision": "DECLINE", "reasons": ["Fails: " + ", ".join(failed)], "failed": failed,
                "checks": c.items}
    return {"decision": "APPROVE", "reasons": [], "failed": [], "checks": c.items,
            "offers": [{"type": "secured" if secured else "unsecured", "max_limit_cad": round(limit),
                        "personal_guarantee_required": bool(rules.get("personal_guarantee_required"))}]}
