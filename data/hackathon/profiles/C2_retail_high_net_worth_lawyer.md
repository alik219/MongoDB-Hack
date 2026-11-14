# C2 — Jonathan Whitfield (Retail High-Net-Worth: Wealthy Lawyer)

> **SYNTHETIC DATA.** Every person, employer, number and ID below is invented for a demo. The SIN is a placeholder that can never be issued.

## How to read this file (for interns and non-technical readers)
- **Sections 1 to 5** are the client's *facts*.
- **Section 6** applies lender rules of thumb (*assumptions*) to those facts for credit card, line of credit (including a home-equity line, HELOC) and mortgage.
- **Section 7** lists the *calculated* ratios with the formulas shown.
- **Section 8** says which fields an advisor can see, see masked, or never see.
- Thresholds are industry rules of thumb, **not fixed law**, and vary by lender.

## At a glance
| # | Statement | Type |
|---|---|---|
| 1 | Jonathan is a 45-year-old equity partner at a law firm with household income of about **$726,600/yr** (lender view) and net worth of about **$8.11M**. | Fact / Calculated |
| 2 | Credit is excellent: score **812**, utilization **6.7%**, 24-year history, no late payments. | Fact |
| 3 | Expected outcomes: **credit card = Approve (premium)**, **line of credit = Approve (large)**, **mortgage = Approve** (rental purchase TDS **32.6%**). | Calculated |

**Risk and mitigation:** Strong ratios hide concentration risk: about 69% of assets are real estate ($6.65M of $9.66M) and income depends on partnership profit share that swings year to year ($195,000 vs $245,000). Mitigation is to average variable income over 2 years (done here), keep the stress test on even for wealthy clients, and review liquidity (liquid net worth is about $469,000 against $1.55M of debt). Because this is the richest retail file, it is also the most valuable to an attacker, so SIN and full credit report must stay hidden from advisors and every view must be logged.

---

## 1. Identity and stability
| Field | Value |
|---|---|
| Client ID | C2-HNW-001 |
| Name | Jonathan Whitfield |
| Age | 45 |
| Marital status | Married (spouse Elena, 43, physician, part-time) |
| Dependants | 2 (ages 12 and 9) |
| Residency status | Canadian citizen |
| SIN | 000-000-002 (placeholder) |
| Consent to pull credit report | Yes, signed 2026-10-28 |
| Housing | Owns primary home (Rosedale, Toronto) |
| Time at current address | 9 years |

## 2. Income and employment
| Field | Value |
|---|---|
| Employer | Harlow & Pryce LLP (fictional law firm) |
| Role / type | Equity partner (self-employed partnership income) |
| Time as partner | 11 years |
| Base draw | $400,000 |
| Profit share | 2024: $195,000; 2025: $245,000; **2-year average $220,000** |
| **Jonathan's gross annual income** | **$620,000** ($400,000 + $220,000) |
| Spouse income | $85,000 |
| Rental income (condo) | $3,600/month rent; lender counts **50%** = $1,800/month = $21,600/yr |
| **Household income used by lender** | **$726,600/yr = $60,550/month** |
| Documents on file | 2 Notices of Assessment (NOAs), firm partnership statement |

## 3. Credit profile
| Field | Value |
|---|---|
| Credit score (TransUnion) | 812 |
| Length of credit history | 24 years |
| Tradelines | 9 |
| Cards | Visa Infinite Privilege ($50,000), Mastercard World Elite ($30,000), Amex Gold ($10,000) |
| Credit utilization | $6,000 / $90,000 = **6.7%** |
| Late payments / collections | None |
| Bankruptcy / consumer proposal | None |
| Hard inquiries, last 12 months | 2 |

## 4. Liabilities
| Debt | Balance | Limit | Monthly payment | Notes |
|---|---|---|---|---|
| Primary home mortgage | $900,000 | n/a | $5,400 | 4.20%, renews 2028 |
| Primary home property tax | | | $2,600 | Housing cost |
| Primary home heating | | | $350 | Housing cost |
| Home equity line of credit (HELOC) | $120,000 | $400,000 | $595 | Interest only at 5.95% (assumed) |
| Rental condo mortgage | $520,000 | n/a | $2,900 | Plus condo fee $650 and tax $300 = $3,850 total |
| Credit cards (3) | $6,000 | $90,000 | $180 | 3% of balance assumed |
| Car lease | n/a | | $1,400 | 20 months remaining |
| Support payments / co-signed loans | none | | | |
| **Housing cost (home)** | | | **$8,350** | $5,400 + $2,600 + $350 |
| **Other debt payments** | | | **$6,025** | $3,850 + $180 + $595 + $1,400 |

## 5. Assets and net worth
| Bucket | Item | Value |
|---|---|---|
| Liquid | Chequing $85,000, high-interest savings $240,000, cashable GICs $150,000 | $475,000 |
| Registered | RRSP $780,000, TFSA $105,000 | $885,000 |
| Registered (excluded) | RESP for two children $70,000 | Not counted (belongs to the children) |
| Non-registered | Brokerage account | $1,350,000 |
| Real estate | Home $4,200,000; cottage (Muskoka, no mortgage) $1,600,000; rental condo $850,000 | $6,650,000 |
| Other | Law-firm partnership capital | $300,000 |
| **Total assets** | | **$9,660,000** |

