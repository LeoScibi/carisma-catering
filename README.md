# Carisma Ops — Ingredients, Suppliers & Recipes (v2)

Same architecture as before — static site, GitHub Pages, direct-to-Sheets via
OAuth, no server — replacing the flat 15-column ingredient schema with a
proper normalized structure: generic ingredients, suppliers, per-supplier
pricing, and recipes that can nest other recipes as sub-recipe components.

## What's here
```
index.html                Dashboard: config, sign-in, nav
setup.html                 Auto-creates the five required tabs + headers — run this first
ingredients.html            Generic ingredient master list (no cost)
suppliers.html               Supplier list
supplier-ingredients.html     Links ingredient + supplier + pack size/unit + price (cost lives here)
recipes.html                  Create recipes, add lines (ingredients or sub-recipes), see rolled-up cost
css/style.css                 Shared styling
js/config.js                  Shared config storage + Google auth
js/sheets.js                   Shared Sheets API read/append/update/batchUpdate helpers
js/units.js                    Shared weight/volume/unit conversion + ID generation
```

## The data model
- **Ingredients** — generic, no price. Just name, category, and a locked
  **measure type**: `Weight`, `Volume`, or `Unit`. This is how the ingredient
  is always used in a recipe, regardless of how any supplier packages it.
- **Suppliers** — just your supplier list.
- **SupplierIngredients** — the link table, and the only place cost lives.
  One row per ingredient + supplier combination: pack size, pack unit (must
  be in the same family as the ingredient's measure type — kg/g for Weight,
  L/ml for Volume, pc for Unit), price, and a calculated cost per base unit.
  The same ingredient can have several rows here, one per supplier.
- **Recipes** — a recipe is also a "thing" with its own measure type and
  yield (e.g. this recipe makes 2 kg, or 500 ml, or 12 pc). That's what lets
  a finished recipe be used as a component inside another recipe — a
  sub-recipe, treated exactly like an ingredient once it's built.
- **RecipeLines** — one row per component (ingredient or sub-recipe) inside
  a recipe: quantity, unit, and for ingredients, which supplier's price to
  use. Defaults to the cheapest supplier automatically but can be manually
  overridden per line. Recipe totals recalculate and get written back to the
  Recipes tab every time a line is added.

Everything converts through the same simple logic: grams ↔ kilos,
millilitres ↔ litres — metric only, no imperial, no generic conversion
engine, just fixed multipliers within each family.

## Spreadsheet setup — automatic
Point the app at any spreadsheet (existing or brand new) and go to
**Setup**. It creates whichever of the five required tabs are missing —
`Ingredients`, `Suppliers`, `SupplierIngredients`, `Recipes`, `RecipeLines`
— and writes the correct header row into any tab that's still empty. Safe
to re-run any time; it never overwrites a tab that already has a header.

## Suggested order of use
1. **Setup** — create the tabs.
2. **Ingredients** — add your generic ingredients with their measure type.
3. **Suppliers** — add your suppliers.
4. **Supplier Prices** — for each ingredient, add at least one supplier's
   pack size, pack unit, and price.
5. **Recipes** — create a recipe (e.g. a sub-recipe like a base sauce
   first), add its lines, then use it as a component inside another recipe.

## Deploying
Same GitHub Pages repo as before (`carisma-catering`,
`leoscibi.github.io/carisma-catering`):

1. Copy this folder's contents into the repo (e.g. replacing the old `app/`
   folder, or into a new `app2/` if you want to keep both versions live).
2. Commit and push — GitHub Pages serves it automatically.
3. Open `index.html` on the live site, paste your OAuth Client ID and
   Spreadsheet ID (can be the same spreadsheet as before, or a fresh one —
   this uses five new tab names, so it won't collide with the old
   `Ingredients`/`MenuItems`/`Quotes` tabs if you point it at the same file).
4. Go to **Setup** and click **Check & create tabs**.
5. Add ingredients → suppliers → supplier prices → recipes, in that order.

No changes needed to your OAuth Client ID or authorized origin.

## Known limitations
- No edit/delete yet on any tab — add + view only, same as the previous
  version. Fixing a mistake currently means editing the row directly in
  Google Sheets.
- A recipe's cost only recalculates when a line is *added* — if you edit a
  supplier's price after the fact, existing recipe lines won't reflect the
  new price until you re-add a line (or we build a "recalculate" button).
- No circular-reference check — nothing stops a recipe being added as a
  sub-recipe of itself two levels down. Keep sub-recipe chains shallow for
  now.
- The old `Ingredients`/`MenuItems`/`Quotes` v1 app (dashboard, ingredient
  form, quote builder) still exists separately — this is a parallel v2
  focused purely on the costing model. Once this is validated, the quote
  builder can be rebuilt on top of it to pull real recipe costs instead of
  the flat `MenuItems` placeholder pricing.

## Suggested next steps
1. Add a "Recalculate cost" button on Recipes to re-sum an existing
   recipe's lines on demand, for when a supplier price changes.
2. Edit/delete for all five tabs (needs row-number tracking).
3. Rebuild the quote builder on top of real recipe costs instead of
   placeholder `MenuItems` pricing.
4. A simple margin/markup field on Recipes, so quoted price vs. cost is
   visible at a glance.
