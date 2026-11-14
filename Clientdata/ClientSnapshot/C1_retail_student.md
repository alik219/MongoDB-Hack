# C1 — Maya Chen (Retail: Student)

> **SYNTHETIC DATA.** Every person, employer, number and ID below is invented for a demo. Nothing here belongs to a real client. The SIN is a placeholder that can never be issued.

## How to read this file (for interns and non-technical readers)
- **Sections 1 to 5** are the client's *facts* (what the client would tell an advisor or what a credit report would show).
- **Section 6** applies lender rules of thumb (*assumptions*) to those facts for three products: credit card, line of credit, mortgage.
- **Section 7** shows the *calculated* ratios and how each one was worked out, so you can re-do the math.
- **Section 8** says which fields an advisor should see, see masked, or never see (the Track 1 field-level policy idea).
- Thresholds are common industry rules of thumb, **not fixed law**. They vary by lender, so confirm them before the demo.

## At a glance
| # | Statement | Type |
|---|---|---|
| 1 | Maya is a 21-year-old full-time student earning about **$18,304/yr** from a part-time job. | Fact |
| 2 | Her credit is thin but clean: score **662**, utilization **26.7%**, no late payments. | Fact |
| 3 | Expected outcomes: **credit card = Approve (small limit)**, **line of credit = Refer (co-signer)**, **mortgage = Decline**. | Calculated |

**Risk and mitigation:** The main risk is over-lending to a client with low, unstable income and $14,200 of student debt that will start repaying after graduation. If the demo shows an approval it should be capped (for example a $2,500 card limit), and the unsecured line should require a co-signer or proof of enrolment. A second risk is data exposure, because even a student file carries a SIN and a credit score; the advisor view should mask the SIN and show only a score band.

---

## 1. Identity and stability
| Field | Value |
|---|---|
| Client ID | C1-STU-001 |
| Name | Maya Chen |
| Age | 21 |
| Marital status | Single |
| Dependants | 0 |
| Residency status | Canadian citizen |
| SIN | 000-000-001 (placeholder) |
| Consent to pull credit report | Yes, signed 2026-11-01 |
| Housing | Rent, shared apartment in Toronto |
| Monthly rent | $850 |
| Time at current address | 18 months |
| Student status | Full-time, year 3 of 4, Computer Science |
| Possible co-signer | Parent (salaried, about $92,000/yr, credit score 770) |

## 2. Income and employment
| Field | Value |
|---|---|
| Employer | Corner Roast Café (fictional) |
| Role / type | Barista, hourly, part-time |
| Time with employer | 18 months (under the 2-year ideal) |
| Pay | $17.60/hour x 20 hours/week x 52 weeks |
| **Gross annual income** | **$18,304** (about $1,525/month) |
| Variable pay | None |
| Other income | Bursary $2,000/yr (lenders usually do not count it) |
| Co-applicant income | None |

## 3. Credit profile
| Field | Value |
|---|---|
| Credit score (Equifax) | 662 |
| Length of credit history | 2.5 years |
| Tradelines | 2 (student credit card, government student loan) |
| Credit utilization | $400 / $1,500 = **26.7%** (target: under 30%) |
| Late payments / collections | None |
| Bankruptcy / consumer proposal | None |
| Hard inquiries, last 12 months | 1 |

## 4. Liabilities
| Debt | Balance | Limit | Monthly payment | Notes |
|---|---|---|---|---|
| Student credit card | $400 | $1,500 | $12 (3% assumed) | Lender rule of thumb |
| Government student loan | $14,200 | n/a | $0 now | In school; repayment starts 6 months after graduation |
| Line of credit | $0 | none | $0 | None held |
| Car loan / lease | none | | | |
| Mortgage | none | | | |
| **Total debt** | **$14,600** | | **$12** | |

