"""Client-profile snapshot math, viewer scoping and C4 signing authority.  Run: pytest -q"""
from app import gate
from app.clients import CLIENTS, business_metrics, personal_metrics

from .test_policy import db  # noqa: F401  (fixture)

P = {c["_id"]: c for c in CLIENTS}


def snap(db, user, client_id):
    return gate.execute(db, gate.start_run(db, user, "test"), "get_client_snapshot", {"client_id": client_id})


# ---- math ----

def test_student_has_negative_net_worth():
    m = personal_metrics(P["C1"])
    assert m["net_worth"] < 0 and m["real_estate_value"] == 0
    assert m["credit_utilization"] == 0.363  # (620 + 9,000) / (1,500 + 25,000)


def test_resp_excluded_and_real_estate_equity():
    m = personal_metrics(P["C2"])
    assert m["real_estate_net_worth"] == (3_200_000 + 720_000 - 1_100_000 - 310_000 - 150_000) * 100
    assert m["total_assets"] == 7_310_000 * 100  # RESP left out
    assert m["gds"] < 0.39 and m["tds"] < 0.44


def test_business_ratios():
    m3 = business_metrics(P["C3"]["business"])
    assert m3["current_ratio"] == 2.33 and m3["dscr"] > 2.5
    m4 = business_metrics(P["C4"]["business"])
    assert m4["covenant_breaches"] == []
    assert personal_metrics(P["C4"]) is None


# ---- who can see what ----

def test_owner_sees_own_pii(db):
    s = snap(db, "c1_maya", "C1")
    assert s["identity"]["sin"] == "000-000-101"


def test_advisor_sees_masked_pii(db):
    s = snap(db, "adv_sam", "C2")
    assert s["identity"]["sin"] == "***-***-202" and "pii_masked" in s["visible_scope"]
    assert s["personal_metrics"]["net_worth"] > 5_000_000


def test_retail_advisor_cannot_see_business_client(db):
    s = snap(db, "adv_sam", "C3")
    assert s["status"] == "denied" and "P-CLIENT-01" in s["reasons"][0]


def test_client_cannot_see_other_client(db):
    assert snap(db, "c2_daniel", "C1")["status"] == "denied"


def test_bookkeeper_sees_business_not_owner_personal_file(db):
    s = snap(db, "c3_bookkeeper", "C3")
    assert "business_metrics" in s and "identity" not in s and "personal_metrics" not in s


def test_ap_clerk_has_no_profile_access(db):
    assert snap(db, "c4_ap_clerk", "C4")["status"] == "denied"


# ---- C4 signing authority ----

def test_treasury_over_role_limit_denied(db):
    out = gate.execute(db, gate.start_run(db, "c4_treasury", "t"), "transfer",
                       {"from_account_id": "acc_c4_ap", "to_account_id": "acc_c4_payroll", "amount": 2_000_000})
    assert out["status"] == "denied" and "P-ROLE-01" in out["reasons"][0]


def test_controller_within_limit_no_retail_threshold(db):
    out = gate.execute(db, gate.start_run(db, "c4_controller", "t"), "transfer",
                       {"from_account_id": "acc_c4_operating", "to_account_id": "acc_c4_payroll", "amount": 5_000_000})
    assert out["status"] == "completed"


def test_cfo_large_payment_needs_dual_approval(db):
    out = gate.execute(db, gate.start_run(db, "c4_cfo", "t"), "transfer",
                       {"from_account_id": "acc_c4_operating", "to_account_id": "acc_c4_payroll", "amount": 20_000_000})
    assert out["status"] == "pending_approval" and "P-ROLE-02" in out["reasons"][0]
