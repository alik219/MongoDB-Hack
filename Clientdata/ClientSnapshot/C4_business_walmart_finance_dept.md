# C4 — Walmart Finance Department (Business: Large-Retailer Corporate Finance)

> **SYNTHETIC DATA.** "Walmart Finance Dept" is used only as a label for a large-retailer treasury client in this demo. **All figures, people, IDs and facilities below are invented and are not Walmart's real financial data.** The business number is a placeholder.

## How to read this file (for interns and non-technical readers)
- This client is a **large company**, not a person, so the three products are the business versions of the personal ones (see the mapping table). The ideas are the same: *can they afford it, are they reliable, what is the security?*
- **Sections 1 to 5** are *facts*. **Section 6** applies lender rules (*assumptions*). **Section 7** shows *calculated* ratios with formulas. **Section 8** is the field-visibility policy.
- All money is in **Canadian dollars, in millions (M)** unless stated. Thresholds are rules of thumb, **not fixed law**, and vary by lender.

| Personal product | Business version used here |
|---|---|
| Credit card | Corporate purchasing-card program |
| Personal line of credit | Operating revolving credit facility |
| Mortgage | Commercial mortgage on a distribution centre (DC) |
| Income / TDS / GDS | Revenue, EBITDA (operating profit before interest, tax, depreciation), debt service coverage |
| Net worth | Shareholders' equity |

## At a glance
| # | Statement | Type |
|---|---|---|
| 1 | A synthetic large retailer with **$20.0B revenue**, **$1.6B EBITDA**, and total debt of **$2.4B** (**1.5x EBITDA**). | Fact / Calculated |
| 2 | Credit is strong: internal rating **2 (strong)**, commercial score **82**, no missed payments, interest covered **13.3x**. | Fact / Calculated |
| 3 | Expected outcomes: **purchasing card = Approve ($25M)**, **revolver increase = Approve ($200M)**, **commercial mortgage = Approve ($195M at 65% LTV)**. | Calculated |

**Risk and mitigation:** Strong headline ratios sit on thin liquidity: cash is $600M against $18.4B of yearly cash costs (about 12 days of operations, 19 days including the undrawn revolver), and inventory is 69% of current assets, so the quick ratio is only 0.37x. A weak holiday season or supply shock could squeeze cash even though leverage looks low. Mitigation is to keep covenants (Debt/EBITDA at most 3.0x, interest cover at least 4.0x) with quarterly testing, cap the new mortgage at 65% LTV, and review liquidity at each facility change. Corporate financials are non-public and treasury accounts are a payment-fraud target, so advisors should see summary metrics and masked account details only, with every access logged.

---

## 1. Corporate identity and stability
| Field | Value |
|---|---|
| Client ID | C4-CORP-001 |
| Legal name (label) | Walmart Finance Dept (synthetic) |
| Business number | 000000000 RC0001 (placeholder) |
| Type | Corporation, large retailer, finance and treasury department |
| Years as client | 14 |
| Headquarters | Mississauga, Ontario (fictional office) |
| Finance department staff | 240 |
| Signing officers | Alex Morgan, VP Treasury (fictional); Dana Okafor, Controller (fictional) |
| Consent to pull commercial credit report | Yes, board resolution dated 2026-10-15 |
| Residency / SIN | Not applicable (corporation) |

## 2. Revenue and operating results (fiscal 2025, synthetic)
| Field | Value |
|---|---|
| Revenue | $20,000M |
| EBITDA | $1,600M (8.0% margin) |
| Interest expense | $120M |
| Net income | $650M |
| Scheduled principal repayments (per year) | $180M |
| Revenue trend | Up 4% on prior year (fact), stable store base |
| Documents on file | 3 years of audited financial statements, current compliance certificate |

## 3. Credit profile
| Field | Value |
|---|---|
| Internal risk rating | 2 on a 1 to 9 scale (1 = best) |
| Commercial credit score | 82 out of 100 (synthetic scale) |
| Payment history | No late payments in 14 years; suppliers paid within terms |
| Collections / legal actions | None |
| Covenant breaches | None |
| Hard inquiries, last 12 months | 1 (this review) |

## 4. Liabilities
| Debt | Balance | Limit | Annual interest / payment | Notes |
|---|---|---|---|---|
| Senior term notes | $1,800M | n/a | Fixed rate | Mostly long-dated |
| Operating revolver | $150M | $500M committed | Floating | Utilization **30.0%** ($150M / $500M) |
| Commercial mortgages (3 DCs) | $450M | n/a | Fixed rate | Secured on DCs valued at $900M |
| **Total debt** | **$2,400M** | | Interest $120M + principal $180M = **$300M/yr debt service** | |
| Guarantees / contingent debt | none | | | |

## 5. Assets and equity
| Bucket | Item | Value |
|---|---|---|
| Liquid | Cash and equivalents | $600M |
| Current | Inventory $2,900M, receivables $300M, other $400M | $3,600M |
| **Current assets** | | **$4,200M** |
| Real estate and equipment | Land, buildings, fixtures (book value) | $6,200M |
| Other | Intangibles, long-term investments | $1,100M |
| **Total assets** | | **$11,500M** |
| Current liabilities | Payables, accruals, current debt | $3,500M |
| Total liabilities | | $7,600M |

