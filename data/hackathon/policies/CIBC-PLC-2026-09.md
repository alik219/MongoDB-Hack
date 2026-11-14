---
bank: CIBC
product: personal_line_of_credit
policy_id: CIBC-PLC-2026-09
version: "2.4"
effective_date: 2026-09-01
status: current
simulated: true
---

> **SIMULATED POLICY — NOT A REAL CIBC DOCUMENT.**
> Fictional thresholds created for the MongoDB Agents-in-Context hackathon.
> Does not reflect any actual CIBC product or underwriting rule.

# CIBC Personal Line of Credit (PLC) — Approval Policy

## Positioning
CIBC's PLC rewards **assets under management**. Standard floors are between RBC
and TD, but clients with investable assets at CIBC qualify for a much larger,
investment-secured limit, and the income floor can be waived.

## Decision rules (machine-checkable)

```yaml
decision_rules:
  min_credit_score: 670
  min_annual_income: 40000               # CAD; waived if investable_assets_at_cibc >= 250000
  max_tds: 0.42                          # total debt service ratio
  unsecured:
    limit_formula: "0.50 * annual_income"
    cap: 50000
    floor: 3000
  investment_secured:
    available_if: "investable_assets_at_cibc >= 500000"
    limit_formula: "0.30 * investable_assets_at_cibc"
    cap: 150000
  secured:
    max_ltv: 0.65                         # against home equity
    available_if: "property_equity > 0"
  asset_based_income_allowed: true
  auto_decline_if:
    - credit_score < 630
    - tds_after_new_limit > 0.47
```

## How a decision is made
1. **Hard gates.** Any `auto_decline_if` → declined.
2. **Income floor.** $40k minimum, **waived** if investable assets at CIBC ≥
   $250,000.
3. **Limit.** Unsecured = 50% of income, capped at $50,000. If investable assets
   at CIBC ≥ $500,000, an investment-secured line is offered instead: 30% of
   those assets, capped at $150,000.

## Notes for reviewers
- The investment-secured path gives a high-net-worth client a far larger line at
  CIBC than RBC's or TD's income-based formulas would allow — the relationship
  payoff, visible in a single number on stage.
