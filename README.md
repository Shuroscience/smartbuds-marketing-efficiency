# Marketing Efficiency

Hero metrics **ASP/CAC** and **LTV/CAC** for the Weekly Business Review.

## Run it

```bash
python3 pipeline.py      # pulls Triple Whale + Shopify -> data/
python3 test_cac.py      # regression tests
python3 -m http.server 8777   # then open http://localhost:8777
```

The page fetches `data/latest.json`, so it must be **served** — opening `index.html`
straight off disk shows "No data yet" because `file://` blocks the fetch.

Triple Whale's Summary Page endpoint is slow (~2–5 min per week) and prone to read
timeouts, so completed weeks are cached in `.cache_tw/` and only the two most recent
are refetched. A first run of 8 weeks takes ~15 minutes; later runs are quick.

`AS_OF=2026-08-18 WEEKS=12 python3 pipeline.py` to pin a date / window.
`REFRESH_ORDERS=1` forces a fresh Shopify pull (otherwise a local cache is reused).

## The page

**ASP/CAC is the hero** — one big number for the selected period, with the trend beneath it.
It leads because both sides are measured and it has no modelling lag, unlike LTV/CAC.

**Apply refund rate** (toggle, inside the hero). Off shows the no-refund case — gross ASP
over CAC, an assumption we know is false, useful as a ceiling. On shows the refund tax
explicitly: gross ASP, minus the tax at the applicable rate, giving net ASP.

**The trend obeys the same toggle, and distinguishes measurement from assumption.** A
period older than 16 weeks has effectively finished refunding, so it uses **its own
measured refund rate** and is drawn as a solid line. A younger period can only borrow the
planned rate, and is drawn **dashed** — so the right-hand end of the chart is visibly the
part most likely to move. 14 of 30 weeks are currently matured.

**Weeks or Months.** The month view is worth knowing about: a monthly retainer simply
applies once in a month, so **the month view has no accrual assumption at all** and the
accrual selector stops mattering. It is the cleaner basis for anything you have to defend.

**Y-axis is capped at 2.0×.** The Feb 9 launch week hit 3.55×; uncapped, that one point
flattens every other week into a straight line. Out-of-range periods are pinned to the top
with a caret and their true value.

## Provenance — every displayed number carries one

| Tag | Meaning |
|---|---|
| **measured** | from a system of record — Shopify orders, Triple Whale spend |
| **accrued** | a real contracted cost spread across weeks by the accrual method |
| **assumed** | somebody chose it. Never a measurement. |

## Settled definitions

**CAC** = total marketing spend / new customers, fully loaded (ad spend + retainers +
variable). Reproduces every 2026 monthly actual exactly; `test_cac.py` pins them.

**Accrual**: monthly × 12/52 by default. With real Triple Whale spend and Shopify's own
new-customer count this gives **$274.00** for the week of Aug 3 against Clayton's
reported $276 — strong corroboration, still not confirmation. Switchable
(`calendar_days`, `divide_4`) because the method is his, not ours.

**ASP** is per new customer, so numerator and denominator describe the same population.
Net of refunds by default.

**Refund basis** is a labeled parameter, never a constant: Target 10% / **Planning 20%
(default)** / Bad 30% / Measured (computed from cohorts). The active basis is shown
anywhere a net number appears.

**LTV** is a modeled placeholder — first order + consumables ($/mo × months × attach) +
repeat hardware. All four inputs invented, flagged amber, replaceable by cohort actuals
without a rewrite.

## Editing the cost inputs

The cost table is the working surface. You can change any amount, rename or reclassify a
line, remove one, or **+ Add line item**. Changing a line's basis between
measured (ad) / accrued (retainer) / assumed (variable) moves it between the three
provenance buckets and recomputes CAC live.

**Save changes** does two things: it keeps your work in this browser, and it downloads a
complete `config.json` (also copied to the clipboard). Commit that file — or paste it into
the shared cost sheet — and the change becomes visible to everyone, versioned, and
survives a cleared browser. Until it is committed it lives only in your browser, and
whoever commits last wins. Anyone can edit it afterwards. **Revert** discards local
changes and returns to the committed config.

Renaming is deliberately disabled for committed lines — their `id` is the join key the
pipeline uses to attach Triple Whale spend, so renames belong in `config.json`. Lines you
add yourself are freely renameable.

## Two things that are deliberately not clean

**The new-customer discontinuity.** The budget sheet's monthly denominators are not
reproducible from any automated source — Shopify's first-time-purchaser counts run
higher every month (January by ~50%). Decision (2026-08-18): freeze the sheet's figures
as historical constants, use Shopify going forward, and label the break. Both columns
are shown side by side in the dashboard. Do not "fix" this into a single series.

