---
bank: CIBC
product: business_credit_card
policy_id: CIBC-BUCREDIT-2026-09
version: "3.1"
effective_date: 2026-09-01
status: current
simulated: true
---

> **SIMULATED POLICY — NOT A REAL CIBC DOCUMENT.**
> Fictional thresholds created for the MongoDB Agents-in-Context hackathon.
> Does not reflect any actual CIBC product or underwriting rule.

# CIBC Business Credit Card — Approval Policy

## Positioning
CIBC underwrites on the **existing relationship**. Standard floors sit between
RBC and TD, but an existing CIBC deposit relationship or assets under management
relaxes the score and tenure gates and raises the limit. A new-to-bank applicant
is held to stricter standards.

## Decision rules (machine-checkable)

```yaml
decision_rules:
  min_principal_credit_score: 680
  min_principal_credit_score_if_relationship: 640   # applies if cibc_deposit_balance >= 25000
  min_months_in_business: 18
  min_months_in_business_if_primary_account: 6       # applies if primary business account at CIBC
  min_annual_business_revenue: 100000      # CAD
  max_business_debt_to_revenue: 0.40
  personal_guarantee_required: true
  security_deposit_required: false
  credit_limit:
    formula_if_aum_ge_250000: "0.12 * annual_business_revenue"
    formula_default: "0.08 * annual_business_revenue"
    cap: 75000
    floor: 3000
  auto_decline_if:
    - principal_credit_score < 620
    - months_in_business < 6
    - bankruptcy_last_months < 72
```

## How a decision is made
1. **Hard gates.** Any `auto_decline_if` → declined.
2. **Relationship adjustment.** If the client holds ≥ $25,000 in CIBC deposits,
   the score floor drops to 640. If CIBC is the primary business account, the
   tenure floor drops to 6 months.
3. **Threshold check.** Apply the adjusted floors, then check revenue and debt
   ratio.
4. **Limit.** Clients with ≥ $250,000 AUM at CIBC get 12% of revenue; everyone
   else 8%, capped at $75,000.

## Notes for reviewers
- The relationship waivers let an established CIBC client clear a gate they would
  miss at RBC. A client with no CIBC relationship is held to the full 680 / 18-month
  standard.
