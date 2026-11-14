"""Four demo client profiles + who may see them.

All people, firms and identifiers are fictional. SINs start with 0, which is never
a valid SIN, so they can't collide with a real one. Money is in cents.

C1  RETAIL    / STUDENT        Maya Chen, U of T student
C2  RETAIL    / HIGH_NET_WORTH Daniel Okafor, law-firm partner
C3  BUSINESS  / OWNER_MANAGED  Priya Raman, founder of Lumen Ledger Inc. (SaaS)
C4  BUSINESS  / CORPORATE      Northmart Retail Corp., treasury / finance department
"""


def c(dollars):
    return int(round(dollars * 100))


# --- People who can sign in --------------------------------------------------
# Staff (advisors) are scoped to a book of clients; client users to their own client.
CLIENT_USERS = [
    {"_id": "adv_sam", "name": "Sam Leblanc", "kind": "staff", "role": "retail_advisor"},
    {"_id": "rm_jordan", "name": "Jordan Wu", "kind": "staff", "role": "commercial_rm"},
    {"_id": "c1_maya", "name": "Maya Chen", "kind": "client", "client_id": "C1", "role": "owner"},
    {"_id": "c2_daniel", "name": "Daniel Okafor", "kind": "client", "client_id": "C2", "role": "owner"},
    {"_id": "c3_priya", "name": "Priya Raman", "kind": "client", "client_id": "C3", "role": "owner"},
    {"_id": "c3_bookkeeper", "name": "Leo Martins", "kind": "client", "client_id": "C3", "role": "bookkeeper"},
    {"_id": "c4_ap_clerk", "name": "Ana Torres", "kind": "client", "client_id": "C4", "role": "ap_clerk"},
    {"_id": "c4_treasury", "name": "Kofi Mensah", "kind": "client", "client_id": "C4", "role": "treasury_analyst"},
    {"_id": "c4_controller", "name": "Rachel Kim", "kind": "client", "client_id": "C4", "role": "controller"},
    {"_id": "c4_cfo", "name": "Martin Gagnon", "kind": "client", "client_id": "C4", "role": "cfo"},
]

# What each role may do on a client profile. "pii" = unmasked SIN / DOB / insolvency detail.
ROLE_PERMS = {
    "owner": {"snapshot", "pii"},
    "retail_advisor": {"snapshot"},
    "commercial_rm": {"snapshot"},
    "bookkeeper": {"snapshot_business"},          # business side only, never the owner's personal file
    "ap_clerk": set(),
    "treasury_analyst": {"snapshot_business"},
    "controller": {"snapshot_business"},
    "cfo": {"snapshot_business"},
}


