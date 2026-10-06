// One-off import from the old multi-page Carisma Ops layout (tabs Ingredients, Suppliers,
// SupplierIngredients, Recipes, RecipeLines, Menus, MenuLines). The old tabs are only read;
// everything is copied into this app's tabs with new IDs. Stored costs are not copied: costs
// are worked out live here.
//
// The old tabs can be in another spreadsheet, or in this one. In this one they first have to be
// renamed to OLD_…, because Sheets treats "Ingredients" and "INGREDIENTS" as the same tab name.

import * as sheets from './sheets.js';
import * as store from './store.js';
import { legacySpreadsheetId, spreadsheetId, sheetIdFrom } from './config.js';
import { normalisePack } from './costing.js';
import { normUnit } from './units.js';
import { formDialog, toast } from './ui.js';

const OLD_TABS = ['Suppliers', 'Ingredients', 'SupplierIngredients', 'Recipes', 'RecipeLines', 'Menus', 'MenuLines'];
const NEW_TABS = ['SUPPLIERS', 'INGREDIENTS', 'SUPPLIER_PRICES', 'RECIPES', 'RECIPE_LINES', 'MENUS', 'MENU_LINES'];
const MEASURE = { weight: 'g', volume: 'ml', unit: 'each' };
const PACK_UNITS = ['g', 'kg', 'ml', 'cl', 'l', 'each'];

const KEPT = 'OLD_';

/** Old-layout tabs still under their original names among `titles` (exact case). */
export const legacyTabsIn = titles => OLD_TABS.filter(t => titles.includes(t));
/** True if `titles` holds old tabs already set aside as OLD_…, ready to copy from. */
export const hasKeptTabs = titles => OLD_TABS.some(t => titles.includes(KEPT + t));

/** Set this spreadsheet's old tabs aside as OLD_… so the new tabs can be created. Nothing is deleted. */
export async function setAsideLegacyTabs() {
  await sheets.renameTabs(Object.fromEntries(OLD_TABS.map(t => [t, KEPT + t])));
}

/** Importing twice would duplicate everything, so it is only offered into an empty spreadsheet. */
export const canImport = () => NEW_TABS.every(tab => !store.rows(tab).length);

const text = v => String(v ?? '').trim();
const flag = v => ['yes', 'checked', 'true', 'x', '1', 'y'].includes(text(v).toLowerCase());
const num = v => (text(v) === '' || isNaN(v) ? '' : Number(v));
/** Old units were kg / g / L / ml / tsp / tbsp / pc. */
const unit = u => (normUnit(u) === 'pc' ? 'each' : normUnit(u));
const measureOf = r => MEASURE[text(r['MEASURE TYPE'] ?? r['YIELD MEASURE TYPE']).toLowerCase()] ?? '';

async function createMany(tab, records) {
  return records.length ? store.createMany(tab, records) : [];
}

/** Copy `rows` into `tab`; returns Map(old ID → new ID). */
async function copy(tab, rows, toRecord) {
  const ids = await createMany(tab, rows.map(toRecord));
  return new Map(rows.map((r, i) => [text(r.ID), ids[i]]));
}

