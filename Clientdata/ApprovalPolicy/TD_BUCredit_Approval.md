---
bank: TD
product: business_credit_card
policy_id: TD-BUCREDIT-2026-09
version: "3.1"
effective_date: 2026-09-01
status: current
simulated: true
---

> **SIMULATED POLICY — NOT A REAL TD DOCUMENT.**
> Fictional thresholds created for the MongoDB Agents-in-Context hackathon.
> Does not reflect any actual TD Bank product or underwriting rule.

# TD Business Credit Card — Approval Policy

## Positioning
TD runs a **high-volume, access-first** business card program. Score and revenue
floors are lower than RBC's, and thinner-file applicants are *approved on a
secured basis* rather than declined. The trade-off is smaller limits and a
security deposit for weaker credit.

## Decision rules (machine-checkable)

```yaml
decision_rules:
  min_principal_credit_score: 660
  min_months_in_business: 12
  min_annual_business_revenue: 75000       # CAD
  max_business_debt_to_revenue: 0.50       # existing business debt / annual revenue
  personal_guarantee_required: true
  security_deposit_required_if: "principal_credit_score < 700"
  credit_limit:
    formula: "0.08 * annual_business_revenue"
    cap: 50000
    floor: 2000
  auto_decline_if:
    - principal_credit_score < 620
    - months_in_business < 6
    - bankruptcy_last_months < 60
```

## How a decision is made
1. **Hard gates.** Any `auto_decline_if` → declined.
2. **Threshold check.** Score, tenure, revenue, and debt ratio must pass.
3. **Security.** If the score is between 620 and 699, the card is approved
   **secured** (a deposit equal to the limit is required). Score ≥ 700 is
   unsecured.
4. **Limit.** 8% of annual revenue, capped at $50,000.

## Notes for reviewers
- Where RBC declines a mid-600s applicant outright, TD approves them on a secured
  basis — a clean cross-bank contrast for the demo.