CLIENTS = [
    # ------------------------------------------------------------------ C1
    {
        "_id": "C1", "segment": "RETAIL", "tier": "STUDENT", "display_name": "Maya Chen",
        "members": [{"user_id": "c1_maya", "role": "owner"}],
        "advisors": [{"user_id": "adv_sam", "role": "retail_advisor"}],
        "identity": {
            "dob": "2005-03-14", "age": 21, "residency": "CITIZEN", "marital_status": "SINGLE",
            "dependants": 0, "sin": "000-000-101", "province": "ON", "years_at_address": 1,
            "housing": {"status": "RENT", "monthly_rent_cents": c(950), "note": "shared apartment"},
        },
        "income": {
            "employment_type": "PART_TIME", "employer": "Campus café", "occupation": "Barista / student",
            "years_with_employer": 1.5, "on_probation": False,
            "sources": [
                {"type": "EMPLOYMENT", "gross_annual_cents": c(14_000), "lender_count_pct": 100},
                {"type": "INTERNSHIP_SUMMER", "gross_annual_cents": c(9_000), "lender_count_pct": 50},
            ],
            "documents": ["2 recent pay stubs", "enrolment letter"],
        },
        "credit": {
            "bureau": "EQUIFAX", "score": 668, "history_years": 2.5, "tradelines": 2,
            "late_payments_24m": 1, "collections": 0, "insolvency": None, "hard_inquiries_6m": 2,
        },
        "liabilities": [
            {"type": "CREDIT_CARD", "lender": "Student Visa", "balance_cents": c(620),
             "limit_cents": c(1_500), "revolving": True},
            {"type": "STUDENT_LOC", "lender": "Bank student line", "balance_cents": c(9_000),
             "limit_cents": c(25_000), "monthly_payment_cents": c(55), "revolving": True,
             "note": "interest-only while in school"},
            {"type": "STUDENT_LOAN_GOV", "lender": "OSAP / NSLSC", "balance_cents": c(18_400),
             "monthly_payment_cents": 0, "status": "IN_SCHOOL",
             "note": "repayment starts 6 months after graduation"},
        ],
        "assets": [
            {"type": "CHEQUING", "category": "LIQUID", "value_cents": c(1_850)},
            {"type": "SAVINGS", "category": "LIQUID", "value_cents": c(3_200)},
            {"type": "TFSA", "category": "REGISTERED", "value_cents": c(2_500)},
        ],
        "housing_costs_monthly": {},
        "goals": ["Build credit history", "Pay down card before graduation", "Start FHSA after first job"],
    },
    # ------------------------------------------------------------------ C2
    {
        "_id": "C2", "segment": "RETAIL", "tier": "HIGH_NET_WORTH", "display_name": "Daniel Okafor",
        "members": [{"user_id": "c2_daniel", "role": "owner"}],
        "advisors": [{"user_id": "adv_sam", "role": "retail_advisor"}],
        "identity": {
            "dob": "1980-07-02", "age": 46, "residency": "CITIZEN", "marital_status": "MARRIED",
            "dependants": 2, "sin": "000-000-202", "province": "ON", "years_at_address": 9,
            "housing": {"status": "OWN"},
        },
        "income": {
            "employment_type": "PARTNER_PROFESSIONAL", "employer": "Harlow & Reid LLP (fictional)",
            "occupation": "Equity partner, corporate law", "years_with_employer": 14,
            "sources": [
                {"type": "PARTNERSHIP_DRAW", "gross_annual_cents": c(620_000), "lender_count_pct": 100,
                 "note": "use 2-year average from NOAs"},
                {"type": "SPOUSE_EMPLOYMENT", "gross_annual_cents": c(140_000), "lender_count_pct": 100},
                {"type": "RENTAL", "gross_annual_cents": c(36_000), "lender_count_pct": 50},
                {"type": "DIVIDENDS", "gross_annual_cents": c(42_000), "lender_count_pct": 100},
            ],
            "documents": ["2 years NOAs + T1 Generals", "partnership statement", "lease for rental condo"],
        },
        "credit": {
            "bureau": "EQUIFAX", "score": 812, "history_years": 24, "tradelines": 9,
            "late_payments_24m": 0, "collections": 0, "insolvency": None, "hard_inquiries_6m": 0,
        },
        "liabilities": [
            {"type": "MORTGAGE", "lender": "Big-5 bank", "balance_cents": c(1_100_000),
             "monthly_payment_cents": c(5_900), "secured_by": "RE_PRIMARY", "rate_pct": 4.19,
             "renewal": "2028-04-01"},
            {"type": "MORTGAGE", "lender": "Credit union", "balance_cents": c(310_000),
             "monthly_payment_cents": c(1_850), "secured_by": "RE_RENTAL", "rate_pct": 4.84,
             "renewal": "2027-09-01"},
            {"type": "HELOC", "lender": "Big-5 bank", "balance_cents": c(150_000), "limit_cents": c(500_000),
             "monthly_payment_cents": c(690), "secured_by": "RE_PRIMARY", "revolving": True},
            {"type": "CREDIT_CARD", "lender": "Visa Infinite Privilege", "balance_cents": c(18_000),
             "limit_cents": c(60_000), "revolving": True, "note": "paid in full monthly"},
            {"type": "AUTO_LEASE", "lender": "Captive finance", "balance_cents": c(41_000),
             "monthly_payment_cents": c(1_450)},
        ],
        "assets": [
            {"type": "CHEQUING", "category": "LIQUID", "value_cents": c(85_000)},
            {"type": "HISA", "category": "LIQUID", "value_cents": c(240_000)},
            {"type": "TFSA", "category": "REGISTERED", "value_cents": c(135_000)},
            {"type": "RRSP", "category": "REGISTERED", "value_cents": c(780_000)},
            {"type": "SPOUSAL_RRSP", "category": "REGISTERED", "value_cents": c(210_000)},
            {"type": "RESP", "category": "REGISTERED", "value_cents": c(160_000),
             "include_in_net_worth": False, "note": "belongs to the children's education plan"},
            {"type": "BROKERAGE", "category": "NON_REGISTERED", "value_cents": c(1_400_000)},
            {"type": "PARTNERSHIP_CAPITAL", "category": "BUSINESS", "value_cents": c(450_000), "illiquid": True},
            {"type": "VEHICLES", "category": "OTHER", "value_cents": c(90_000)},
            {"id": "RE_PRIMARY", "type": "PRIMARY_RESIDENCE", "category": "REAL_ESTATE",
             "value_cents": c(3_200_000), "city": "Toronto"},
            {"id": "RE_RENTAL", "type": "RENTAL_CONDO", "category": "REAL_ESTATE",
             "value_cents": c(720_000), "city": "Toronto"},
        ],
        "housing_costs_monthly": {"property_tax_cents": c(1_250), "heating_cents": c(320),
                                  "rental_condo_fees_cents": c(620)},
        "goals": ["Maximize RRSP / spousal RRSP", "Estate plan + trust for kids", "Consider 2nd rental"],
    },
    # ------------------------------------------------------------------ C3
    {
        "_id": "C3", "segment": "BUSINESS", "tier": "OWNER_MANAGED", "display_name": "Lumen Ledger Inc. / Priya Raman",
        "members": [{"user_id": "c3_priya", "role": "owner"}, {"user_id": "c3_bookkeeper", "role": "bookkeeper"}],
        "advisors": [{"user_id": "rm_jordan", "role": "commercial_rm"}],
        "identity": {
            "dob": "1988-11-20", "age": 38, "residency": "PERMANENT_RESIDENT", "marital_status": "COMMON_LAW",
            "dependants": 1, "sin": "000-000-303", "province": "ON", "years_at_address": 4,
            "housing": {"status": "OWN"},
        },
        "income": {
            "employment_type": "BUSINESS_OWNER", "employer": "Lumen Ledger Inc.", "occupation": "Founder & CEO",
            "years_with_employer": 6,
            "sources": [
                {"type": "SALARY_FROM_OWN_CORP", "gross_annual_cents": c(180_000), "lender_count_pct": 100},
                {"type": "DIVIDENDS_FROM_OWN_CORP", "gross_annual_cents": c(60_000), "lender_count_pct": 100,
                 "note": "2-year average"},
            ],
            "documents": ["2 years personal NOAs", "2 years corporate financial statements", "T2 returns"],
        },
        "credit": {
            "bureau": "TRANSUNION", "score": 755, "history_years": 15, "tradelines": 6,
            "late_payments_24m": 0, "collections": 0, "insolvency": None, "hard_inquiries_6m": 1,
        },
        "liabilities": [
            {"type": "MORTGAGE", "lender": "Big-5 bank", "balance_cents": c(640_000),
             "monthly_payment_cents": c(3_650), "secured_by": "RE_PRIMARY", "rate_pct": 4.39},
            {"type": "CREDIT_CARD", "lender": "Personal Amex", "balance_cents": c(4_200),
             "limit_cents": c(25_000), "revolving": True},
            {"type": "PERSONAL_GUARANTEE", "lender": "Bank (business LOC)", "balance_cents": 0,
             "contingent_cents": c(500_000), "note": "contingent; lenders may count it"},
        ],
        "assets": [
            {"type": "CHEQUING", "category": "LIQUID", "value_cents": c(28_000)},
            {"type": "TFSA", "category": "REGISTERED", "value_cents": c(102_000)},
            {"type": "RRSP", "category": "REGISTERED", "value_cents": c(145_000)},
            {"id": "RE_PRIMARY", "type": "PRIMARY_RESIDENCE", "category": "REAL_ESTATE",
             "value_cents": c(1_150_000), "city": "Waterloo"},
            {"type": "PRIVATE_COMPANY_SHARES", "category": "BUSINESS", "value_cents": c(24_800_000),
             "illiquid": True, "note": "62% of Lumen Ledger at last round's $40M post-money"},
        ],
        "housing_costs_monthly": {"property_tax_cents": c(480), "heating_cents": c(150)},
        "business": {
            "legal_name": "Lumen Ledger Inc. (fictional)", "entity_type": "CCPC", "bn": "000000303RC0001",
            "jurisdiction": "ON", "industry": "B2B SaaS (NAICS 5132)", "years_in_business": 6, "employees": 42,
            "beneficial_owners": [{"name": "Priya Raman", "pct": 62}, {"name": "Series A investors", "pct": 38}],
            "authorized_signatories": ["c3_priya"],
            "revenue_ttm_cents": c(9_600_000), "arr_cents": c(10_200_000), "gross_margin_pct": 78,
            "ebitda_ttm_cents": c(1_100_000),
            "current_assets_cents": c(4_900_000), "current_liabilities_cents": c(2_100_000),
            "cash_cents": c(3_400_000), "accounts_receivable_cents": c(1_300_000),
            "sred_receivable_cents": c(420_000),
            "debts": [
                {"type": "TERM_LOAN", "lender": "BDC", "balance_cents": c(1_500_000),
                 "annual_debt_service_cents": c(384_000)},
                {"type": "BUSINESS_LOC", "lender": "Big-5 bank", "balance_cents": c(250_000),
                 "limit_cents": c(1_000_000), "annual_debt_service_cents": c(20_000), "personal_guarantee": True},
                {"type": "CORPORATE_CARD", "lender": "Corporate Visa", "balance_cents": c(65_000),
                 "limit_cents": c(150_000), "annual_debt_service_cents": 0},
            ],
            "business_credit": {"bureau": "EQUIFAX_COMMERCIAL", "paydex_like_score": 78},
            "documents": ["2 years accountant-reviewed statements", "AR aging", "cap table", "SR&ED claim"],
        },
        "goals": ["Raise LOC to $2M ahead of US expansion", "Separate personal and business guarantees",
                  "Plan for a liquidity event"],
    },
    # ------------------------------------------------------------------ C4
    {
        "_id": "C4", "segment": "BUSINESS", "tier": "CORPORATE", "display_name": "Northmart Retail Corp. – Treasury",
        "members": [{"user_id": "c4_ap_clerk", "role": "ap_clerk"},
                    {"user_id": "c4_treasury", "role": "treasury_analyst"},
                    {"user_id": "c4_controller", "role": "controller"},
                    {"user_id": "c4_cfo", "role": "cfo"}],
        "advisors": [{"user_id": "rm_jordan", "role": "commercial_rm"}],
        "identity": None,          # no individual borrower; KYB lives under business
        "income": None, "credit": None, "liabilities": [], "assets": [], "housing_costs_monthly": {},
        "business": {
            "legal_name": "Northmart Retail Corp. (fictional)", "entity_type": "PUBLIC_CORPORATION",
            "bn": "000000404RC0001", "jurisdiction": "CANADA (CBCA)", "industry": "Big-box retail (NAICS 4552)",
            "years_in_business": 31, "employees": 88_000,
            "beneficial_owners": [], "beneficial_owner_note": "widely held; no holder > 25%",
            "authorized_signatories": ["c4_controller", "c4_cfo"],
            "board_resolution_on_file": True,
            "revenue_ttm_cents": c(28_000_000_000), "ebitda_ttm_cents": c(2_100_000_000),
            "current_assets_cents": c(6_400_000_000), "current_liabilities_cents": c(5_300_000_000),
            "cash_cents": c(850_000_000), "interest_expense_cents": c(190_000_000),
            "debts": [
                {"type": "SENIOR_NOTES", "balance_cents": c(3_000_000_000),
                 "annual_debt_service_cents": c(450_000_000)},
                {"type": "COMMERCIAL_PAPER", "balance_cents": c(400_000_000),
                 "annual_debt_service_cents": c(18_000_000)},
                {"type": "SYNDICATED_REVOLVER", "balance_cents": c(300_000_000), "limit_cents": c(1_500_000_000),
                 "annual_debt_service_cents": c(16_000_000)},
            ],
            "issuer_rating": {"agency": "illustrative", "rating": "BBB+"},
            "covenants": [{"name": "net_debt_to_ebitda_max", "value": 3.5},
                          {"name": "interest_coverage_min", "value": 3.0}],
            # Payment authority by role (used for the treasury transfer policy)
            "payment_limits_cents": {"ap_clerk": c(50_000), "treasury_analyst": c(1_000_000),
                                     "controller": c(10_000_000), "cfo": c(50_000_000)},
            "dual_approval_over_cents": c(10_000_000),
            "documents": ["audited annual report", "quarterly filings", "board borrowing resolution",
                          "signing authority matrix"],
        },
        "goals": ["Same-day vendor payments", "Optimize cash sweep across 400 store accounts",
                  "Keep revolver mostly undrawn"],
    },
]

