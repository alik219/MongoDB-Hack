---
bank: TD
product: mortgage
policy_id: TD-MORTGAGE-2026-09
version: "4.0"
effective_date: 2026-09-01
status: current
simulated: true
---

> **SIMULATED POLICY — NOT A REAL TD DOCUMENT.**
> Fictional thresholds created for the MongoDB Agents-in-Context hackathon.
> Does not reflect any actual TD Bank product or underwriting rule.

# TD Residential Mortgage — Approval Policy

## Positioning
TD lends on **broad eligibility**. It supports insured, low-down-payment
borrowers, allows a longer amortization, and permits higher debt-service ratios
than RBC. Income must still be documented — TD does not use asset-based income.

## Decision rules (machine-checkable)

```yaml
decision_rules:
  min_credit_score: 660
  min_annual_income: 45000               # CAD, documented & recurring
  max_gds: 0.39                          # gross debt service ratio
  max_tds: 0.44                          # total debt service ratio
  min_down_payment_pct: 0.10             # insured lending supported
  max_amortization_years: 30
  stress_test:
    qualifying_rate: "max(contract_rate + 0.02, 0.0525)"
  asset_based_income_allowed: false
  auto_decline_if:
    - credit_score < 620
    - down_payment_pct < 0.05
    - foreclosure_last_months < 60
```

## How a decision is made
1. **Hard gates.** Any `auto_decline_if` → declined.
2. **Affordability.** GDS and TDS are computed at the stress-test qualifying rate;
   both must sit under the (more generous) ceilings.
3. **Equity.** As little as 10% down is accepted; below 10% is a decline.
4. **Income.** Documented, recurring income only.

## Notes for reviewers
- TD's lower score floor (660) and 10% down make it the bank most likely to
  approve a mid-market retail borrower that RBC turns away. It still fails the
  high-net-worth, low-income applicant, because it won't count assets as income.
