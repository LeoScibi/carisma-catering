// Menus: a named list of recipes and how much of each an event needs, with a consolidated
// shopping list. Nothing derived is stored: quantities and costs are worked out from the
// current recipes and price lists every time.

import * as store from '../store.js';
import { icons } from '../icons.js';
import { esc, money, formDialog, toast, reportError, byName, sameName, matches, option, parkToasts } from '../ui.js';
import { chosenPrice, ingredientUnit, yieldFraction, packLabel, unitCost } from '../costing.js';
import { createCoster, ingredientFamily } from '../recipe-cost.js';
import { BASE, unitsFor, toBase, normUnit, fmtQty } from '../units.js';
import { supplierName } from './prices.js';

const state = { q: '' };
let root;

export function render(el, param) {
  root = el;
  el.innerHTML = `
    <div class="page-head">
      <div>
        <p class="overline" data-count></p>
        <h1 class="title">Menus</h1>
      </div>
      <button class="btn primary add-desktop" data-add>${icons.plus} New menu</button>
    </div>
    <div class="toolbar">
      <label class="search-wrap">${icons.search}
        <input type="search" class="search" data-q value="${esc(state.q)}" placeholder="Search menus" aria-label="Search menus">
      </label>
    </div>
    <div data-list></div>
    <button class="fab" data-add aria-label="New menu">${icons.plus}</button>`;

  el.querySelector('[data-q]').addEventListener('input', e => { state.q = e.target.value; renderList(); });
  el.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => openMenuForm(null)));
  el.querySelector('[data-list]').addEventListener('click', e => {
    const hit = e.target.closest('.card-hit');
    if (hit) location.hash = `#/menus/${encodeURIComponent(hit.dataset.id)}`;
  });
  renderList();

  if (param) openDetail(param);
  else closeDetail();
}

const linesOf = menuId => store.rows('MENU_LINES').filter(l => String(l.MENU_ID) === String(menuId));
const qtyText = (qty, unit) => `${fmtQty(qty)} ${unit === 'portion' && Number(qty) !== 1 ? 'portions' : unit}`;

/** Units a recipe can be ordered in on a menu: portions, or its batch yield by weight / volume. */
function unitOptions(c) {
  const byYield = c.yieldBase ? unitsFor(c.family).filter(u => u !== 'tsp' && u !== 'tbsp') : [];
  return ['portion', ...byYield];
}

const defaultUnit = c => (Number(c.rec?.PORTIONS) > 0 || !c.yieldBase ? 'portion' : BASE[c.family]);

/** How many batches of the recipe a menu line needs, or null if its unit doesn't fit the recipe. */
function batches(c, qty, unit) {
  const u = normUnit(unit);
  const n = Number(qty) || 0;
  if (u === 'portion') return n / c.portions;
  const base = c.yieldBase ? toBase(c.family, n, u) : null;
  return base == null ? null : base / c.yieldBase;
}

/**
 * Everything derived for one menu: each line's cost, and the ingredients to buy, with
 * sub-recipes expanded down to raw ingredients and quantities combined across the menu.
 */