# Bank accounts for the new clients (joins the existing accounts collection).
CLIENT_ACCOUNTS = [
    {"_id": "acc_c1_chq", "owner_ids": ["c1_maya"], "type": "CHEQUING", "balance_cents": c(1_850), "client_id": "C1"},
    {"_id": "acc_c1_sav", "owner_ids": ["c1_maya"], "type": "SAVINGS", "balance_cents": c(3_200), "client_id": "C1"},
    {"_id": "acc_c1_tfsa", "owner_ids": ["c1_maya"], "type": "TFSA", "balance_cents": c(2_500), "client_id": "C1"},
    {"_id": "acc_c2_chq", "owner_ids": ["c2_daniel"], "type": "CHEQUING", "balance_cents": c(85_000), "client_id": "C2"},
    {"_id": "acc_c2_sav", "owner_ids": ["c2_daniel"], "type": "SAVINGS", "balance_cents": c(240_000), "client_id": "C2"},
    {"_id": "acc_c2_tfsa", "owner_ids": ["c2_daniel"], "type": "TFSA", "balance_cents": c(135_000), "client_id": "C2"},
    {"_id": "acc_c2_rrsp", "owner_ids": ["c2_daniel"], "type": "RRSP", "balance_cents": c(780_000), "client_id": "C2"},
    {"_id": "acc_c3_chq", "owner_ids": ["c3_priya"], "type": "CHEQUING", "balance_cents": c(28_000), "client_id": "C3"},
    {"_id": "acc_c3_tfsa", "owner_ids": ["c3_priya"], "type": "TFSA", "balance_cents": c(102_000), "client_id": "C3"},
    {"_id": "acc_c3_biz_op", "owner_ids": ["c3_priya", "c3_bookkeeper"], "type": "CHEQUING",
     "balance_cents": c(3_400_000), "client_id": "C3", "business": True},
    {"_id": "acc_c4_operating", "owner_ids": ["c4_treasury", "c4_controller", "c4_cfo"], "type": "CHEQUING",
     "balance_cents": c(600_000_000), "client_id": "C4", "business": True},
    {"_id": "acc_c4_ap", "owner_ids": ["c4_ap_clerk", "c4_treasury", "c4_controller", "c4_cfo"], "type": "CHEQUING",
     "balance_cents": c(150_000_000), "client_id": "C4", "business": True},
    {"_id": "acc_c4_payroll", "owner_ids": ["c4_treasury", "c4_controller", "c4_cfo"], "type": "CHEQUING",
     "balance_cents": c(100_000_000), "client_id": "C4", "business": True},
]