## 5. Assets and net worth
| Bucket | Item | Value |
|---|---|---|
| Liquid | Chequing | $1,800 |
| Liquid | Savings | $3,200 |
| Registered | TFSA | $2,000 |
| Registered | RRSP / FHSA | $0 / not opened |
| Non-registered | Brokerage | $0 |
| Real estate | None | $0 |
| Other | Vehicles / business | $0 |
| **Total assets** | | **$7,000** |

| Measure | Formula | Result |
|---|---|---|
| Total net worth | $7,000 − $14,600 | **−$7,600** |
| Real estate net worth | $0 − $0 | $0 |
| Liquid net worth | $5,000 liquid − $400 short-term debt | **$4,600** |
| Monthly living expenses (fact) | | $1,300 |
| Emergency fund | $5,000 / $1,300 | **3.8 months** |

## 6. Product checks

### 6a. Credit card
| Check | Client | Typical rule | Result |
|---|---|---|---|
| Income | $18,304 | Student cards: usually no minimum | Pass |
| Credit score | 662 | About 650+ for a student card | Pass |
| Utilization | 26.7% | Under 30% | Pass |
| Late payments | None | None | Pass |
| **Decision** | | | **APPROVE**, limit up to $2,500 (utilization would fall to 16%) |

Example: a request to raise the limit from $1,500 to $2,500 is approved because $400 / $2,500 = 16%.

### 6b. Personal line of credit
| Check | Client | Typical rule | Result |
|---|---|---|---|
| Request | $5,000 unsecured | | |
| Credit score | 662 | About 680+ for unsecured | **Fail** (18 points short) |
| Income stability | 18 months, part-time | Stable, 2+ years | **Weak** |
| Existing unsecured debt | $400 | Low | Pass |
| **Decision** | | | **REFER**: approve only with a parent co-signer, or cut the limit to $2,000 |

### 6c. Mortgage (hypothetical request)
Scenario: $350,000 condo, 5% down = $17,500, mortgage = $332,500 (mortgage insurance premium ignored to keep the math simple).

| Check | Calculation | Result |
|---|---|---|
| Down payment | $17,500 needed vs $5,000 liquid | **Fail** |
| Stress-test payment | $332.5 (thousands) x $7.00 = **$2,328/mo** | |
| Other housing costs | tax $250 + heat $100 + 50% of condo fee $200 = $550 | |
| **GDS** | ($2,328 + $550) / $1,525 = **188.7%** | Fail (max 39%) |
| **TDS** | ($2,878 + $12) / $1,525 = **189.5%** | Fail (max 44%) |
| **Decision** | | **DECLINE** |

## 7. Ratio summary
| Ratio | Formula | Value | Usual limit |
|---|---|---|---|
| GDS (hypothetical) | housing / gross monthly income | 188.7% | 39% |
| TDS (hypothetical) | housing + other debt / gross monthly income | 189.5% | 44% |
| Debt-to-income | $14,600 / $18,304 | 0.80 | Lower is better |
| Credit utilization | $400 / $1,500 | 26.7% | Under 30% |
| Emergency fund | $5,000 / $1,300 | 3.8 months | 3 to 6 months |

## 8. Field sensitivity (Track 1 policy idea)
| Field | Advisor sees | Notes |
|---|---|---|
| SIN | **Hidden** | Show only "SIN on file: yes" |
| Credit score | **Band only** (for example "Fair 600 to 699") | Exact score restricted |
| Full credit report | **Hidden** | Retrieve under audit only |
| Income, net worth, ratios | Visible | Core to advice |
| Name, age, residency | Visible | |
| Every access | **Logged** | Who, when, which field |

## 9. Assumptions used in this file
| Assumption | Value |
|---|---|
| Contract mortgage rate | 4.99% |
| Qualifying (stress-test) rate | 6.99% (contract + 2%) |
| Stress payment factor | about $7.00/month per $1,000 borrowed (25-year amortization, semi-annual compounding) |
| Contract payment factor | about $5.81/month per $1,000 |
| Credit card payment assumed | 3% of balance |
| Maximum GDS / TDS | 39% / 44% |
| Condo fees counted in GDS | 50% |
