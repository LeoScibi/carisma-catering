# Carisma Ops — Ingredients, Suppliers & Recipes

This is **carisma-catering**, a costing/recipe tool for a catering business.
It is a separate project from `provisionslondon` — do not mix data models,
sheet schemas, or conventions between the two.

- **Repo:** `LeoScibi/carisma-catering` on GitHub, deployed via GitHub Pages
  at `leoscibi.github.io/carisma-catering`. Branch `main` only.
- **Architecture:** static site, no server/build step. Every page talks
  directly to a single Google Sheet via the Sheets API v4, authenticated
  client-side with Google OAuth (`js/config.js`, `js/sheets.js`).
- Commits get pushed straight to `main` — no PR step needed unless asked.

## Data model
- **Ingredients** — generic, no price. Name, category, and a locked measure
  type: `Weight`, `Volume`, or `Unit`.
- **Suppliers** — supplier list only.
- **SupplierIngredients** — the link table; the *only* place cost lives. One
  row per ingredient+supplier: pack size, pack unit (same family as the
  ingredient's measure type), price, calculated cost per base unit.
- **Recipes** — a recipe is itself a "thing" with its own measure type and
  yield, so a finished recipe can be used as a sub-recipe component inside
  another recipe.
- **RecipeLines** — one row per component (ingredient or sub-recipe) in a
  recipe: quantity, unit, and which supplier's price to use (defaults to
  cheapest, overridable). Recipe totals recalc and write back to the Recipes
  tab whenever a line is added.
- Unit conversion is metric-only, fixed multipliers within a family (g↔kg,
  ml↔L) — see `js/units.js`. No imperial, no generic conversion engine.

## Pages
```
index.html                 Dashboard: config, sign-in, nav
setup.html                  Auto-creates required tabs + headers — run first on a new sheet
ingredients.html             Generic ingredient master list
suppliers.html                 Supplier list
supplier-ingredients.html       Ingredient + supplier + pack size/unit + price
recipes.html                    Recipes, lines, rolled-up cost
menu.html, quotes.html            Quote builder (currently on placeholder MenuItems pricing)
```

## Known limitations (as of last README update)
- A recipe's cost only recalculates when a line is *added* — editing a
  supplier's price after the fact doesn't retroactively update existing
  recipe lines.
- No circular-reference check on sub-recipes.
- The quote builder still pulls flat `MenuItems` placeholder pricing rather
  than real recipe costs — rebuilding it on top of Recipes is a known next
  step.

## Working here
- Always confirm you're in `~/carisma-catering` (not a Downloads copy) and
  on a clean, up-to-date `main` before editing.
- Setup is safe to re-run: it only writes a tab's header row if that tab is
  still empty, never overwrites existing headers/data.
