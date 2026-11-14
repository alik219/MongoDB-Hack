"""Pure Canadian mortgage math (no DB). Amounts in cents."""


def min_down_payment_cents(price, tier1_cap, insured_cap):
    if price >= insured_cap:
        return int(price * 0.20)
    if price <= tier1_cap:
        return int(price * 0.05)
    return int(tier1_cap * 0.05 + (price - tier1_cap) * 0.10)


def monthly_payment_cents(principal, annual_rate_pct, amort_years):
    """Canadian fixed mortgages compound semi-annually, paid monthly."""
    if principal <= 0:
        return 0
    i = (1 + annual_rate_pct / 100 / 2) ** (1 / 6) - 1
    n = amort_years * 12
    return int(round(principal * i / (1 - (1 + i) ** -n)))


def qualifying_rate_pct(contract_rate_pct, add_pct, floor_pct):
    return max(contract_rate_pct + add_pct, floor_pct)


def debt_ratios(*, principal, qual_rate_pct, amort_years, tax_monthly, heat_monthly,
                other_debt_monthly, gross_annual_income):
    pi = monthly_payment_cents(principal, qual_rate_pct, amort_years)
    income_m = gross_annual_income / 12
    housing = pi + tax_monthly + heat_monthly
    return {
        "qualifying_payment_cents": pi,
        "gds": housing / income_m,
        "tds": (housing + other_debt_monthly) / income_m,
    }
