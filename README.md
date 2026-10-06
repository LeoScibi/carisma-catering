# Carisma Ops

Food cost, recipes and menus for Carisma Catering.
Static single-page app: plain HTML/CSS/JS, no build step, served from the repo root on GitHub Pages
(`leoscibi.github.io/carisma-catering`). Data lives in a Google Sheet, read and written directly from
the browser with the Sheets API v4. The app is a port of Conviviale Ops in Carisma's colours, plus Menus.

## Setup

1. **OAuth client** (Google Cloud Console → APIs & Services → Credentials): under *Authorised
   JavaScript origins* add `https://leoscibi.github.io` and, for local development, `http://localhost:8000`.
2. **Sheets API** must be enabled in the same Cloud project.
3. **Client ID and spreadsheet ID** go in `CONFIG` at the top of `js/config.js`. While either is blank,
   the app asks for it on first run and remembers it in that browser only: it asks for the client ID,
   then offers to create a new spreadsheet or connect an existing one. Once the spreadsheet exists,
   paste both IDs into `js/config.js` so everyone else just presses *Sign in*.
4. **Share the spreadsheet** (edit access) with everyone who should use the app. Sharing is the
   access control: anyone it is shared with can sign in.

On sign-in the app creates any missing tabs (SUPPLIERS, INGREDIENTS, SUPPLIER_PRICES, PRICE_HISTORY,
RECIPES, RECIPE_LINES, MENUS, MENU_LINES) with headers. If a tab exists but is missing a column, the
column is appended at the end. Nothing is ever removed or reordered.

### Converting the old Carisma Ops layout

The earlier multi-page app used a different layout (tabs Ingredients, Suppliers, SupplierIngredients,
Recipes, RecipeLines, Menus, MenuLines). Sheets treats `Ingredients` and `INGREDIENTS` as the same tab
name, so the two layouts can't sit side by side under their own names. When the app finds the old tabs
in its spreadsheet it asks to convert: the old tabs are renamed to `OLD_…` and kept as a backup, the new
tabs are created, and the data is copied across with new IDs. If the copy is interrupted, the next load
resumes it as long as the new tabs are still empty.

Old data in a *different* spreadsheet can be copied with *Account menu → Import from the old sheet*;
that spreadsheet is only read. Either way the copy runs only into empty tabs, so it can't duplicate
anything. Not carried over: saved costs (they are recalculated), and per-line supplier choices
(recipes use the ingredient's preferred supplier, or the cheapest).

## Local development

ES modules need to be served over HTTP:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Releasing

GitHub Pages lets browsers cache files for 10 minutes. To stop a phone mixing a new page with
old cached scripts, every file link carries a version (`?v=…`). On each release, bump the version
in `index.html` (one search-and-replace), and add any new `js/` module to the import map there.

## Layout

| File | Purpose |
| --- | --- |
| `js/config.js` | Client ID, spreadsheet ID, data model (tabs, headers, column types), allergen list |
| `js/auth.js` | Google Identity Services token client, session expiry |
| `js/sheets.js` | Sheets API wrapper: schema setup, read tables by header, append, update row by ID |
| `js/store.js` | In-memory cache, type coercion, ID generation (`SUP-0001`, `ING-0001`, `REC-0001`) |
| `js/costing.js` | Derived costs: price-list unit costs, preferred-else-cheapest price, yield |
| `js/recipe-cost.js` | Live recipe costing: line costs, sub-recipes, cost per portion, GP, allergen roll-up, loop guard |
| `js/legacy-import.js` | One-off import from the old Carisma Ops spreadsheet |
| `js/starter-ingredients.js` | Starter list of common ingredients for the "Add many" screen |
| `js/pricelist-paste.js` | Price-list parser (case vs per-kg price, pack sizes, sections) and product matching |
| `js/pdf-text.js` | Reads a PDF into text rows (pdf.js) |
| `js/units.js` | Recipe measurement families (weight / volume / each) and conversions |
| `js/recipe-paste.js` | Paste-a-recipe parser |
| `js/ui.js` | Escaping, formatting, toasts, form dialog |
| `js/views/*.js` | One module per screen; `prices.js` is the shared price-list entry form |
| `js/icons.js` | Line icons |
| `assets/` | Carisma logo (full, round badge) and home-screen icons |

## Brand

White `#ffffff`, near-black `#1c1c1c` and yellow `#f6d201`, defined as variables at the top of
`css/app.css` along with the greys derived from them. Yellow is a fill only (active tab, add button,
focus ring); text stays near-black. Type is Aboreto (headings, uppercase) and Montserrat (text).

The layout is designed for phones first: bottom tab bar, floating add button, card lists and
full-screen forms. It can be added to the home screen and opens like an app.

## Data rules

- Row 1 is headers. Columns are matched by header name, so you can reorder columns or add your
  own in the sheet. The app preserves them.
- Records link by ID, never by name.
- Only raw inputs are stored. Costs are computed in the app.
- Ingredients are generic: name, category, how they're measured (`UNIT`: g / ml / each), yield,
  allergens, and `DIETARY` (Vegan, Vegetarian, Gluten-free). Prices live in **SUPPLIER_PRICES**, one
  row per supplier + ingredient + pack, so an ingredient can have several suppliers (and a supplier
  several pack sizes).
- An ingredient's `SUPPLIER_ID` is its *preferred* supplier. Recipes use that supplier's price;
  if it's blank or the supplier has no price, the cheapest price per kg / L / each is used.
- Pack sizes are stored in `g`, `ml` or `each`. Forms accept kg, cl and L and convert them.
- Pack prices are ex VAT. Every new or changed price appends a row to PRICE_HISTORY with the date,
  supplier and an optional invoice reference.
- A supplier's price list can be uploaded as a PDF or pasted (from a spreadsheet or email). Products
  are matched to your ingredients; re-uploading next month's list updates prices in place, matched by
  product code, or by the supplier's product name.
- Ingredients are retired by unticking ACTIVE rather than deleted, so recipes keep working.
- Recipe costs are never stored. Cost per portion, GP and allergens are recalculated from the
  current ingredient prices every time, through any depth of sub-recipes.
- A recipe line's ITEM_TYPE is `ING` or `SUB`. Sub-recipes can be used by weight/volume (needs a
  batch yield) or by `portion` (needs PORTIONS). A sub-recipe that would loop back into the
  recipe can't be added.
- GP% is on the net price: SELL_PRICE is inc VAT, VAT_RATE defaults to 20% and TARGET_GP% to 70%.
- A menu (MENUS, MENU_LINES) lists recipes and how much of each is needed, in portions or in the
  recipe's batch-yield unit. Its shopping list is derived: sub-recipes are expanded down to raw
  ingredients, quantities are combined across the menu and grossed up for yield, and each line is
  costed at the price recipes use. A recipe that is on a menu can't be deleted.