function build(menuId, coster = createCoster()) {
  const need = new Map(); // ING_ID → usable quantity in g / ml / each
  const problems = new Set();

  function expand(recipeId, factor, trail = []) {
    if (trail.includes(String(recipeId))) return;
    const c = coster.cost(recipeId);
    for (const lc of c.lines) {
      const l = lc.line;
      if (!lc.item) { problems.add(`${c.rec?.NAME}: a line points at something that was deleted`); continue; }
      if (lc.type === 'SUB') {
        const sub = coster.cost(l.ITEM_ID);
        const b = batches(sub, l.QTY, l.UNIT);
        if (b == null) problems.add(`${c.rec.NAME}: ${lc.item.NAME} is in a unit that doesn't fit its yield`);
        else expand(l.ITEM_ID, factor * b, [...trail, String(recipeId)]);
        continue;
      }
      const fam = ingredientFamily(lc.item);
      const base = fam ? toBase(fam, l.QTY, l.UNIT) : null;
      if (base == null) { problems.add(`${c.rec.NAME}: ${lc.item.NAME} is in a unit that doesn't fit how it's measured`); continue; }
      const id = String(lc.item.ING_ID);
      need.set(id, (need.get(id) || 0) + base * factor);
    }
  }

  const lines = linesOf(menuId).map(l => {
    const rec = coster.recs.get(String(l.RECIPE_ID));
    if (!rec) return { line: l, rec: null, cost: 0, problem: 'Recipe deleted' };
    const c = coster.cost(l.RECIPE_ID);
    const b = batches(c, l.QTY, l.UNIT);
    if (b == null) return { line: l, rec, c, cost: 0, problem: 'Unit mismatch' };
    expand(l.RECIPE_ID, b);
    return { line: l, rec, c, cost: b * c.total, problem: c.unpriced ? `${c.unpriced} not costed` : null };
  });

  const shopping = [...need].map(([id, usable]) => {
    const ing = coster.ings.get(id);
    // Buy enough to be left with the usable amount after trim and waste.
    const qty = usable / (yieldFraction(ing) || 1);
    const rate = unitCost(ing);
    const price = chosenPrice(ing)?.price;
    return { ing, qty, unit: ingredientUnit(ing), cost: rate == null ? null : qty * rate, price };
  }).sort((a, b) => byName(a.ing, b.ing));

  return {
    lines, shopping, problems: [...problems],
    total: lines.reduce((s, l) => s + l.cost, 0),
    unpriced: shopping.filter(s => s.cost == null).length,
  };
}

function renderList() {
  if (!root?.isConnected) return;
  const all = store.rows('MENUS');
  const list = all.filter(m => matches(state.q, m.NAME, m.NOTES, m.MENU_ID)).sort(byName);
  root.querySelector('[data-count]').textContent =
    list.length === all.length ? `${all.length} saved` : `${list.length} of ${all.length}`;

  if (!list.length) {
    root.querySelector('[data-list]').innerHTML = `<div class="empty">${
      all.length ? 'No menus match your search.' : 'No menus yet. Create one, add recipes, and get a shopping list.'}</div>`;
    return;
  }

  const coster = createCoster();
  root.querySelector('[data-list]').innerHTML = `<div class="cards">${list.map(m => {
    const b = build(m.MENU_ID, coster);
    const n = b.lines.length;
    return `
    <article class="card">
      <button class="card-hit" data-id="${esc(m.MENU_ID)}" aria-label="Open ${esc(m.NAME)}"></button>
      <div class="card-top">
        <div>
          <div class="card-name">${esc(m.NAME)}</div>
          <div class="card-sub">${n ? `${n} recipe${n === 1 ? '' : 's'}` : 'No recipes yet'}</div>
        </div>
        <div class="card-figure"><strong>${n ? money(b.total) : '—'}</strong><span>est. food cost</span></div>
      </div>
      <div class="card-meta">
        ${b.shopping.length ? `<span><b>${b.shopping.length}</b> ingredient${b.shopping.length === 1 ? '' : 's'} to buy</span>` : ''}
        ${b.unpriced ? `<span class="warn">${b.unpriced} not costed</span>` : ''}
        ${m.NOTES ? `<span>${esc(m.NOTES)}</span>` : ''}
      </div>
    </article>`;
  }).join('')}</div>`;
}

// ============================================================ menu form

const FIELDS = [
  { name: 'NAME', label: 'Menu name', required: true, wide: true, placeholder: 'e.g. Smith wedding, 60 guests' },
  { name: 'NOTES', label: 'Notes', type: 'textarea', rows: 2, wide: true },
];