| Measure | Formula | Result |
|---|---|---|
| Shareholders' equity (net worth) | $11,500M − $7,600M | **$3,900M** |
| Real estate equity | $6,200M − $450M mortgages | **$5,750M** |
| Liquid net worth | $600M − ($150M revolver + $180M current principal) | **$270M** |
| Net debt | $2,400M − $600M | $1,800M |
| Daily cash operating cost | ($20,000M − $1,600M) / 365 | about $50.4M/day |
| Liquidity runway | ($600M cash + $350M undrawn revolver) / $50.4M | **18.8 days** |

## 6. Product checks

### 6a. Corporate purchasing-card program (business "credit card")
Request: $25M program limit, average monthly spend $8M.
| Check | Client | Typical rule | Result |
|---|---|---|---|
| Exposure vs EBITDA | $25M / $1,600M = 1.6% | Under about 5% | Pass |
| Payment history | 14 years, clean | Clean | Pass |
| Commercial score | 82 | 70+ | Pass |
| Liquidity | Cash $600M covers the limit 24x | Adequate | Pass |
| **Decision** | | | **APPROVE** $25M, with monthly statement settlement |

### 6b. Operating revolver (business "line of credit")
Request: increase the committed facility by $200M for seasonal inventory, from $500M to $700M.
| Check | Calculation | Typical covenant | Result |
|---|---|---|---|
| Current utilization | $150M / $500M | Under 60% | 30.0% |
| Pro forma debt if fully drawn | $2,400M + $200M = $2,600M | | |
| **Debt / EBITDA** | $2,600M / $1,600M | At most 3.0x | **1.63x** Pass |
| **Interest cover** | $1,600M / $120M (before new interest) | At least 4.0x | **13.3x** Pass |
| Debt service cover (DSCR) | $1,600M / ($120M + $180M) | At least 1.25x | **5.33x** Pass |
| **Decision** | | | **APPROVE**, quarterly covenant testing |

### 6c. Commercial mortgage (business "mortgage")
Request: buy a new distribution centre for $300M, borrow $195M (65%), 25-year amortization at an illustrative 5.5%.
| Check | Calculation | Typical rule | Result |
|---|---|---|---|
| LTV | $195M / $300M | At most 75% | **65.0%** Pass |
| Monthly payment | $195M x 0.6104% | | about $1.19M/mo |
| Annual debt service on new loan | $1.19M x 12 | | about $14.3M |
| Property income (NOI, assumed 7% cap rate) | $300M x 7% | | $21.0M |
| **Property DSCR** | $21.0M / $14.3M | At least 1.25x | **1.47x** Pass |
| **Company DSCR after deal** | ($1,600M + $21M) / ($300M + $14.3M) | At least 1.25x | **5.16x** Pass |
| Debt / EBITDA after deal | ($2,400M + $195M) / ($1,600M + $21M) | At most 3.0x | **1.60x** Pass |
| Down payment | $105M from cash ($600M) | | Pass, but cash falls to $495M |
| **Decision** | | | **APPROVE**, conditional on appraisal and environmental report |

## 7. Ratio summary
| Ratio | Formula | Value | Usual limit |
|---|---|---|---|
| Debt / EBITDA | $2,400M / $1,600M | **1.50x** | At most 3.0x |
| Net debt / EBITDA | $1,800M / $1,600M | 1.13x | Lower is better |
| Interest cover | $1,600M / $120M | **13.3x** | At least 4.0x |
| DSCR | $1,600M / $300M | **5.33x** | At least 1.25x |
| Debt / equity | $2,400M / $3,900M | 0.62 | Under about 2.0 |
| Current ratio | $4,200M / $3,500M | 1.20 | At least 1.0 |
| Quick ratio | ($4,200M − $2,900M) / $3,500M | 0.37 | Retail is often low |
| Mortgage LTV (existing DCs) | $450M / $900M | 50.0% | At most 75% |
| Revolver utilization | $150M / $500M | 30.0% | Under 60% |

## 8. Field sensitivity (Track 1 policy idea)
| Field | Advisor sees | Notes |
|---|---|---|
| Business number | **Masked** (last 4 only) | |
| Bank and treasury account numbers | **Hidden** | Payment-fraud target |
| Signing officer names and titles | Visible; contact details **masked** | |
| Audited financial statements | **Masked** to summary metrics | Non-public, commercially sensitive |
| Covenant and ratio results | Visible | Core to advice |
| Commercial credit report | **Hidden**; score shown as a band | |
| Every access | **Logged**, with alerts on bulk export | |

## 9. Assumptions used in this file
| Assumption | Value |
|---|---|
| Currency and units | CAD, millions |
| Commercial mortgage rate / amortization | 5.5% illustrative / 25 years, semi-annual compounding (payment factor about 0.6104% per month) |
| NOI on new DC | 7% cap rate x price |
| Covenants | Debt/EBITDA at most 3.0x, interest cover at least 4.0x, DSCR at least 1.25x |
| Maximum commercial LTV | 75% |
| Personal-only tests | GDS, TDS, SIN and stress test do not apply to a corporation |
