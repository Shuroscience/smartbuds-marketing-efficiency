# Setup: Marketing Efficiency Dashboard

This dashboard runs on GitHub Actions (daily) and GitHub Pages (live). Clayton edits costs in a Google Sheet; the pipeline pulls it, computes metrics, and publishes the live dashboard.

## Initial setup (one time)

### 1. GitHub secrets

In your GitHub repo **Settings > Secrets and variables > Actions**, add these:

| Secret | Value | Notes |
|--------|-------|-------|
| `TRIPLEWHALE_API_KEY` | Your Triple Whale API key (read-only) | From Triple Whale dashboard settings |
| `SHOPIFY_DOMAIN` | e.g., `tone-earbuds.myshopify.com` | Your Shopify store domain |
| `SHOPIFY_TOKEN` | Shopify API access token | Admin API scope: read orders, products |
| `SHEET_ID` | Google Sheet ID (from URL) | See **Google Sheet setup** below |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Service account JSON (full file contents) | See **Google Sheets API setup** below |

Optional:
| Secret | Value | Default |
|--------|-------|---------|
| `COST_SOURCE` | `sheet` or `config` | `config` (use committed config.json) |

### 2. Google Sheet setup

**Create a shared Google Sheet** with these columns (starting at A1):

```
| id | name | kind | monthly | tw_metric |
|---|---|---|---|---|
| meta_core | Meta — proven core | ad | 72000 | meta_ads_spend |
| google_brand | Google — brand + PMax + non-brand | ad | 14000 | google_ads_spend |
| ... (other ad platforms) | | | | |
| liquid_lemon | Liquid Lemon / BLCKHAT | retainer | 15000 | (leave blank) |
| jt_pr | Jack Taylor — PR | retainer | 15000 | (leave blank) |
| ... (other retainers) | | | | |
```

**Column meanings:**
- `id`: internal key, must be unique (used to join Triple Whale metrics)
- `name`: display label in the dashboard
- `kind`: `ad` (measured from Triple Whale), `retainer` (accrued), or `variable` (assumed timing)
- `monthly`: monthly cost in USD
- `tw_metric`: Triple Whale metric ID (blank for retainers/variables)

Share the sheet with the service account email address (see step 3).

### 3. Google Sheets API setup

**One-time per Google account:**

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or use existing)
3. Enable **Google Sheets API** and **Google Drive API**
4. Create a **Service Account**:
   - Service account email: `marketing-dashboard@...iam.gserviceaccount.com` (you'll use this email)
   - Create a JSON key and download it
5. Share your Google Sheet with the service account email (Editor access)
6. In GitHub Secrets, paste the **full JSON file** as `GOOGLE_SERVICE_ACCOUNT_JSON`

### 4. Enable GitHub Pages

In repo **Settings > Pages**:
- Source: Deploy from a branch
- Branch: `main`, folder: `/` (root)
- Domain: GitHub will assign `<org>.github.io/smartbuds-marketing-efficiency`

### 5. Set the repo to public (optional but recommended)

Clayton will visit the live dashboard at `https://<org>.github.io/smartbuds-marketing-efficiency` — no login needed. The cost sheet is private; only people with access can edit it.

## Daily operation

**Clayton's workflow:**
1. Opens the shared Google Sheet
2. Edits cost lines (add, remove, change amounts, change basis)
3. Closes the sheet (or leaves it open)
4. (Optionally) triggers the workflow manually via **Actions > Update marketing efficiency > Run workflow**
5. Workflow runs (5-10 min), pulls the sheet, computes metrics, publishes
6. Clayton refreshes the dashboard URL and sees updated metrics

**Automated:**
- Workflow runs daily at 09:00 UTC (can be changed in `.github/workflows/update.yml`)
- If the sheet is unreachable, falls back to the last committed config.json — no downtime
- Every commit creates immutable weekly JSON files in `/data`, so history is never lost

## Troubleshooting

**"SHEET_ID not found" error**: Check that `SHEET_ID` in Secrets matches the sheet URL (`https://docs.google.com/spreadsheets/d/SHEET_ID/...`)

**"Permission denied" error**: Verify the service account email is granted Editor access to the sheet.

**Workflow fails but dashboard still works**: The Actions log will show what failed. The previous config.json is still live, so there's no outage. Fix the issue and re-run the workflow (manually or wait for the next daily run).

**How to swap cost sources**: Edit `COST_SOURCE` secret to `config` (use committed config.json) or `sheet` (read from Google Sheet). Add a new source by extending `pipeline.py`'s `load_cost_lines()` function.

## File structure

```
smartbuds-marketing-efficiency/
  index.html              # Dashboard UI (static)
  app.js                  # Dashboard logic (~600 lines, fully client-side)
  pipeline.py             # Data pull: Shopify + Triple Whale → JSON
  test_cac.py             # Regression tests (keep CAC math locked)
  config.json             # Committed snapshot of costs (updated daily from sheet)
  data/
    latest.json           # Current computed metrics
    week-YYYY-MM-DD.json  # One immutable file per week (history)
    refund-curve.json     # Measured refund maturation (17 cohorts)
  .github/workflows/
    update.yml            # GitHub Actions: pull → compute → publish
  .gitignore              # Ignores credentials, cache, OS files
  README.md               # User documentation
  SETUP.md                # (this file) — setup & troubleshooting
```

## Swapping cost sources

Currently reads from Google Sheet (if `COST_SOURCE=sheet`) or committed config.json (if `COST_SOURCE=config`).

To add a new source (e.g., API, database):
1. Add a function `load_cost_lines_from_<source>()` in `pipeline.py` that returns the same schema
2. Add a branch in `load_cost_lines()` to call it
3. Update `.github/workflows/update.yml` to pass the env var
4. Done — the rest of the pipeline doesn't change

