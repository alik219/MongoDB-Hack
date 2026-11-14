---
bank: CIBC
product: mortgage
policy_id: CIBC-MORTGAGE-2026-09
version: "4.0"
effective_date: 2026-09-01
status: current
simulated: true
---

> **SIMULATED POLICY — NOT A REAL CIBC DOCUMENT.**
> Fictional thresholds created for the MongoDB Agents-in-Context hackathon.
> Does not reflect any actual CIBC product or underwriting rule.

# CIBC Residential Mortgage — Approval Policy

## Positioning
CIBC is the only one of the three banks that offers **asset-based income
qualification**. A client with significant investable assets held at CIBC but
modest documented income can still qualify — assets are converted to an income
equivalent. This is the defining difference from RBC and TD.

## Decision rules (machine-checkable)

```yaml
decision_rules:
  min_credit_score: 680
  min_annual_income: 50000               # CAD; waived if asset-qualified (see below)
  max_gds: 0.37                          # gross debt service ratio
  max_tds: 0.43                          # total debt service ratio
  min_down_payment_pct: 0.15
  min_down_payment_pct_if_assets_ge_500000: 0.10   # investable assets at CIBC
  max_amortization_years: 30
  stress_test:
    qualifying_rate: "max(contract_rate + 0.02, 0.0525)"
  asset_based_income_allowed: true
  asset_based_income:
    formula: "investable_assets_at_cibc / 180"   # monthly income equivalent
    note: "Adds to documented income for GDS/TDS. Satisfies min_annual_income when total qualifies."
  auto_decline_if:
    - credit_score < 640
    - down_payment_pct < 0.05
    - foreclosure_last_months < 72
```

## How a decision is made
1. **Hard gates.** Any `auto_decline_if` → declined.
2. **Qualifying income.** Documented income **plus** asset-based income
   (investable assets at CIBC ÷ 180 months) forms the income used for GDS/TDS.
   If documented income is below $50k but total qualifying income clears the
   ratios, the minimum-income floor is treated as met.
3. **Affordability.** GDS and TDS at the stress-test rate must sit under the
   ceilings.
4. **Equity.** 15% down normally; 10% if investable assets at CIBC ≥ $500,000.

## Notes for reviewers
- This is the key demo file: a high-net-worth client with low documented income
  **passes at CIBC** on asset-based income but is **declined at RBC and TD**,
  which require documented income only. Same client, three banks, different result.
