---
bank: RBC
product: mortgage
policy_id: RBC-MORTGAGE-2026-09
version: "4.0"
effective_date: 2026-09-01
status: current
simulated: true
---

> **SIMULATED POLICY — NOT A REAL RBC DOCUMENT.**
> Fictional thresholds created for the MongoDB Agents-in-Context hackathon.
> Does not reflect any actual Royal Bank of Canada product or underwriting rule.

# RBC Residential Mortgage — Approval Policy

## Positioning
RBC underwrites mortgages **conservatively**. It prioritizes borrowers with
strong credit, provable income, and meaningful equity. Debt-service ceilings are
the tightest of the three banks, and RBC does not offer asset-based income
qualification — income must be documented and recurring.

## Decision rules (machine-checkable)

```yaml
decision_rules:
  min_credit_score: 700
  min_annual_income: 60000               # CAD, documented & recurring
  max_gds: 0.35                          # gross debt service ratio
  max_tds: 0.42                          # total debt service ratio
  min_down_payment_pct: 0.20             # focus on uninsured lending
  max_amortization_years: 25
  stress_test:
    qualifying_rate: "max(contract_rate + 0.02, 0.0525)"
  asset_based_income_allowed: false
  auto_decline_if:
    - credit_score < 660
    - down_payment_pct < 0.10
    - foreclosure_last_months < 84
```

## How a decision is made
1. **Hard gates.** Any `auto_decline_if` → declined.
2. **Affordability.** Recompute GDS and TDS using the **stress-test** qualifying
   rate, not the contract rate. Both must sit under the ceilings.
3. **Equity.** Down payment must be at least 20%; between 10–20% is a decline on
   this policy (RBC routes insured lending through a different program).
4. **Income.** Only documented, recurring income counts. Investable assets do
   **not** substitute for income here.

## Notes for reviewers
- The combination of a 700 score floor, 20% down, and asset-income **not**
  allowed is what makes a high-net-worth, low-income applicant fail at RBC while
  passing at CIBC — a clean cross-bank contrast for the demo.
