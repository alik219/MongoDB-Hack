---
bank: RBC
product: personal_line_of_credit
policy_id: RBC-PLC-2026-09
version: "2.4"
effective_date: 2026-09-01
status: current
simulated: true
---

> **SIMULATED POLICY — NOT A REAL RBC DOCUMENT.**
> Fictional thresholds created for the MongoDB Agents-in-Context hackathon.
> Does not reflect any actual Royal Bank of Canada product or underwriting rule.

# RBC Personal Line of Credit (PLC) — Approval Policy

## Positioning
RBC's unsecured PLC is a **prime-credit product**. Unsecured limits are kept
modest relative to income; larger borrowing is pushed toward a secured
(home-equity) line. Approval leans on credit score and total debt service.

## Decision rules (machine-checkable)

```yaml
decision_rules:
  min_credit_score: 700
  min_annual_income: 50000               # CAD
  max_tds: 0.40                          # total debt service ratio
  unsecured:
    limit_formula: "0.50 * annual_income"
    cap: 50000
    floor: 5000
  secured:
    max_ltv: 0.65                         # against home equity
    available_if: "property_equity > 0"
  asset_based_income_allowed: false
  auto_decline_if:
    - credit_score < 660
    - annual_income < 35000
    - tds_after_new_limit > 0.45
```

## How a decision is made
1. **Hard gates.** Any `auto_decline_if` → declined.
2. **Threshold check.** Score ≥ 700, income ≥ $50k, and projected TDS (including
   the new line's required payment) under 40%.
3. **Limit.** Unsecured = 50% of annual income, capped at $50,000. If the
   applicant has home equity and wants more, offer a **secured** line up to 65%
   LTV instead.

## Notes for reviewers
- RBC caps unsecured borrowing tightly, so a high earner wanting a large line is
  steered to the secured product — a point worth showing against TD's and CIBC's
  more generous unsecured formulas.