| Measure | Formula | Result |
|---|---|---|
| Liabilities counted | $900,000 + $520,000 + $120,000 + $6,000 | $1,546,000 |
| Total net worth | $9,660,000 − $1,546,000 | **$8,114,000** |
| Real estate net worth | $6,650,000 − ($900,000 + $520,000 + $120,000) | **$5,110,000** |
| Liquid net worth | $475,000 − $6,000 (cards) | **$469,000** |
| Monthly living expenses (fact) | | $18,000 |
| Emergency fund | $475,000 / $18,000 | **26.4 months** |

(The car lease is an obligation but not a balance-sheet loan, so it is in the payment ratios only.)

## 6. Product checks

### 6a. Credit card
| Check | Client | Typical rule | Result |
|---|---|---|---|
| Household income | $726,600 | Visa Infinite style: about $100,000 household | Pass |
| Personal income | $620,000 | About $60,000 | Pass |
| Score / utilization | 812 / 6.7% | 700+ / under 30% | Pass |
| Existing cards / inquiries | 3 / 2 | Reasonable | Pass |
| **Decision** | | | **APPROVE**, premium tier with a limit increase to $75,000 |

### 6b. Line of credit
**Unsecured request: $150,000**
| Check | Client | Typical rule | Result |
|---|---|---|---|
| Credit score | 812 | About 680+ | Pass |
| TDS | 23.7% | Under 44% | Pass |
| Income stability | 11 years as partner | Stable | Pass |
| **Decision** | | | **APPROVE** |

**Secured (HELOC) headroom on the home** (value $4,200,000)
| Step | Calculation | Result |
|---|---|---|
| Revolving cap (65% LTV) | $4,200,000 x 65% | $2,730,000 |
| Combined cap with mortgage (80% LTV) | $4,200,000 x 80% = $3,360,000 | |
| Room after mortgage | $3,360,000 − $900,000 | $2,460,000 |
| **Maximum HELOC limit** | smaller of $2,730,000 and $2,460,000 | **$2,460,000** |
| Current combined LTV | ($900,000 + $120,000) / $4,200,000 | 24.3% |

### 6c. Mortgage (scenario: buy a second rental property)
Purchase $1,100,000, down payment $385,000 (35%) from the brokerage account (90 days of statements), mortgage $715,000, expected rent $4,000/month (50% counted = $2,000).

| Check | Calculation | Result |
|---|---|---|
| LTV | $715,000 / $1,100,000 | 65.0% |
| Contract payment | $715 (thousands) x $5.81 | $4,154/mo (for information) |
| Stress-test payment | $715 x $7.00 | **$5,005/mo** |
| New property tax + condo fee | $400 + $600 | $1,000 |
| Monthly income with 50% of new rent | $60,550 + $2,000 | $62,550 |
| **TDS** | ($8,350 + $6,025 + $5,005 + $1,000) / $62,550 | **32.6%** (max 44%) |
| Closing costs (1.5%) | $1,100,000 x 1.5% | $16,500, covered by liquid assets |
| **Decision** | | **APPROVE** |

## 7. Ratio summary
| Ratio | Formula | Value | Usual limit |
|---|---|---|---|
| GDS (current home) | $8,350 / $60,550 | **13.8%** | 39% |
| TDS (current) | ($8,350 + $6,025) / $60,550 | **23.7%** | 44% |
| TDS (with new rental, stressed) | see 6c | 32.6% | 44% |
| Debt-to-income | $1,546,000 / $726,600 | 2.13 | Lower is better |
| Credit utilization | $6,000 / $90,000 | 6.7% | Under 30% |
| Combined LTV (home) | $1,020,000 / $4,200,000 | 24.3% | 80% max |
| Emergency fund | $475,000 / $18,000 | 26.4 months | 3 to 6 months |

## 8. Field sensitivity (Track 1 policy idea)
| Field | Advisor sees | Notes |
|---|---|---|
| SIN | **Hidden** | "On file: yes" only |
| Credit score | **Band only** ("Exceptional 800+") | |
| Full credit report | **Hidden** | Pull under audit only |
| Net worth, ratios, asset buckets | Visible | |
| Account balances by account | **Masked** to bucket totals | Higher-risk for this client |
| Spouse details | **Masked** | Third-party data |
| Every access | **Logged**, with an alert on bulk views | HNW files are high-value targets |

## 9. Assumptions used in this file
| Assumption | Value |
|---|---|
| Contract / qualifying mortgage rate | 4.99% / 6.99% |
| Stress payment factor | about $7.00/month per $1,000 (25-year amortization) |
| Contract payment factor | about $5.81/month per $1,000 |
| Card payment assumed | 3% of balance |
| HELOC payment | Interest only at 5.95% (assumed rate) |
| Rental income counted | 50% of gross rent |
| Variable income | Averaged over 2 years |
| HELOC caps | 65% revolving, 80% combined with mortgage |
| Maximum GDS / TDS | 39% / 44% |
