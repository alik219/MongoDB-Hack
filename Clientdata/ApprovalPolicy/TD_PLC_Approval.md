---
bank: TD
product: personal_line_of_credit
policy_id: TD-PLC-2026-09
version: "2.4"
effective_date: 2026-09-01
status: current
simulated: true
---

> **SIMULATED POLICY — NOT A REAL TD DOCUMENT.**
> Fictional thresholds created for the MongoDB Agents-in-Context hackathon.
> Does not reflect any actual TD Bank product or underwriting rule.

# TD Personal Line of Credit (PLC) — Approval Policy

## Positioning
TD's PLC is **accessible**: the lowest score and income floors of the three
banks, and the most lenient TDS ceiling. Unsecured limits are smaller than RBC's
to offset the wider approval band.

## Decision rules (machine-checkable)

```yaml
decision_rules:
  min_credit_score: 650
  min_annual_income: 35000               # CAD
  max_tds: 0.44                          # total debt service ratio
  unsecured:
    limit_formula: "0.40 * annual_income"
    cap: 35000
    floor: 3000
  secured:
    max_ltv: 0.70                         # against home equity
    available_if: "property_equity > 0"
  asset_based_income_allowed: false
  auto_decline_if:
    - credit_score < 600
    - annual_income < 25000
    - tds_after_new_limit > 0.49
```

## How a decision is made
1. **Hard gates.** Any `auto_decline_if` → declined.
2. **Threshold check.** Score ≥ 650, income ≥ $35k, projected TDS under 44%.
3. **Limit.** Unsecured = 40% of annual income, capped at $35,000. Home equity
   can back a secured line up to 70% LTV.

## Notes for reviewers
- TD approves the widest range of applicants but offers the smallest unsecured
  limit, versus RBC's stricter gate / larger cap and CIBC's asset-boosted cap.
