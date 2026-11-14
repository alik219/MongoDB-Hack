# C3 — Priya Raman / Lumenwave Software Inc. (Business: Tech Business Owner)

> **SYNTHETIC DATA.** Every person, company, number and ID below is invented for a demo. The SIN and business number are placeholders.

## How to read this file (for interns and non-technical readers)
- This client is a **business owner**, so lenders look at *two* things: Priya personally, and her company. Personal products (card, line of credit, mortgage) are decided on **personal** income, but debts she has personally guaranteed for the company can still count against her.
- **Sections 1 to 5** are *facts*. **Section 6** applies lender rules (*assumptions*). **Section 7** shows *calculated* ratios with formulas. **Section 8** is the field-visibility policy.
- Thresholds are industry rules of thumb, **not fixed law**, and vary by lender.

## At a glance
| # | Statement | Type |
|---|---|---|
| 1 | Priya, 38, owns 80% of a 9-year-old software company and earns **$275,000/yr** on a 2-year average (household **$315,000**). | Fact / Calculated |
| 2 | Personal credit is good (score **745**, utilization **25%**), but she has **$268,000** of business debt personally guaranteed. | Fact |
| 3 | Expected outcomes: **credit card = Approve**, **line of credit = Approve**, **mortgage = Refer** (passes at **39.4%** TDS, fails at **54.1%** if guaranteed debts are counted). | Calculated |

**Risk and mitigation:** The key risk is hidden leverage. Guaranteed business loans do not show up as personal mortgage-style debt, yet if the company stumbles the lender can call on Priya personally, and about $2.8M of her net worth is unverified business equity. Mitigation is to ask whether the company, not Priya, makes those payments (with 24 months of company statements), run the ratios both with and without the guaranteed payments, and value the business conservatively or exclude it. Self-employed income is also variable, so use 2 years of Notices of Assessment (NOAs). Her file mixes personal and company data, so advisors should see ratios and bands, not raw tax returns or full credit reports.

---

## 1. Identity and stability
| Field | Value |
|---|---|
| Client ID | C3-BIZ-001 |
| Name | Priya Raman |
| Age | 38 |
| Marital status | Married (spouse Arjun, 39, part-time consultant) |
| Dependants | 1 (age 5) |
| Residency status | Canadian citizen |
| SIN | 000-000-003 (placeholder) |
| Consent to pull credit report | Yes (personal and business), signed 2026-11-03 |
| Housing | Owns home, Mississauga |
| Time at current address | 6 years |

## 2. Income and employment
| Field | Value |
|---|---|
| Business | Lumenwave Software Inc. (fictional) |
| Business number | 000000000 RC0001 (placeholder) |
| Type | Software-as-a-service (SaaS), incorporated, founded 2017 |
| Ownership / role | 80% owner, founder and CEO |
| Employment type | Self-employed (paid by salary + dividends) |
| Time in business | 9 years |
| Company revenue (2025) | $4.8M, pre-tax profit $780,000, 14 employees |
| Personal income, T1 line 15000 | 2024: $255,000; 2025: $295,000 |
| **Gross annual income (2-year average)** | **$275,000** ($120,000 salary + dividends) |
| Spouse income | $40,000 |
| **Household income used by lender** | **$315,000/yr = $26,250/month** |
| Documents on file | 2 NOAs (T1 Generals), 2 years of corporate financial statements |

## 3. Credit profile
| Field | Value |
|---|---|
| Credit score (Equifax) | 745 |
| Length of credit history | 15 years |
| Tradelines | 7 |
| Credit utilization (personal cards) | $7,500 / $30,000 = **25.0%** |
| Late payments / collections | None |
| Bankruptcy / consumer proposal | None |
| Hard inquiries, last 12 months | 3 (one was for a business facility) |

## 4. Liabilities

**Personal debts**
| Debt | Balance | Limit | Monthly payment | Notes |
|---|---|---|---|---|
| Home mortgage | $640,000 | n/a | $3,950 | 5.14%, renews 2027-03, lender "Bank A" (fictional) |
| Property tax | | | $480 | Housing cost |
| Heating | | | $220 | Housing cost |
| Personal credit cards (2) | $7,500 | $30,000 | $225 | 3% of balance assumed |
| Car loan | $31,000 | n/a | $1,100 | 30 months remaining |
| Student loans / support payments | none | | | |
| **Housing cost** | | | **$4,650** | $3,950 + $480 + $220 |
| **Other personal debt payments** | | | **$1,325** | $225 + $1,100 |

**Business debts personally guaranteed by Priya** (contingent, normally paid by the company)
| Debt | Balance | Limit | Est. monthly payment |
|---|---|---|---|
| BDC term loan | $160,000 | n/a | $3,400 |
| Business line of credit | $90,000 | $250,000 | $450 (interest only, about 6%) |
| Business credit card | $18,000 | $50,000 | Paid in full monthly |
| **Total guaranteed** | **$268,000** | | **$3,850** (excluding card) |