CLIENT_ROOM = [
    {"user_id": "c1_maya", "account_type": "TFSA", "year": 2026, "room_cents": c(39_500)},
    {"user_id": "c1_maya", "account_type": "RRSP", "year": 2026, "room_cents": c(3_100)},
    {"user_id": "c2_daniel", "account_type": "TFSA", "year": 2026, "room_cents": c(7_000)},
    {"user_id": "c2_daniel", "account_type": "RRSP", "year": 2026, "room_cents": c(12_000)},
    {"user_id": "c3_priya", "account_type": "TFSA", "year": 2026, "room_cents": c(7_000)},
    {"user_id": "c3_priya", "account_type": "RRSP", "year": 2026, "room_cents": c(32_400)},
]


# --- Snapshot math (pure; no DB) ----------------------------------------------

def _monthly_payment(l):
    if "monthly_payment_cents" in l:
        return l["monthly_payment_cents"]
    if l.get("revolving"):
        return int(l["balance_cents"] * 0.03)   # common lender assumption: 3% of balance
    return 0


def personal_metrics(p):
    if not p.get("income"):
        return None
    assets = [a for a in p["assets"] if a.get("include_in_net_worth", True)]
    total_assets = sum(a["value_cents"] for a in assets)
    total_liab = sum(l["balance_cents"] for l in p["liabilities"])
    re_ids = {a.get("id") for a in assets if a["category"] == "REAL_ESTATE"}
    re_value = sum(a["value_cents"] for a in assets if a["category"] == "REAL_ESTATE")
    re_debt = sum(l["balance_cents"] for l in p["liabilities"] if l.get("secured_by") in re_ids)
    liquid = sum(a["value_cents"] for a in assets if a["category"] == "LIQUID")
    unsecured_revolving = sum(l["balance_cents"] for l in p["liabilities"]
                              if l.get("revolving") and not l.get("secured_by"))
    revolving = [l for l in p["liabilities"] if l.get("revolving") and l.get("limit_cents")]
    util = (sum(l["balance_cents"] for l in revolving) / sum(l["limit_cents"] for l in revolving)) if revolving else None

    income_m = sum(s["gross_annual_cents"] * s["lender_count_pct"] / 100 for s in p["income"]["sources"]) / 12
    h = p.get("housing_costs_monthly", {})
    primary_housing = sum(_monthly_payment(l) for l in p["liabilities"] if l.get("secured_by") == "RE_PRIMARY") \
        + h.get("property_tax_cents", 0) + h.get("heating_cents", 0) \
        + p["identity"]["housing"].get("monthly_rent_cents", 0)
    other_debt = sum(_monthly_payment(l) for l in p["liabilities"] if l.get("secured_by") != "RE_PRIMARY") \
        + h.get("rental_condo_fees_cents", 0) // 2
    return {
        "total_assets": total_assets, "total_liabilities": total_liab,
        "net_worth": total_assets - total_liab,
        "real_estate_value": re_value, "real_estate_debt": re_debt,
        "real_estate_net_worth": re_value - re_debt,
        "liquid_assets": liquid, "liquid_net_worth": liquid - unsecured_revolving,
        "illiquid_assets": sum(a["value_cents"] for a in assets if a.get("illiquid")),
        "credit_utilization": round(util, 3) if util is not None else None,
        "gross_monthly_income_for_lending": int(income_m),
        "gds": round(primary_housing / income_m, 3) if income_m else None,
        "tds": round((primary_housing + other_debt) / income_m, 3) if income_m else None,
        "contingent_liabilities": sum(l.get("contingent_cents", 0) for l in p["liabilities"]),
    }


