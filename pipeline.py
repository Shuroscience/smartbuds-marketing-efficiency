#!/usr/bin/env python3
"""Marketing efficiency pipeline: Triple Whale spend + Shopify orders -> period JSON.

Emits both weekly and monthly periods. Every number carries a provenance tag:
  measured -> from a system of record (Triple Whale spend, Shopify orders)
  accrued  -> a real contracted cost spread across the period
  assumed  -> an input somebody invented; never a measurement

A period whose orders are at least MATURITY_WEEKS old carries its OWN measured refund
rate; younger periods can only borrow the planned rate. The client shows which.

Credentials come from env (CI) or ~/.claude/*/credentials.env (local). Never committed.
"""
import json, os, sys, datetime as dt, urllib.request
from collections import defaultdict

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, "data")
CFG  = json.load(open(os.path.join(ROOT, "config.json")))
TODAY = dt.date.fromisoformat(os.environ.get("AS_OF", dt.date.today().isoformat()))
MATURITY_WEEKS = 16          # refunds are ~99.6% booked by here
COHORT_ERA_START = dt.date(2026, 1, 1)   # 2025 refund behaviour is structurally different
TW_CACHE = os.path.join(ROOT, ".cache_tw")

def _env(path, keys):
    out = {k: os.environ[k] for k in keys if os.environ.get(k)}
    if len(out) == len(keys): return out
    p = os.path.expanduser(path)
    if os.path.exists(p):
        for line in open(p):
            line = line.strip()
            if line and "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1); out.setdefault(k, v)
    missing = [k for k in keys if k not in out]
    if missing: sys.exit(f"missing credentials: {missing} (env or {path})")
    return out

TW = _env("~/.claude/triplewhale/credentials.env", ["TRIPLEWHALE_API_KEY", "SHOPIFY_DOMAIN"])

def monday(d): return d - dt.timedelta(days=d.weekday())
def month_start(d): return d.replace(day=1)
def month_end(d):
    n = (d.replace(day=28) + dt.timedelta(days=4)).replace(day=1)
    return n - dt.timedelta(days=1)

