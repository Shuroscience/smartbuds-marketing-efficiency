# GitHub Secrets Setup

Add these 4 secrets to **Settings > Secrets and variables > Actions**:

## Required

| Name | Description | Example |
|------|-------------|---------|
| `TRIPLEWHALE_API_KEY` | Triple Whale read-only API key | `6204fd44-1e66-...` |
| `SHOPIFY_DOMAIN` | Shopify store domain | `tone-earbuds.myshopify.com` |
| `SHOPIFY_TOKEN` | Shopify Admin API access token | `shpat_...` |
| `SHEET_ID` | Google Sheet ID (from your public cost sheet) | `1z_TnFP78xP-xmYa8...` |

That's it. No service account needed — the sheet is public.

---

## How to get each secret

### Triple Whale
1. Log in to Triple Whale
2. Settings → API Keys
3. Create or copy your read-only API key
4. Copy to `TRIPLEWHALE_API_KEY` secret

### Shopify
1. Go to Admin → Settings → Apps and integrations → Develop apps
2. Create a new app (or use existing)
3. Configuration → Admin API scopes → enable:
   - `read_orders`
   - `read_products`
   - `read_customers`
4. Install the app
5. Admin API access tokens → copy token to `SHOPIFY_TOKEN` secret
6. Get your store domain (e.g., `tone-earbuds.myshopify.com`) → add to `SHOPIFY_DOMAIN`

### Google Sheet ID
1. Open your cost sheet
2. Look at the URL: `https://docs.google.com/spreadsheets/d/SHEET_ID/edit`
3. Copy the `SHEET_ID` part
4. Add to `SHEET_ID` secret