**COGS is out of scope**, so these ratios overstate the economics;
contribution-margin/CAC is the honester metric. The schema carries the room for it.

## Refund maturity

Refunds are matched back to the acquisition week of the order they belong to.
2026 cohorts finally refund **23.4% of gross**, and the curve shows how much of any
given week is still unknown: ~9% of eventual refunds are visible at 2 weeks, 39% at 4,
89% at 8, 98% at 12. Never project a recent week's own rate — at 2 weeks old the
gross-up is ~11× and amplifies noise (the Aug 3 week naively projects to 38.6%).
Computed on 2026-and-later cohorts only; 2025 behaves structurally differently
(~10.8% final, with a very late tail) and pooling the eras produces a misleading curve.

## Data sources

- **Triple Whale** — ad spend only, via the REST Summary Page API
  (`x-api-key`). Spend is the one figure no attribution model can distort.
  Its own CAC metrics (`newCustomersCpa` ≈ $136) are ad-spend-only and are not used.
  **MCP does not work** — `blockReason: mcp_feature_flag`, a shop-plan limit, not a key
  scope or an org-owner approval. Don't wait on that.
  The pipeline checks whether `blendedAds` exceeds the channels it recognises; if it
  does, someone loaded Custom Spend and retainers are being double counted. Currently clean.
- **Shopify** — gross bookings, units, new customers, refunds. New-vs-returning is
  derived by grouping all orders by customer (order payloads omit `orders_count`).
  Note `created_at_max` is midnight-exclusive.
- **Ramp / Supermetrics** — not connected, and out of scope by decision.

## Phase 3 — hosting

`.github/workflows/update.yml` runs daily, mirrors the shared cost sheet into
`config.json`, pulls both sources, runs the regression tests, commits one immutable
file per week, and deploys to Pages. Credentials live in Actions secrets:
`TRIPLEWHALE_API_KEY`, `SHOPIFY_DOMAIN`, `SHOPIFY_TOKEN`, and optionally
`GOOGLE_SERVICE_ACCOUNT_JSON` + `COST_SHEET_ID`.

Two things keep it from becoming a third orphaned dashboard:

1. **The cost sheet must live on a Shared Drive, not anyone's My Drive.** Personal
   ownership is what killed the Looker build. The Action mirrors the sheet into git on
   every run, so if the sheet ever disappears the last known-good costs are committed
   and the dashboard keeps working.
2. **The health strip on the dashboard face** shows the last successful pull and each
   source's status, and turns red past 9 days. The Looker dashboard died silently;
   this one cannot.## Cost inputs: sheet as source of truth

Cost lines (ad platforms, retainers, variables) live in **either a Google Sheet or the committed config.json**.
The pipeline reads one source per run, determined by the `COST_SOURCE` env var.

### Using a Google Sheet (recommended)

1. **Create a shared Google Sheet** with columns: `id`, `name`, `kind`, `monthly`, `tw_metric` (tab: "Cost inputs")
2. **Share with the service account** that will read it (or make it world-readable if using OAuth)
3. **In GitHub Actions secrets**, add:
   - `SHEET_ID` — the Google Sheet ID (from the URL: `https://docs.google.com/spreadsheets/d/SHEET_ID/...`)
   - `GOOGLE_APPLICATION_CREDENTIALS` — (optional; for local dev, set to a service account JSON file path)
4. **In `.github/workflows/update.yml`**, add env vars:
   ```yaml
   - name: Run pipeline
     env:
      COST_SOURCE: sheet
      SHEET_ID: ${{ secrets.SHEET_ID }}
   ```

For local testing:
```bash
COST_SOURCE=sheet SHEET_ID=<id> SHEET_TAB="Cost inputs" python3 pipeline.py
```

### Using the committed config.json (default)

No env vars needed; the pipeline reads `CFG["cost_lines"]` by default. Cost edits go through git.

### GitHub Actions setup for sheets

1. In your GitHub repo **Settings > Secrets and variables > Actions**, add:
   - `SHEET_ID`: your Google Sheet ID
   - `GOOGLE_SERVICE_ACCOUNT_JSON`: (optional, only if sheet is private) your service account JSON
   - `COST_SOURCE`: set to `sheet` (or omit to use `config`)

2. The workflow will read the sheet on each run, merge any new costs into the committed config.json, and redeploy the dashboard.

3. If the sheet is unreachable, the pipeline uses the last committed config and keeps running — no manual intervention needed.

### Swapping sources

The `load_cost_lines()` function is the abstraction point. To use an API, database, or other source:

1. Add a new function `load_cost_lines_from_<source>()` that returns the same schema
2. Add a branch in `load_cost_lines()` to call it when `COST_SOURCE=<source>`
3. Update Actions to pass the env var

The rest of the pipeline doesn't change.