function openMenuForm(menu) {
  const isNew = !menu;
  formDialog({
    title: isNew ? 'New menu' : `Edit ${menu.NAME}`,
    fields: FIELDS,
    values: menu || {},
    submitLabel: isNew ? 'Create menu' : 'Save changes',
    onSubmit: async data => {
      const clash = store.rows('MENUS').find(m => sameName(m.NAME, data.NAME) && m.MENU_ID !== menu?.MENU_ID);
      if (clash) throw new Error(`A menu called “${clash.NAME}” already exists.`);
      if (isNew) {
        const id = await store.create('MENUS', data);
        toast(`Created ${data.NAME}`);
        location.hash = `#/menus/${encodeURIComponent(id)}`;
      } else {
        await store.update('MENUS', menu.MENU_ID, data);
        toast(`Saved ${data.NAME}`);
        refresh();
      }
    },
  });
}

// ============================================================ menu sheet

let dlg = null;
const ds = { id: null, recipe: '', qty: '', unit: '', busy: false };

function ensureDialog() {
  if (dlg) return;
  dlg = document.createElement('dialog');
  dlg.className = 'modal recipe-sheet menu-sheet';
  dlg.innerHTML = `
    <div class="modal-form">
      <header class="modal-head">
        <div class="head-text">
          <p class="overline" data-d-overline></p>
          <h2 data-d-title></h2>
        </div>
        <button type="button" class="icon-btn" data-act="close" aria-label="Close">&times;</button>
      </header>
      <div class="modal-body" data-d-body></div>
      <footer class="modal-foot">
        <button type="button" class="btn danger foot-left" data-act="delete">Delete</button>
        <button type="button" class="btn" data-act="duplicate">Duplicate</button>
        <button type="button" class="btn" data-act="edit">Rename</button>
        <button type="button" class="btn primary" data-act="copy">Copy shopping list</button>
      </footer>
    </div>`;
  document.body.append(dlg);
  dlg.addEventListener('close', () => {
    parkToasts();
    ds.id = null;
    if (/^#\/menus\/./.test(location.hash)) location.hash = '#/menus';
  });
  dlg.addEventListener('click', onClick);
  dlg.addEventListener('change', e => {
    if (e.target.matches('[data-add-recipe]')) {
      ds.recipe = e.target.value;
      ds.unit = ds.recipe ? defaultUnit(createCoster().cost(ds.recipe)) : '';
      renderDetail();
    } else if (e.target.matches('[data-add-unit]')) ds.unit = e.target.value;
  });
  dlg.addEventListener('input', e => { if (e.target.matches('[data-add-qty]')) ds.qty = e.target.value; });
  dlg.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.matches('[data-add-qty]')) { e.preventDefault(); addLine(); }
  });
}

function refresh() {
  renderDetail();
  renderList();
}

function openDetail(id) {
  if (!store.byId('MENUS', id)) {
    toast('That menu no longer exists.', 'error');
    location.hash = '#/menus';
    return;
  }
  ensureDialog();
  if (ds.id !== id) Object.assign(ds, { id, recipe: '', qty: '', unit: '' });
  if (!dlg.open) dlg.showModal();
  parkToasts();
  renderDetail();
}

function closeDetail() {
  if (dlg?.open) dlg.close();
}

/** Run a write, keeping the sheet open and dimmed while it saves. */
async function run(fn, done) {
  if (ds.busy) return;
  ds.busy = true;
  dlg.classList.add('busy');
  try {
    await fn();
    if (done) toast(done);
  } catch (err) {
    reportError(err);
  } finally {
    ds.busy = false;
    dlg.classList.remove('busy');
    refresh();
  }
}

function lineHtml(l) {
  const name = l.rec?.NAME ?? `${l.line.RECIPE_ID} (deleted)`;
  return `
    <div class="line${l.problem ? ' flag' : ''}">
      <div class="menu-line">
        <span class="line-text">
          <span class="line-name">${esc(name)}</span>
          <span class="line-sub">${l.problem ? `<span class="warn">${esc(l.problem)}</span>` : l.rec ? `${money(l.c.perPortion)}/portion` : ''}</span>
        </span>
        <span class="line-qty">${esc(qtyText(l.line.QTY, normUnit(l.line.UNIT)))}</span>
        <span class="line-cost">${money(l.cost)}</span>
        <button type="button" class="icon-btn sm" data-remove="${esc(l.line.LINE_ID)}" aria-label="Remove ${esc(name)}">&times;</button>
      </div>
    </div>`;
}