# ---------------------------------------------------------------- Triple Whale
def _tw_fetch(start, end, attempts=3):
    """Summary Page API. Slow and prone to read timeouts, so retry."""
    body = json.dumps({"shopDomain": TW["SHOPIFY_DOMAIN"],
                       "period": {"start": start.isoformat(), "end": end.isoformat()}}).encode()
    last = None
    for i in range(attempts):
        try:
            req = urllib.request.Request(
                "https://api.triplewhale.com/api/v2/summary-page/get-data",
                data=body, method="POST",
                headers={"x-api-key": TW["TRIPLEWHALE_API_KEY"], "Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=300) as r:
                return json.loads(r.read().decode())["metrics"]
        except Exception as e:
            last = e
            print(f"     retry {i+1}/{attempts} {start}: {e}", file=sys.stderr)
    raise last

def tw_period(kind, start, end, fresh=False):
    """Completed periods are immutable, so cache them; only recent ones are refetched.
    A Triple Whale outage then cannot erase history already collected."""
    os.makedirs(TW_CACHE, exist_ok=True)
    cp = os.path.join(TW_CACHE, f"{kind[0]}-{start.isoformat()}.json")
    legacy = os.path.join(TW_CACHE, f"{start.isoformat()}.json")   # pre-monthly weekly cache
    metrics = None
    if not fresh:
        for p in (cp, legacy):
            if os.path.exists(p):
                metrics = json.load(open(p)); break
    if metrics is None:
        metrics = _tw_fetch(start, end)
        json.dump(metrics, open(cp, "w"))
    m = {x.get("metricId"): (x.get("values", {}) or {}).get("current") or 0 for x in metrics}
    by_line = {l["id"]: round(float(m.get(l["tw_metric"], 0) or 0), 2)
               for l in cost_lines if l["kind"] == "ad" and l.get("tw_metric")}
    blended = round(float(m.get("blendedAds", 0) or 0), 2)
    summed  = round(sum(by_line.values()), 2)
    return {
        "by_line": by_line, "total": summed, "blendedAds": blended,
        # blendedAds above the channels we recognise => someone loaded Custom Spend
        # into Triple Whale and retainers may be double counted.
        "custom_spend_suspected": round(blended - summed, 2) > 1.0,
        "unrecognised_blended_delta": round(blended - summed, 2),
        "tw_new_customer_orders": m.get("newCustomersOrders"),
        "tw_ncpa": m.get("newCustomersCpa"),
        "tw_gross_sales": m.get("totalSales"),
        "tw_in_week_refund_ratio": m.get("totalReturns"),
    }

# ---------------------------------------------------------------- Shopify
def load_orders():
    cache = os.environ.get("ORDERS_CACHE", os.path.join(ROOT, ".cache_orders.json"))
    alt = ("/private/tmp/claude-501/-Users-caitlinshure/"
           "7c96bfd8-3f46-4351-8c37-a8abba924fd8/scratchpad/all_orders.json")
    for p in (cache, alt):
        if os.path.exists(p) and not os.environ.get("REFRESH_ORDERS"):
            print(f"  orders from cache {p}", file=sys.stderr); return json.load(open(p))
    sys.path.insert(0, os.path.expanduser("~/.claude/shopify"))
    import query
    print("  pulling full order history from Shopify...", file=sys.stderr)
    o = query.get_orders("2024-01-01", (TODAY + dt.timedelta(days=1)).isoformat())
    json.dump(o, open(cache, "w"))
    return o

def d(s): return dt.datetime.fromisoformat(s).date()

def identity(r):
    """Order payloads omit customer.orders_count, so new-vs-returning must be derived."""
    c = r.get("customer") or {}
    if c.get("id"): return ("id", c["id"])
    e = (r.get("email") or r.get("contact_email") or "").lower().strip()
    return ("em", e) if e else None

def refund_events(r):
    out = []
    for rf in (r.get("refunds") or []):
        amt = sum(float(t.get("amount") or 0) for t in (rf.get("transactions") or [])
                  if t.get("kind") == "refund" and t.get("status") == "success")
        if amt: out.append((d(rf["created_at"]), amt))
    return out

class Book:
    """Order-level facts, aggregatable over any date range."""
    def __init__(self, orders):
        live = [r for r in orders if not r.get("cancelled_at") and not r.get("test")]
        self.rows = []
        first = {}
        for r in sorted(live, key=lambda r: r["created_at"]):
            k = identity(r)
            if k and k not in first: first[k] = d(r["created_at"])
        self.first_dates = sorted(first.values())
        for r in live:
            od = d(r["created_at"])
            self.rows.append({
                "date": od,
                "gross": float(r.get("total_price") or 0),
                "units": sum(int(li.get("quantity") or 0) for li in (r.get("line_items") or [])),
                "refunds": refund_events(r),
            })

    def agg(self, start, end):
        g = u = n = 0.0; orders = 0; ref = 0.0; lag = defaultdict(float)
        for r in self.rows:
            if start <= r["date"] <= end:
                g += r["gross"]; u += r["units"]; orders += 1
                for rd, a in r["refunds"]:
                    ref += a
                    lag[max(0, (rd - r["date"]).days // 7)] += a
        nc = sum(1 for fd in self.first_dates if start <= fd <= end)
        return {"gross": round(g, 2), "units": int(u), "orders": orders,
                "new_customers": nc, "refunds_booked": round(ref, 2), "lag": dict(lag)}

    def weekly_lag(self):
        wg = defaultdict(float); lag = defaultdict(lambda: defaultdict(float))
        for r in self.rows:
            w = monday(r["date"]); wg[w] += r["gross"]
            for rd, a in r["refunds"]:
                lag[w][max(0, (rd - r["date"]).days // 7)] += a
        return wg, lag

def refund_curve(book):
    """Maturation curve on the current era only — pooling 2025 gives a misleading curve."""
    wg, lag = book.weekly_lag()
    mature = sorted(w for w in wg
                    if w >= COHORT_ERA_START and (TODAY - w).days // 7 >= MATURITY_WEEKS and wg[w] > 0)
    tg = sum(wg[w] for w in mature)
    if not tg: return None
    final = sum(sum(lag[w].values()) for w in mature) / tg * 100
    cum, run = [], 0.0
    for L in range(0, MATURITY_WEEKS + 1):
        run += sum(lag[w][L] for w in mature)
        cum.append(round(run / tg * 100, 3))
    return {"final_rate_pct": round(final, 2), "cohorts": len(mature), "gross": round(tg, 2),
            "range": [mature[0].isoformat(), mature[-1].isoformat()],
            "cum_pct_of_gross": cum,
            "pct_of_eventual_visible": [round(c / final * 100, 1) if final else 0 for c in cum],
            "maturity_weeks": MATURITY_WEEKS, "provenance": "measured",
            "method": (f"Refunds matched to their order's acquisition week; {len(mature)} cohorts "
                       f"aged >={MATURITY_WEEKS}w from {COHORT_ERA_START.isoformat()} onward.")}

# ---------------------------------------------------------------- cost source abstraction
def load_cost_lines():
    """Load cost lines from the source of truth.
    
    This is an abstraction point so the source can be swapped without changing
    the rest of the pipeline. Possible sources: "sheet" (Google), "config" (committed),
    or a custom implementation (API, database, etc.).
    
    Expected return: list of dicts matching config.json cost_lines schema:
      {id, name, kind, monthly, tw_metric (optional), effective_from, effective_to}
    """
    source=os.environ.get("COST_SOURCE","config")
    if source=="sheet":
        return load_cost_lines_from_sheet()
    elif source=="config":
        return load_cost_lines_from_config()
    else:
        raise ValueError(f"COST_SOURCE={source} unknown; use 'sheet' or 'config'")

def load_cost_lines_from_config():
    """Read cost lines from the committed config.json (default, no dependencies)."""
    return CFG["cost_lines"]

def load_cost_lines_from_sheet():
    """Read cost lines from a Google Sheet (public or private).
    
    Env vars required:
      SHEET_ID    - Google Sheet ID (visible in the URL after /d/)
      SHEET_TAB   - tab name, default "Cost inputs"
    
    Sheet structure (starting at A1):
      | id | name | kind | monthly | tw_metric |
      (headers in row 1, data from row 2 onward)
    
    For a PUBLIC sheet: no authentication needed, just set SHEET_ID
    For a PRIVATE sheet: set GOOGLE_APPLICATION_CREDENTIALS to service account JSON path
    """
    sheet_id=os.environ.get("SHEET_ID")
    sheet_tab=os.environ.get("SHEET_TAB","Cost inputs")
    if not sheet_id:
        raise ValueError("SHEET_ID env var required for COST_SOURCE=sheet")
    
    try:
        import gspread
    except ImportError:
        raise ImportError("gspread required for COST_SOURCE=sheet; pip install gspread")
    
    # Try service account first (for private sheets)
    auth=None
    try:
        auth=gspread.service_account()
    except:
        pass
    
    if auth:
        sh=auth.open_by_key(sheet_id)
    else:
        # Fall back to public sheet access (no auth)
        sh=gspread.open_by_key(sheet_id)
    
    ws=sh.worksheet(sheet_tab)
    rows=ws.get_all_records(empty2zero=False)
    
    lines=[]
    for r in rows:
        if not r.get("id"):
            continue
        m=r.get("monthly",0)
        lines.append({
            "id":r["id"],
            "name":r.get("name",""),
            "kind":r.get("kind","retainer"),
            "monthly":float(m) if m else 0,
            "tw_metric":r.get("tw_metric") or None,
            "effective_from":r.get("effective_from"),
            "effective_to":r.get("effective_to"),
        })
    return lines

# ---------------------------------------------------------------- cost model
WEIGHT = {"x12_over_52": 12 / 52, "calendar_days": 7 / 30.4375, "divide_4": 1 / 4}

def cost_weight(kind, method):
    """A monthly retainer applies once per month, so the month view has no accrual
    ambiguity at all. Only the week view needs a divisor."""
    return 1.0 if kind == "month" else WEIGHT[method]

def _wk_label(start, end):
    """Cross-month weeks need the second month named, or "Jan 26-1" reads as nonsense."""
    if start.month == end.month:
        return f"{start.strftime('%b')} {start.day}–{end.day}"
    return f"{start.strftime('%b')} {start.day}–{end.strftime('%b')} {end.day}"

def compute(kind, start, end, sh, spend, curve):
    method = CFG["accrual"]["method"]
    wt = cost_weight(kind, method)
    retainers = sum(l["monthly"] for l in CFG["cost_lines"] if l["kind"] == "retainer") * wt
    variable  = sum(l["monthly"] for l in cost_lines if l["kind"] == "variable") * wt
    ads = spend["total"]
    total = ads + retainers + variable
    nc, gross = sh["new_customers"], sh["gross"]
    cac = total / nc if nc else None

    age_w = (TODAY - end).days // 7
    mature = age_w >= MATURITY_WEEKS
    actual_pct = round(sh["refunds_booked"] / gross * 100, 2) if gross else None
    visible = None
    if curve:
        visible = curve["pct_of_eventual_visible"][min(max(age_w, 0), MATURITY_WEEKS)]

    bases = {}
    for k, o in CFG["refund_bases"]["options"].items():
        rate = curve["final_rate_pct"] if k == "measured" and curve else o["rate"]
        if rate is None: continue
        bases[k] = {"label": o["label"], "rate_pct": round(rate, 2), "provenance": o["provenance"]}

    L = CFG["ltv_assumptions"]
    consum = L["consumables_per_month"] * L["active_months"] * L["attach_rate_pct"] / 100
    return {
        "period_type": kind, "start": start.isoformat(), "end": end.isoformat(),
        "label": (_wk_label(start, end) if kind == "week" else start.strftime("%b %Y")),
        "age_weeks": age_w,
        "measured": {"gross_bookings": gross, "units": sh["units"], "orders": sh["orders"],
                     "new_customers": nc, "ad_spend": ads, "ad_spend_by_line": spend["by_line"],
                     "refunds_booked": sh["refunds_booked"]},
        "accrued": {"retainers": round(retainers, 2), "variable": round(variable, 2),
                    "method": method if kind == "week" else "none (monthly costs apply once)"},
        "assumed": {"ltv_consumables_total": round(consum, 2), **L},
        "cac": round(cac, 2) if cac else None,
        "total_spend": round(total, 2),
        "asp_gross": round(gross / nc, 2) if nc else None,
        # the period's OWN refund experience — trustworthy only once matured
        "refund_actual": {"booked_pct": actual_pct, "is_mature": mature,
                          "pct_of_eventual_visible": visible,
                          "provenance": "measured" if mature else "incomplete"},
        "refund_bases_available": bases,
        "triple_whale_cross_check": {
            "blendedAds": spend["blendedAds"],
            "custom_spend_suspected": spend["custom_spend_suspected"],
            "unrecognised_blended_delta": spend["unrecognised_blended_delta"],
            "tw_new_customer_orders": spend["tw_new_customer_orders"],
            "tw_ncpa_do_not_use": spend["tw_ncpa"],
            "tw_in_week_refund_ratio_artifact": spend["tw_in_week_refund_ratio"]},
    }

# ---------------------------------------------------------------- main
def ranges(kind, n):
    out = []
    if kind == "week":
        last = monday(TODAY) - dt.timedelta(weeks=1)      # last complete week
        for i in range(n):
            s = last - dt.timedelta(weeks=i); out.append((s, s + dt.timedelta(days=6)))
    else:
        m = month_start(TODAY)
        for i in range(n):
            e = m - dt.timedelta(days=1); s = month_start(e)   # last complete month, walking back
            out.append((s, e)); m = s
    return out

def main():
    global cost_lines
    os.makedirs(DATA, exist_ok=True)
    nweeks  = int(os.environ.get("WEEKS", "30"))
    nmonths = int(os.environ.get("MONTHS", "9"))
    print("Loading cost lines...", file=sys.stderr)
    cost_lines = load_cost_lines()
    print("Loading Shopify orders...", file=sys.stderr)
    book = Book(load_orders())
    curve = refund_curve(book)
    json.dump(curve, open(os.path.join(DATA, "refund-curve.json"), "w"), indent=2)
    print(f"  refund curve: {curve['final_rate_pct']}% over {curve['cohorts']} cohorts", file=sys.stderr)

    health = {"sources": {"shopify": {"ok": 1, "orders": len(book.rows)}}, "generated_at": TODAY.isoformat()}
    periods = {}
    for kind, n in (("week", nweeks), ("month", nmonths)):
        rows = []
        for i, (s, e) in enumerate(ranges(kind, n)):
            try:
                spend = tw_period(kind, s, e, fresh=(i < 2))
                health["sources"].setdefault("triple_whale", {"ok": 0, "fail": 0})["ok"] += 1
            except Exception as ex:
                print(f"  !! Triple Whale failed {kind} {s}: {ex}", file=sys.stderr)
                health["sources"].setdefault("triple_whale", {"ok": 0, "fail": 0})["fail"] += 1
                continue
            rec = compute(kind, s, e, book.agg(s, e), spend, curve)
            rows.append(rec)
            if kind == "week":
                json.dump(rec, open(os.path.join(DATA, f"week-{s.isoformat()}.json"), "w"), indent=2)
            print(f"  {kind} {s} CAC {rec['cac']} nc={rec['measured']['new_customers']}"
                  f" mature={rec['refund_actual']['is_mature']}", file=sys.stderr)
        rows.sort(key=lambda r: r["start"])
        periods[kind] = rows

    monthly_nc = {}
    for r in periods.get("month", []):
        monthly_nc[r["start"][:7]] = r["measured"]["new_customers"]

    json.dump({"periods": periods, "weeks": periods.get("week", []),
               "refund_curve": curve, "config": CFG, "health": health,
               "shopify_monthly_new_customers": monthly_nc},
              open(os.path.join(DATA, "latest.json"), "w"), indent=2)
    print(f"\nwrote {len(periods.get('week',[]))} weeks + {len(periods.get('month',[]))} months",
          file=sys.stderr)

if __name__ == "__main__":
    main()