## 5. Assets and net worth
| Bucket | Item | Value |
|---|---|---|
| Liquid | Chequing $42,000, savings $110,000 | $152,000 |
| Registered | RRSP $95,000, TFSA $75,000 | $170,000 |
| Non-registered | Brokerage | $60,000 |
| Real estate | Home | $1,350,000 |
| Other | Business equity (80% of owner's $3.5M estimate, **unverified**) $2,800,000; vehicle $45,000 | $2,845,000 |
| **Total assets** | | **$4,577,000** |

| Measure | Formula | Result |
|---|---|---|
| Liabilities counted | $640,000 + $31,000 + $7,500 | $678,500 (guaranteed debts excluded, shown separately) |
| Total net worth | $4,577,000 − $678,500 | **$3,898,500** |
| Net worth excluding business equity | $3,898,500 − $2,800,000 | **$1,098,500** (more conservative view) |
| Real estate net worth | $1,350,000 − $640,000 | **$710,000** |
| Liquid net worth | $152,000 − $7,500 | **$144,500** |
| Monthly living expenses (fact) | | $9,500 |
| Emergency fund | $152,000 / $9,500 | **16.0 months** |

## 6. Product checks

### 6a. Credit card
| Check | Client | Typical rule | Result |
|---|---|---|---|
| Personal income | $275,000 | About $60,000 for a premium card | Pass |
| Household income | $315,000 | About $100,000 | Pass |
| Score / utilization | 745 / 25% | 700+ / under 30% | Pass |
| **Decision** | | | **APPROVE**, premium personal card (a separate business card is already held) |

### 6b. Line of credit
**Unsecured request: $50,000**
| Check | Calculation | Result |
|---|---|---|
| Credit score | 745 vs about 680+ | Pass |
| Extra payment at 3% | $50,000 x 3% = $1,500/mo | |
| TDS with new line | ($4,650 + $1,325 + $1,500) / $26,250 = **28.5%** | Pass (max 44%) |
| Income stability | Self-employed 9 years, 2 NOAs | Pass |
| **Decision** | | **APPROVE** |

**Secured (HELOC) headroom on the home** (value $1,350,000)
| Step | Calculation | Result |
|---|---|---|
| Revolving cap (65%) | $1,350,000 x 65% | $877,500 |
| Combined cap (80%) | $1,350,000 x 80% = $1,080,000, minus $640,000 mortgage | $440,000 |
| **Maximum HELOC limit** | smaller of the two | **$440,000** |

### 6c. Mortgage (scenario: move up to a bigger home)
Purchase $1,800,000. Down payment $650,000 (current home net equity of about $710,000 minus roughly $60,000 selling and closing costs). Mortgage $1,150,000, LTV 63.9%.

| Check | Calculation | Result |
|---|---|---|
| Contract payment | $1,150 (thousands) x $5.81 | $6,682/mo (information only) |
| Stress-test payment | $1,150 x $7.00 | **$8,050/mo** |
| Tax + heating | $720 + $250 | $970 |
| **GDS** | ($8,050 + $970) / $26,250 | **34.4%** (max 39%) |
| **TDS, personal debts only** | ($9,020 + $1,325) / $26,250 | **39.4%** (max 44%) |
| **TDS, with guaranteed business payments** | ($10,345 + $3,850) / $26,250 | **54.1%** (max 44%, **fail**) |
| **Decision** | | **REFER to underwriter**: approve if company statements show the business pays its own loans, otherwise reduce the loan |

Example of the fix: if the company's statements prove it pays the BDC loan and line interest, the guaranteed payments drop out and the file passes at 39.4%.

## 7. Ratio summary
| Ratio | Formula | Value | Usual limit |
|---|---|---|---|
| GDS (current) | $4,650 / $26,250 | **17.7%** | 39% |
| TDS (current, personal) | ($4,650 + $1,325) / $26,250 | **22.8%** | 44% |
| TDS (new home, stressed, personal) | see 6c | 39.4% | 44% |
| TDS (new home, with guaranteed) | see 6c | 54.1% | 44% |
| Debt-to-income | $678,500 / $315,000 | 2.15 | Lower is better |
| Credit utilization | $7,500 / $30,000 | 25.0% | Under 30% |
| Emergency fund | $152,000 / $9,500 | 16.0 months | 3 to 6 months |

## 8. Field sensitivity (Track 1 policy idea)
| Field | Advisor sees | Notes |
|---|---|---|
| SIN, business number | **Hidden** | "On file: yes" only |
| Credit score (personal and business) | **Band only** | |
| Full credit reports, tax returns (NOAs) | **Hidden** | Underwriter only, under audit |
| Corporate financial statements | **Masked** to summary metrics (revenue band, profit band) | Commercially sensitive |
| Personally guaranteed debts | Visible as a **total and a flag** | Drives the Refer decision |
| Spouse details | **Masked** | Third-party data |
| Every access | **Logged** | |

## 9. Assumptions used in this file
| Assumption | Value |
|---|---|
| Contract / qualifying mortgage rate | 4.99% / 6.99% |
| Stress payment factor | about $7.00/month per $1,000 (25-year amortization) |
| Contract payment factor | about $5.81/month per $1,000 |
| Card and new-line payment | 3% of balance |
| Self-employed income | 2-year average of NOAs |
| Guaranteed business debt | Counted only in the "with guaranteed" scenario |
| Business equity | Owner's estimate, unverified, shown separately |
| Maximum GDS / TDS | 39% / 44% |
