#!/usr/bin/env python3
"""Mirror the shared cost sheet into config.json.  NOT YET IMPLEMENTED.

Deliberately a stub rather than an untested implementation. It cannot be written
or verified until two things exist:

  1. The cost sheet itself, on a **Shared Drive** (not anyone's My Drive — personal
     ownership is what orphaned the 2025 Looker dashboard).
  2. A Google service account with read access to it, its JSON in the
     GOOGLE_SERVICE_ACCOUNT_JSON Actions secret and the sheet id in COST_SHEET_ID.

Contract when built: read the sheet, and for each row whose `id` matches a
cost_lines entry in config.json, overwrite that line's `monthly`. Write config.json
back. Never invent line items the sheet doesn't have; never delete ones it omits —
log the discrepancy instead. On ANY failure, leave config.json untouched and exit 0
so the committed config acts as last known-good and the dashboard keeps working.

Until then the workflow skips this step (it is guarded on COST_SHEET_ID) and
config.json is edited directly in the repo.
"""
import sys
print(__doc__.splitlines()[0], file=sys.stderr)
print("mirror_sheet.py: stub — leaving config.json untouched", file=sys.stderr)
sys.exit(0)
