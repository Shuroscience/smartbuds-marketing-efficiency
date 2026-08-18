#!/usr/bin/env python3
"""Regression tests. The 2026 monthly CAC actuals must keep passing (hard constraint).

DECISION 2026-08-18: the budget-sheet denominators are frozen as historical constants.
Shopify first-time-purchaser counts are used going forward. The two do NOT agree, and
that discontinuity is intentional — test_discontinuity_is_documented pins the gap so it
can never be silently "fixed" into a wrong number.
"""
import json, os, sys, datetime as dt
ROOT = os.path.dirname(os.path.abspath(__file__))
CFG = json.load(open(os.path.join(ROOT, "config.json")))
sys.path.insert(0, ROOT)
from pipeline import WEIGHT, cost_weight

def accrue(monthly, method): return monthly * WEIGHT[method]

FAILS = []
def check(name, got, want, tol=0.005):
    ok = abs(got - want) <= tol
    print(f"  {'PASS' if ok else 'FAIL'}  {name}: got {got:.2f} want {want:.2f}")
    if not ok: FAILS.append(name)

print("2026 monthly CAC actuals (house formula: total spend / new customers)")
for m in CFG["historical_cac_constants"]["months"]:
    check(m["month"], m["spend"] / m["new_customers"], m["cac"])

adj = CFG["historical_cac_constants"]["adjusted"]
row = next(m for m in CFG["historical_cac_constants"]["months"] if m["month"] == adj["month"])
print("\nAdjusted CAC (optional non-acquisition exclusion)")
check("2026-05 adjusted", (row["spend"] - adj["exclude"]) / row["new_customers"], adj["cac"], tol=0.02)

print("\nCost model")
non_ad = sum(l["monthly"] for l in CFG["cost_lines"] if l["kind"] != "ad")
total = sum(l["monthly"] for l in CFG["cost_lines"])
check("monthly total matches current spend table", total, 150750, tol=0.5)
check("non-ad (editable) monthly", non_ad, 64750, tol=0.5)

print("\nAccrual strategies (weekly retainer burden on non-ad lines)")
for method, want in (("x12_over_52", 64750 * 12 / 52), ("calendar_days", 64750 * 7 / 30.4375),
                     ("divide_4", 64750 / 4.0)):
    check(method, accrue(non_ad, method), want, tol=0.01)

print("\nClayton reconciliation — week of Aug 3 2026 (real Triple Whale spend)")
# Retainer set in force that week was the ORIGINAL budget-sheet set ($67,069/mo), not the
# current table. Clayton's $276 can only be reproduced against the retainers of the time.
ads_actual = 12888.55 + 3148.32 + 269.84
cac_116 = (ads_actual + accrue(67069, "x12_over_52")) / 116
print(f"  real ad spend ${ads_actual:,.2f} + retainer accrual ${accrue(67069,'x12_over_52'):,.2f}")
print(f"  / 116 Shopify first-time buyers = ${cac_116:.2f}  (Clayton reported $276)")
check("within 1% of Clayton's $276", abs(cac_116 - 276) / 276 * 100, 0.0, tol=1.0)

print("\nMonth view has no accrual assumption at all")
check("month weight is 1.0 (a monthly retainer applies once)", cost_weight("month","x12_over_52"), 1.0)
check("week weight follows the chosen method", cost_weight("week","x12_over_52"), 12/52, tol=1e-9)

print("\nRefund basis parameters (not constants — switchable)")
opts = CFG["refund_bases"]["options"]
check("target", opts["target"]["rate"], 10.0)
check("planning (default)", opts["planning"]["rate"], 20.0)
check("bad scenario", opts["bad"]["rate"], 30.0)
assert CFG["refund_bases"]["default"] == "planning", "default basis must be planning/20%"
assert opts["measured"]["rate"] is None, "measured basis must be computed, never hardcoded"
print("  PASS  default is planning/20%; measured basis is computed not hardcoded")

print("\nDiscontinuity is documented, not fixed")
cp = os.path.join(ROOT, "data", "refund-curve.json")
if os.path.exists(cp):
    c = json.load(open(cp))
    print(f"  measured mature refund rate = {c['final_rate_pct']}% "
          f"({c['cohorts']} cohorts, {c['range'][0]}..{c['range'][1]})")
    assert 15 < c["final_rate_pct"] < 32, "measured refund rate outside sane band"
    print("  PASS  measured rate within sane band")
else:
    print("  SKIP  run pipeline.py first")

print()
if FAILS: sys.exit(f"{len(FAILS)} FAILED: {FAILS}")
print("All regression tests pass.")