async function run(source) {
  // In this app's own spreadsheet the old tabs live under OLD_…; elsewhere under their own names.
  const prefix = source === spreadsheetId() ? KEPT : '';
  const old = await sheets.readForeignTables(source, OLD_TABS.map(t => prefix + t));
  const rowsOf = tab => old[prefix + tab].rows.filter(r => text(r.ID));
  if (!rowsOf('Ingredients').length && !rowsOf('Suppliers').length && !rowsOf('Recipes').length) {
    throw new Error('No old Carisma Ops data found in that spreadsheet (it needs Ingredients, Suppliers or Recipes tabs).');
  }
  await store.loadAll();
  if (!canImport()) throw new Error('This spreadsheet already has data. The import only runs into an empty one, so nothing is duplicated.');

  const skipped = [];
  const supIds = await copy('SUPPLIERS', rowsOf('Suppliers').filter(r => text(r.NAME)), r => ({
    NAME: text(r.NAME), CONTACT: text(r.CONTACT), NOTES: text(r.NOTES),
  }));

  const oldIngs = rowsOf('Ingredients').filter(r => text(r.NAME));
  const ingIds = await copy('INGREDIENTS', oldIngs, r => ({
    NAME: text(r.NAME), CATEGORY: text(r.CATEGORY), UNIT: measureOf(r), STORAGE: text(r.STORAGE),
    SHELF_LIFE: text(r['SHELF LIFE']), ACTIVE: true,
    DIETARY: [['VEGAN', 'Vegan'], ['VEGETARIAN', 'Vegetarian'], ['GLUTEN FREE', 'Gluten-free']]
      .filter(([col]) => flag(r[col])).map(([, label]) => label).join(', '),
  }));

  const prices = [];
  for (const r of rowsOf('SupplierIngredients')) {
    const u = unit(r['PACK UNIT']);
    const ing = ingIds.get(text(r['INGREDIENT ID']));
    const sup = supIds.get(text(r['SUPPLIER ID']));
    if (!ing || !sup || !PACK_UNITS.includes(u.toLowerCase()) || !(Number(r['PACK SIZE']) > 0) || num(r.PRICE) === '') {
      skipped.push(`price ${text(r.ID)}`);
      continue;
    }
    const pack = normalisePack(Number(r['PACK SIZE']), u);
    prices.push({ SUPPLIER_ID: sup, ING_ID: ing, PACK_SIZE: pack.size, PACK_UNIT: pack.unit, PACK_PRICE: num(r.PRICE), UPDATED: store.today() });
  }
  const priceIds = await createMany('SUPPLIER_PRICES', prices);
  await store.logPrices(prices.map((p, i) => ({
    ING_ID: p.ING_ID, SUPPLIER_ID: p.SUPPLIER_ID, PRICE_ID: priceIds[i], PACK_PRICE: p.PACK_PRICE, INVOICE_REF: 'Imported',
  })));

  // A recipe that yielded "pc" was counted in portions; anything else is a batch by weight or volume.
  const oldRecs = rowsOf('Recipes').filter(r => text(r.NAME));
  const byPortion = new Map(oldRecs.map(r => [text(r.ID), measureOf(r) === 'each']));
  const yieldUnit = new Map(oldRecs.map(r => [text(r.ID), unit(r['YIELD UNIT'])]));
  const recIds = await copy('RECIPES', oldRecs, r => ({
    NAME: text(r.NAME), TYPE: /sub/i.test(text(r.TYPE)) ? 'sub' : 'dish',
    ...(byPortion.get(text(r.ID))
      ? { PORTIONS: num(r['YIELD AMOUNT']) }
      : { YIELD_QTY: num(r['YIELD AMOUNT']), YIELD_UNIT: yieldUnit.get(text(r.ID)) }),
  }));

  const sortOf = r => (num(r['SORT ORDER']) === '' ? Infinity : num(r['SORT ORDER']));
  const lines = [];
  const position = new Map();
  for (const r of rowsOf('RecipeLines').sort((a, b) => sortOf(a) - sortOf(b) || a._row - b._row)) {
    const isSub = /recipe/i.test(text(r['COMPONENT TYPE']));
    const oldItem = text(r['COMPONENT ID']);
    const rec = recIds.get(text(r['RECIPE ID']));
    const item = (isSub ? recIds : ingIds).get(oldItem);
    if (!rec || !item) { skipped.push(`recipe line ${text(r.ID)}`); continue; }
    const sort = (position.get(rec) || 0) + 1;
    position.set(rec, sort);
    lines.push({
      RECIPE_ID: rec, ITEM_TYPE: isSub ? 'SUB' : 'ING', ITEM_ID: item, QTY: num(r.QUANTITY),
      UNIT: isSub && byPortion.get(oldItem) ? 'portion' : unit(r.UNIT), SORT: sort,
    });
  }
  await createMany('RECIPE_LINES', lines);

  const menuIds = await copy('MENUS', rowsOf('Menus').filter(r => text(r.NAME)), r => ({ NAME: text(r.NAME) }));
  const menuLines = [];
  for (const r of rowsOf('MenuLines')) {
    const oldRec = text(r['RECIPE ID']);
    const menu = menuIds.get(text(r['MENU ID']));
    const rec = recIds.get(oldRec);
    if (!menu || !rec) { skipped.push(`menu line ${text(r.ID)}`); continue; }
    // The old quantity was "how much of the recipe's yield": portions, or its yield unit.
    menuLines.push({ MENU_ID: menu, RECIPE_ID: rec, QTY: num(r.QUANTITY), UNIT: byPortion.get(oldRec) ? 'portion' : yieldUnit.get(oldRec) });
  }
  await createMany('MENU_LINES', menuLines);

  return {
    counts: { suppliers: supIds.size, ingredients: ingIds.size, prices: prices.length, recipes: recIds.size, menus: menuIds.size },
    skipped,
  };
}

const summary = ({ counts: c, skipped }) =>
  `Imported ${c.ingredients} ingredients, ${c.suppliers} suppliers, ${c.prices} prices, ${c.recipes} recipes and ${c.menus} menus.`
  + (skipped.length ? ` Skipped ${skipped.length} incomplete rows (${skipped.slice(0, 5).join(', ')}${skipped.length > 5 ? '…' : ''}).` : '');

/** Copy this spreadsheet's own OLD_… tabs into the new ones; returns a one-line summary. */
export async function importKeptTabs() {
  try {
    return summary(await run(spreadsheetId()));
  } catch (err) {
    await store.loadAll().catch(() => {});
    if (!canImport()) err.message += ' The copy stopped part-way. In the spreadsheet, delete the rows under the headers of the new (capital-letter) tabs, then try again; the OLD_ tabs still hold everything.';
    throw err;
  }
}

export function openLegacyImport(onDone) {
  if (!canImport()) {
    toast('This spreadsheet already has data. The import only runs into an empty one.', 'error');
    return;
  }
  formDialog({
    title: 'Import from the old sheet',
    fields: [{
      name: 'SHEET', label: 'Old Carisma Ops spreadsheet (link or ID)', required: true, wide: true,
      hint: 'The old spreadsheet is only read. Nothing in it is changed.',
    }],
    values: { SHEET: legacySpreadsheetId() || spreadsheetId() },
    submitLabel: 'Import',
    extraHtml: `<p class="notice">Copies suppliers, ingredients, supplier prices, recipes with their lines, and menus into this
      spreadsheet. Saved costs are not copied: they are recalculated here from the prices. Per-line supplier choices are
      not carried over either: each recipe uses the ingredient's preferred supplier, or the cheapest.</p>`,
    onSubmit: async d => {
      let result;
      try {
        result = await run(sheetIdFrom(d.SHEET));
      } catch (err) {
        // A failure part-way leaves some tabs filled; say so rather than let a retry duplicate rows.
        await store.loadAll().catch(() => {});
        if (!canImport()) err.message += ' The import stopped part-way: clear the rows it added to this spreadsheet (keep the header rows), refresh, and try again.';
        throw err;
      }
      toast(summary(result));
      onDone?.();
    },
  });
}
