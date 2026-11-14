---
bank: RBC
product: business_credit_card
policy_id: RBC-BUCREDIT-2026-09
version: "3.1"
effective_date: 2026-09-01
status: current
simulated: true
---

> **SIMULATED POLICY — NOT A REAL RBC DOCUMENT.**
> Fictional thresholds created for the MongoDB Agents-in-Context hackathon.
> Does not reflect any actual Royal Bank of Canada product or underwriting rule.

# RBC Business Credit Card — Approval Policy

## Positioning
RBC positions its business card program as **premium and low-risk**. Approval
favours established businesses with strong principal credit. Thin-file or
early-stage applicants are routed to a secured product elsewhere, not this one.

## Decision rules (machine-checkable)

```yaml
decision_rules:
  min_principal_credit_score: 720
  min_months_in_business: 24
  min_annual_business_revenue: 150000      # CAD
  max_business_debt_to_revenue: 0.35       # existing business debt / annual revenue
  personal_guarantee_required: true
  security_deposit_required: false
  credit_limit:
    formula: "0.10 * annual_business_revenue"
    cap: 100000
    floor: 5000
  auto_decline_if:
    - principal_credit_score < 680
    - months_in_business < 12
    - bankruptcy_last_months < 84
```

## How a decision is made
1. **Hard gates.** Any `auto_decline_if` condition → declined, no exceptions.
2. **Threshold check.** All four thresholds (score, tenure, revenue, debt ratio)
   must pass. A single miss → declined with the specific reason.
3. **Limit.** If approved, limit = 10% of annual revenue, capped at $100,000.

## Notes for reviewers
- RBC does **not** offer a secured fallback on this policy; a near-miss applicant
  is declined rather than down-sold.
- The personal guarantee is mandatory for every approval.