function addHtml(coster) {
  const recipes = store.rows('RECIPES').slice().sort(byName);
  const c = ds.recipe ? coster.cost(ds.recipe) : null;
  const units = c ? unitOptions(c) : [];
  return `
    <div class="menu-add">
      <select data-add-recipe aria-label="Recipe">
        <option value="">Add a recipe…</option>
        ${recipes.map(r => option(r.RECIPE_ID, r.NAME, ds.recipe)).join('')}
      </select>
      <input type="number" min="0" step="any" inputmode="decimal" data-add-qty value="${esc(ds.qty)}" placeholder="Qty" aria-label="Quantity needed">
      ${units.length > 1
        ? `<select data-add-unit aria-label="Unit">${units.map(u => option(u, u === 'portion' ? 'portions' : u, ds.unit)).join('')}</select>`
        : `<span class="unit">${c ? 'portions' : ''}</span>`}
      <button type="button" class="btn primary" data-act="add"${c ? '' : ' disabled'}>${icons.plus} Add</button>
    </div>
    ${c ? `<p class="hint">${Number(c.rec.PORTIONS) > 0 ? `One batch makes ${fmtQty(c.portions)} portion${c.portions === 1 ? '' : 's'}.` : 'This recipe has no portion count, so one portion is one whole batch.'}${
      c.yieldBase ? ` Batch yield ${esc(packLabel(c.yieldBase, BASE[c.family]))}.` : ''}</p>` : ''}`;
}

function shoppingHtml(b) {
  if (!b.shopping.length) return '<p class="muted small">Add recipes to see what to buy.</p>';
  const groups = new Map();
  for (const s of b.shopping) {
    const cat = s.ing.CATEGORY || 'Uncategorised';
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(s);
  }
  return [...groups].sort(([a], [z]) => a.localeCompare(z)).map(([cat, items]) => `
    <div class="shop-group">
      <h4>${esc(cat)}</h4>
      ${items.map(s => `
        <div class="shop-row">
          <span class="pr-main">${esc(s.ing.NAME)}
            <small>${s.price ? `${esc(supplierName(s.price.SUPPLIER_ID))} · ${esc(packLabel(s.price.PACK_SIZE, s.price.PACK_UNIT))} for ${money(s.price.PACK_PRICE)}` : '<span class="warn">No supplier price</span>'}</small>
          </span>
          <span class="pr-cost"><b>${esc(packLabel(s.qty, s.unit))}</b><small>${s.cost == null ? '—' : money(s.cost)}</small></span>
        </div>`).join('')}
    </div>`).join('');
}

function renderDetail() {
  if (!dlg || !ds.id) return;
  const menu = store.byId('MENUS', ds.id);
  if (!menu) { closeDetail(); return; }
  const coster = createCoster();
  const b = build(ds.id, coster);
  const n = b.lines.length;
  dlg.querySelector('[data-d-overline]').textContent = `Menu · ${n} recipe${n === 1 ? '' : 's'}`;
  dlg.querySelector('[data-d-title]').textContent = menu.NAME;
  dlg.querySelector('[data-d-body]').innerHTML = `
    <section class="summary">
      <div class="summary-main">
        <div class="stat-big">
          <span class="overline">Estimated food cost</span>
          <strong>${money(b.total)}</strong>
          <small>${b.unpriced ? `${b.unpriced} ingredient${b.unpriced === 1 ? '' : 's'} not costed, so this is low` : 'from current supplier prices, ex VAT'}</small>
        </div>
      </div>
      ${menu.NOTES ? `<p class="small muted method">${esc(menu.NOTES)}</p>` : ''}
    </section>
    <section class="detail-block">
      <h3 class="section-title">Recipes on this menu</h3>
      <div class="lines">${n ? b.lines.map(lineHtml).join('') : '<p class="muted small lines-empty">Nothing on this menu yet.</p>'}</div>
      ${addHtml(coster)}
    </section>
    ${b.problems.length ? `<p class="notice">${b.problems.map(esc).join('<br>')}</p>` : ''}
    <section class="detail-block">
      <div class="section-head"><h3 class="section-title">Shopping list</h3><b>${b.shopping.length ? money(b.total) : ''}</b></div>
      ${shoppingHtml(b)}
    </section>`;
}

