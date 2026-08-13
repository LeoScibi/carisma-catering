# Carisma Ops — Internal Web App (v1)

Built on the OAuth + Google Sheets API pattern already validated in
`sheet-demo-oauth.html`. Same architecture, extended into a proper multi-page
app: shared config, shared sign-in session, and two working tools —
**Ingredients** and **Quotes**.

## What's here
```
index.html        Dashboard: config, sign-in, nav
setup.html         Auto-creates the required tabs + header rows — run this first
ingredients.html   Ingredient database (add + browse, 15-column schema)
quotes.html        Quote builder (menu/tier + guests -> total, saves to log)
css/style.css       Shared styling
js/config.js        Shared config storage + Google auth
js/sheets.js         Shared Sheets API read/append/batchUpdate helpers
```

## Spreadsheet setup — now automatic
You no longer need to manually create tabs or type header rows. Point the
app at any spreadsheet (existing or brand new) and go to **Setup**. It will:

1. Check which of the three required tabs already exist:
   `Ingredients`, `MenuItems`, `Quotes`
2. Create any that are missing, via the Sheets API (`spreadsheets.batchUpdate`)
3. Write the correct header row into any tab that's still empty, and bold it

Safe to re-run any time — it only creates what's missing and only writes
headers into tabs that don't already have one, so it won't overwrite data.

**MenuItems** is the one tab you still need to add real data to — Setup only
creates the header row (`MENU | TIER | PRICE PER PERSON | NOTES`). Add one
row per menu/tier combination directly in Sheets, e.g.:
```
Lunch | Essenziale | 18.00 | Boxed/individual
Lunch | Condiviso | 26.00 | Sharing platters
Lunch | Di Lusso | 38.00 | Hot dish, staffing required
Canapes & Evening | Reception | 24.00 |
```
Placeholder prices are fine until the pricing exercise wraps.

## Deploying
Same GitHub Pages repo as the demo (`carisma-catering`,
`leoscibi.github.io/carisma-catering`):

1. Copy this `app/` folder's contents into the repo (or a subfolder, e.g. `app/`).
2. Commit and push — GitHub Pages serves it automatically.
3. Open `index.html` on the live site, paste your OAuth Client ID and
   Spreadsheet ID, click **Save config**, then **Sign in with Google**.
4. Go to **Setup** and click **Check & create tabs**.
5. Navigate to Ingredients or Quotes — the session carries over, no
   re-entering config or re-signing in per page (until the token expires
   after ~1hr).

No changes needed to your OAuth Client ID or authorized origin — same origin
as the existing demo. Note: the OAuth scope already in use
(`https://www.googleapis.com/auth/spreadsheets`) covers structural changes
like adding tabs, so no new consent screen or scope approval is needed.

## What carried over from the demo
- Same OAuth flow (Google Identity Services, `spreadsheets` scope)
- Same gotchas apply: Spreadsheet ID only (not full URL); test users must be
  added manually while the consent screen is in Testing mode; tokens last
  ~1hr with no silent refresh yet.

## What's new in this build
- Config + sign-in session now shared across pages via `localStorage`,
  instead of re-entering everything per page.
- Ingredients: required-field validation (Ingredient, Code) and a
  duplicate-code check against existing rows before adding.
- Quotes: reads live pricing from `MenuItems`, calculates subtotal/fees/total
  in real time, and logs every saved quote.

## Suggested next steps
1. Seed `MenuItems` with real tiers/prices once the pricing exercise wraps.
2. Add edit/delete for ingredients (currently add + view only — Sheets API
   updates need the row number, which the app doesn't track yet).
3. Handle token expiry gracefully mid-session (currently: API calls just
   error out after ~1hr; a redirect-to-sign-in-again flow would be smoother).
4. Inflation tracker as the next tool, once Ingredients/Quotes are in daily use.
5. Optionally extend Setup to also seed starter `MenuItems` rows automatically
   once your real tiered pricing is finalized.
