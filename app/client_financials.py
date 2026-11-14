"""Structured underwriting inputs for the four Clientdata clients (C1–C4).

Transcribed by hand from Clientdata/ClientSnapshot/*.md (section numbers in comments) so the
eligibility engine can do exact arithmetic. Stored in `hackathon.client_financials`.

This collection holds **exact** credit scores. It is underwriter-level data: tools may compute
pass/fail from it but must never return the score itself (see app/eligibility.py).

Amounts are whole Canadian dollars (`*_cad`), monthly where the name says so.
"""
from __future__ import annotations

from datetime import datetime, timezone

COLLECTION = "client_financials"

CLIENT_FINANCIALS = [
    {   # ClientSnapshot/C1_retail_student.md
        "_id": "C1", "client_ref": "C1-STU-001", "entity_type": "individual",
        "credit_score": 662,                                  # §3 Equifax
        "annual_income_cad": 18_304,                          # §2 documented, part-time
        "housing_monthly_cad": 850,                           # §1 rent
        "other_debt_monthly_cad": 12,                         # §4 card, 3% of balance
        "contingent_debt_monthly_cad": 0,
        "liquid_assets_cad": 5_000,                           # §5
        "investable_assets_cad": 7_000,                       # §5 liquid + TFSA
        "property_value_cad": 0, "property_debt_cad": 0,
        "foreclosure_last_months": None, "bankruptcy_last_months": None,
        "co_signer": {"relationship": "parent", "annual_income_cad": 92_000, "credit_score": 770},  # §1
        "assets_by_bank": {},                                 # not stated in the snapshot
        "business": None,
        "default_requests": {                                  # §6 scenarios
            "personal_line_of_credit": {"amount_cad": 5_000},
            "mortgage": {"purchase_price_cad": 350_000, "down_payment_cad": 17_500,
                         "property_tax_monthly_cad": 250, "heating_monthly_cad": 100,
                         "condo_fee_monthly_cad": 400, "occupancy": "owner",
                         "replaces_current_housing": True},
        },
        "source_path": "ClientSnapshot/C1_retail_student.md",
    },
    {   # ClientSnapshot/C2_retail_high_net_worth_lawyer.md
        "_id": "C2", "client_ref": "C2-HNW-001", "entity_type": "individual",
        "credit_score": 812,                                  # §3 TransUnion
        "annual_income_cad": 726_600,                         # §2 household income used by lender
        "housing_monthly_cad": 8_350,                         # §4 home mortgage + tax + heat
        "other_debt_monthly_cad": 6_025,                      # §4 rental condo, cards, HELOC, lease
        "contingent_debt_monthly_cad": 0,
        "liquid_assets_cad": 475_000,                         # §5
        "investable_assets_cad": 2_710_000,                   # §5 liquid + RRSP/TFSA + brokerage
        "property_value_cad": 4_200_000, "property_debt_cad": 1_020_000,  # §4 home mortgage + HELOC
        "foreclosure_last_months": None, "bankruptcy_last_months": None,
        "co_signer": None, "assets_by_bank": {}, "business": None,
        "default_requests": {
            "personal_line_of_credit": {"amount_cad": 150_000},
            "mortgage": {"purchase_price_cad": 1_100_000, "down_payment_cad": 385_000,
                         "property_tax_monthly_cad": 400, "heating_monthly_cad": 0,
                         "condo_fee_monthly_cad": 600, "rental_income_monthly_cad": 4_000,
                         "occupancy": "rental", "replaces_current_housing": False},
        },
        "source_path": "ClientSnapshot/C2_retail_high_net_worth_lawyer.md",
    },
    {   # ClientSnapshot/C3_business_tech_owner.md
        "_id": "C3", "client_ref": "C3-BIZ-001", "entity_type": "individual",
        "credit_score": 745,                                  # §3 Equifax
        "annual_income_cad": 315_000,                         # §2 household income used by lender
        "housing_monthly_cad": 4_650,                         # §4
        "other_debt_monthly_cad": 1_325,                      # §4 cards + car loan
        "contingent_debt_monthly_cad": 3_850,                 # §4 personally guaranteed business debt
        "liquid_assets_cad": 152_000,
        "investable_assets_cad": 382_000,                     # §5 liquid + registered + brokerage
        "property_value_cad": 1_350_000, "property_debt_cad": 640_000,
        "foreclosure_last_months": None, "bankruptcy_last_months": None,
        "co_signer": None, "assets_by_bank": {},
        "business": {"name": "Lumenwave Software Inc.", "months_in_business": 108,   # §2 founded 2017
                     "annual_revenue_cad": 4_800_000, "business_debt_cad": 268_000,  # §4 guaranteed debts
                     "primary_account_bank": None},
        "default_requests": {
            "personal_line_of_credit": {"amount_cad": 50_000},
            "mortgage": {"purchase_price_cad": 1_800_000, "down_payment_cad": 650_000,
                         "property_tax_monthly_cad": 720, "heating_monthly_cad": 250,
                         "occupancy": "owner", "replaces_current_housing": True},
            "business_credit_card": {},
        },
        "source_path": "ClientSnapshot/C3_business_tech_owner.md",
    },
    {   # ClientSnapshot/C4_business_walmart_finance_dept.md
        "_id": "C4", "client_ref": "C4-CORP-001", "entity_type": "corporation",
        "credit_score": None,                                 # corporate: internal rating 2/9, commercial score 82/100
        "annual_income_cad": None, "housing_monthly_cad": 0, "other_debt_monthly_cad": 0,
        "contingent_debt_monthly_cad": 0, "liquid_assets_cad": 600_000_000,
        "investable_assets_cad": 0, "property_value_cad": 0, "property_debt_cad": 0,
        "foreclosure_last_months": None, "bankruptcy_last_months": None,
        "co_signer": None, "assets_by_bank": {},
        "business": {"name": "Walmart Finance Dept (synthetic)", "months_in_business": 168,
                     "annual_revenue_cad": 20_000_000_000, "business_debt_cad": 2_400_000_000,
                     "primary_account_bank": None},
        "default_requests": {},
        "source_path": "ClientSnapshot/C4_business_walmart_finance_dept.md",
    },
]


def seed_client_financials(db) -> int:
    """Upsert the profiles into `client_financials` (idempotent)."""
    now = datetime.now(timezone.utc)
    for doc in CLIENT_FINANCIALS:
        db[COLLECTION].replace_one({"_id": doc["_id"]}, {**doc, "updated_at": now,
                                                         "visibility": "underwriter"}, upsert=True)
    return len(CLIENT_FINANCIALS)