function addLine() {
  const qty = Number(ds.qty);
  if (!ds.recipe) return;
  if (!(qty > 0)) { toast('Enter how much you need.', 'error'); return; }
  const name = store.byId('RECIPES', ds.recipe)?.NAME;
  const record = { MENU_ID: ds.id, RECIPE_ID: ds.recipe, QTY: qty, UNIT: ds.unit || 'portion' };
  run(async () => {
    await store.create('MENU_LINES', record);
    Object.assign(ds, { recipe: '', qty: '', unit: '' });
  }, `Added ${name}`);
}

function shoppingText(menu, b) {
  const out = [`Shopping list: ${menu.NAME}`, ''];
  let cat = null;
  for (const s of b.shopping.slice().sort((a, z) => (a.ing.CATEGORY || 'Uncategorised').localeCompare(z.ing.CATEGORY || 'Uncategorised') || byName(a.ing, z.ing))) {
    const c = s.ing.CATEGORY || 'Uncategorised';
    if (c !== cat) { if (cat !== null) out.push(''); out.push(c.toUpperCase()); cat = c; }
    out.push(`- ${s.ing.NAME}: ${packLabel(s.qty, s.unit)}${s.price ? ` (${supplierName(s.price.SUPPLIER_ID)})` : ''}`);
  }
  out.push('', `Estimated food cost: ${money(b.total)}`);
  return out.join('\n');
}

function onClick(e) {
  const remove = e.target.closest('[data-remove]');
  if (remove) {
    if (confirm('Remove this recipe from the menu?')) run(() => store.remove({ MENU_LINES: [remove.dataset.remove] }));
    return;
  }
  const act = e.target.closest('[data-act]')?.dataset.act;
  const menu = store.byId('MENUS', ds.id);
  if (act === 'close') dlg.close();
  else if (act === 'add') addLine();
  else if (act === 'edit') openMenuForm(menu);
  else if (act === 'copy') {
    navigator.clipboard.writeText(shoppingText(menu, build(ds.id)))
      .then(() => toast('Shopping list copied'), () => toast('Could not copy. Your browser blocked the clipboard.', 'error'));
  } else if (act === 'duplicate') {
    const names = new Set(store.rows('MENUS').map(m => String(m.NAME).toLowerCase()));
    let name = `${menu.NAME} (copy)`;
    for (let i = 2; names.has(name.toLowerCase()); i++) name = `${menu.NAME} (copy ${i})`;
    const lines = linesOf(ds.id);
    run(async () => {
      const id = await store.create('MENUS', { NAME: name, NOTES: menu.NOTES });
      if (lines.length) {
        await store.createMany('MENU_LINES', lines.map(l => ({ MENU_ID: id, RECIPE_ID: l.RECIPE_ID, QTY: l.QTY, UNIT: l.UNIT })));
      }
      location.hash = `#/menus/${encodeURIComponent(id)}`;
    }, `Created ${name}`);
  } else if (act === 'delete') {
    const lineIds = linesOf(ds.id).map(l => l.LINE_ID);
    if (!confirm(`Delete “${menu.NAME}”? This can't be undone.`)) return;
    const name = menu.NAME;
    run(async () => {
      await store.remove({ MENU_LINES: lineIds, MENUS: [ds.id] });
      closeDetail();
    }, `Deleted ${name}`);
  }
}
