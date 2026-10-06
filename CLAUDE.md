# Carisma Ops — food cost, recipes and menus

This is **carisma-catering**, a costing/recipe tool for a catering business.
It is a port of **Conviviale Ops** (`LeoScibi/conviviale`) in Carisma's colours, plus a Menus
section. It is a separate project from `provisionslondon` — do not mix data models, sheet
schemas, or conventions between the two.

- **Repo:** `LeoScibi/carisma-catering` on GitHub, deployed via GitHub Pages
  at `leoscibi.github.io/carisma-catering`. Branch `main` only.
- **Architecture:** static single-page app, ES modules, no server/build step. `index.html` is the
  only page; sections are hash routes (`#/ingredients`, `#/suppliers`, `#/recipes`, `#/menus`).
  It talks directly to one Google Sheet via the Sheets API v4, authenticated client-side with
  Google OAuth (`js/auth.js`, `js/sheets.js`).
- Commits get pushed straight to `main` — no PR step needed unless asked.
- `README.md` has the full setup, file layout and data rules. Keep it current.

## Data model (see `SCHEMA` in `js/config.js`)
- **SUPPLIERS**, **INGREDIENTS** (generic, measured in g / ml / each, no price),
  **SUPPLIER_PRICES** (the only place cost lives: supplier + ingredient + pack + price),
  **PRICE_HISTORY**, **RECIPES**, **RECIPE_LINES** (`ING` or `SUB` lines), **MENUS**, **MENU_LINES**.
- IDs look like `ING-0001`. Records link by ID, never by name. Columns are matched by header name.
- Nothing derived is stored: recipe costs, GP, allergens and menu shopping lists are recalculated
  from current prices every time (`js/costing.js`, `js/recipe-cost.js`, `js/views/menus.js`).
- Unit conversion is metric-only with fixed multipliers — see `js/units.js`.
- The pre-port app used a different sheet layout (Ingredients, SupplierIngredients, RecipeLines…).
  `js/legacy-import.js` copies that into the new layout, read-only on the old sheet, and only
  into an empty spreadsheet.

## Working here
- Always confirm you're in `~/carisma-catering` (not a Downloads copy) and
  on a clean, up-to-date `main` before editing.
- Views follow Conviviale's patterns: one module per screen in `js/views/`, `formDialog` for
  forms, `store` for all reads/writes. Match them rather than inventing new ones.
- Every `js/` module must be listed in the import map in `index.html`; bump the `?v=` version
  there on every release.
- The CLIENT_ID and SPREADSHEET_ID in `js/config.js` may be blank; the app then asks on first
  run and stores them per browser.