def business_metrics(b):
    if not b:
        return None
    debt = sum(d["balance_cents"] for d in b["debts"])
    service = sum(d.get("annual_debt_service_cents", 0) for d in b["debts"])
    out = {
        "revenue_ttm": b["revenue_ttm_cents"], "ebitda_ttm": b["ebitda_ttm_cents"],
        "ebitda_margin": round(b["ebitda_ttm_cents"] / b["revenue_ttm_cents"], 3),
        "total_debt": debt,
        "net_debt": debt - b["cash_cents"],
        "current_ratio": round(b["current_assets_cents"] / b["current_liabilities_cents"], 2),
        "dscr": round(b["ebitda_ttm_cents"] / service, 2) if service else None,
        "debt_to_ebitda": round(debt / b["ebitda_ttm_cents"], 2),
        "net_debt_to_ebitda": round((debt - b["cash_cents"]) / b["ebitda_ttm_cents"], 2),
    }
    if b.get("interest_expense_cents"):
        out["interest_coverage"] = round(b["ebitda_ttm_cents"] / b["interest_expense_cents"], 2)
    breaches = []
    for cov in b.get("covenants", []):
        if cov["name"] == "net_debt_to_ebitda_max" and out["net_debt_to_ebitda"] > cov["value"]:
            breaches.append(cov["name"])
        if cov["name"] == "interest_coverage_min" and out.get("interest_coverage", 99) < cov["value"]:
            breaches.append(cov["name"])
    out["covenant_breaches"] = breaches
    return out
