# GitHub Secrets Setup

Add these secrets to **Settings > Secrets and variables > Actions**:

## Required

| Name | Description | Example |
|------|-------------|---------|
| `TRIPLEWHALE_API_KEY` | Triple Whale read-only API key | `6204fd44-1e66-...` |
| `SHOPIFY_DOMAIN` | Shopify store domain | `tone-earbuds.myshopify.com` |
| `SHOPIFY_TOKEN` | Shopify Admin API access token | `shpat_...` |

## For Google Sheet cost source

If you want the pipeline to read costs from a Google Sheet (recommended):

| Name | Description |
|------|-------------|
| `SHEET_ID` | Google Sheet ID (from URL: `https://docs.google.com/spreadsheets/d/SHEET_ID/...`) |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Full service account JSON file contents (download from Google Cloud Console) |

Then set `COST_SOURCE` secret to `sheet`.

## Optional

| Name | Default | Values |
|------|---------|--------|
| `COST_SOURCE` | `config` | `sheet` (Google Sheet) or `config` (committed config.json) |

---

## Quick setup

### Triple Whale
1. Log in to Triple Whale
2. Settings → API Keys (or Team Settings)
3. Create a read-only API key
4. Copy the key to `TRIPLEWHALE_API_KEY` secret

### Shopify
1. Go to Admin → Settings → Apps and integrations → Develop apps
2. Create a new app (or use existing)
3. Configuration → Admin API scopes → enable:
   - `read_orders`
   - `read_products`
   - `read_customers`
4. Install the app
5. Admin API access tokens → copy token to `SHOPIFY_TOKEN` secret
6. Get your store domain (e.g., `tone-earbuds.myshopify.com`) and add to `SHOPIFY_DOMAIN`

### Google Service Account (for Sheet access)

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select existing)
3. APIs & Services → Enable APIs:
   - Google Sheets API
   - Google Drive API
4. Create credentials → Service Account
   - Give it a name (e.g., "marketing-dashboard")
   - Grant no roles (it only needs to read the sheet)
5. Keys → Create new JSON key
6. Download the JSON file
7. Open the file and copy its **entire contents**
8. In GitHub Secrets, create `GOOGLE_SERVICE_ACCOUNT_JSON` and paste the full JSON
9. Go back to Google Cloud Console, find the service account email (looks like `marketing-dashboard@....iam.gserviceaccount.com`)
10. Share your Google Sheet with that email address (Editor access)

