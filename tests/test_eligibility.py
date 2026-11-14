"""Eligibility engine: outcomes must match the hand-worked results in Clientdata/ClientSnapshot."""
import json
from pathlib import Path

import pytest

from app.client_financials import CLIENT_FINANCIALS
from app.eligibility import evaluate
from scripts.ingest_clientdata import DATA_DIR, build_chunks

pytestmark = pytest.mark.skipif(not DATA_DIR.exists(), reason="Clientdata/ not present")

FIN = {f["_id"]: f for f in CLIENT_FINANCIALS}


@pytest.fixture(scope="module")
def policies():
    return {(c["bank"], c["product"]): c for c in build_chunks() if c["doc_type"] == "approval_policy"}


def run(policies, cid, bank, product, **kw):
    return evaluate(FIN[cid], policies[(bank, product)], **kw)


def test_c3_mortgage_refers_on_guaranteed_business_debt(policies):
    r = run(policies, "C3", "TD", "mortgage")
    assert r["decision"] == "REFER"
    assert r["figures"]["gds"] == pytest.approx(0.344, abs=0.002)   # snapshot §6c: 34.4%
    assert r["figures"]["tds"] == pytest.approx(0.394, abs=0.002)   # snapshot §6c: 39.4%


def test_c2_rental_mortgage_approves(policies):
    r = run(policies, "C2", "RBC", "mortgage")
    assert r["decision"] == "APPROVE"
    assert r["figures"]["tds"] == pytest.approx(0.326, abs=0.01)    # snapshot §6c: 32.6%


def test_c1_mortgage_declines_on_down_payment(policies):
    r = run(policies, "C1", "TD", "mortgage")
    assert r["decision"] == "DECLINE"
    assert "down_payment_funds" in r["failed"]


def test_c1_line_of_credit_depends_on_co_signer(policies):
    assert run(policies, "C1", "TD", "personal_line_of_credit")["decision"] == "REFER"
    r = run(policies, "C1", "TD", "personal_line_of_credit", co_signer_available=False)
    assert r["decision"] == "DECLINE"
    assert any("NOT available" in x for x in r["reasons"])


def test_cibc_investment_secured_line_needs_assets_at_cibc(policies):
    base = run(policies, "C2", "CIBC", "personal_line_of_credit")
    assert "investment_secured" not in {o["type"] for o in base["offers"]}
    moved = run(policies, "C2", "CIBC", "personal_line_of_credit",
                request={"investable_assets_at_bank_cad": 600_000})
    inv = next(o for o in moved["offers"] if o["type"] == "investment_secured")
    assert inv["max_limit_cad"] == 150_000                            # 30% capped at 150k


def test_business_card_limits_and_applicability(policies):
    assert run(policies, "C3", "RBC", "business_credit_card")["offers"][0]["max_limit_cad"] == 100_000
    assert run(policies, "C3", "TD", "business_credit_card")["offers"][0]["max_limit_cad"] == 50_000
    assert run(policies, "C1", "TD", "business_credit_card")["decision"] == "NOT_APPLICABLE"
    assert run(policies, "C4", "TD", "mortgage")["decision"] == "NOT_APPLICABLE"


def test_exact_scores_never_returned(policies):
    out = json.dumps([evaluate(f, p) for f in CLIENT_FINANCIALS for p in policies.values()])
    for score in ("662", "745", "812", "770"):
        assert score not in out
