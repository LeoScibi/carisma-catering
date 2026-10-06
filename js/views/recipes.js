// Recipes: list, recipe builder (lines, sub-recipes, scaling, GP vs target, allergen
// roll-up) and the paste-a-recipe importer. Modelled on Carisma Ops' recipe modal, but every
// cost is computed live from raw inputs, so nothing ever needs "refreshing".

import * as store from '../store.js';
import { RECIPE_TYPES, RECIPE_DEFAULTS } from '../config.js';
import { icons } from '../icons.js';
import { esc, money, formDialog, toast, reportError, byName, sameName, matches, parkToasts } from '../ui.js';
import { formatUnitCost, usableUnitCost, chosenPrice } from '../costing.js';
import { createCoster, ingredientFamily, isSub } from '../recipe-cost.js';
import { BASE, unitsFor, unitLabel, fmtQty, normUnit, familyOf, toBase } from '../units.js';
import { parseRecipeText, normName } from '../recipe-paste.js';
import * as ingredientsView from './ingredients.js';

const TYPE_LABEL = Object.fromEntries(RECIPE_TYPES);
const typeOf = rec => String(rec?.TYPE || 'dish').toLowerCase();
const ALL_UNITS = ['g', 'kg', 'ml', 'cl', 'L', 'tsp', 'tbsp', 'each'];

const state = { q: '', type: '', belowTarget: false };
let root;

// ============================================================ list

export function render(el, param) {
  root = el;
  el.innerHTML = `
    <div class="page-head">
      <div>
        <p class="overline" data-count></p>
        <h1 class="title">Recipes</h1>
      </div>
      <button class="btn primary add-desktop" data-add>${icons.plus} New recipe</button>
    </div>
    <div class="toolbar">
      <label class="search-wrap">${icons.search}
        <input type="search" class="search" data-q value="${esc(state.q)}" placeholder="Search recipes" aria-label="Search recipes">
      </label>
      <div class="filters" role="radiogroup" aria-label="Recipe type">
        ${[['', 'All'], ['dish', 'Dishes'], ['drink', 'Drinks'], ['sub', 'Sub-recipes']].map(([v, label]) => `
          <label class="toggle-chip"><input type="radio" name="rtype" value="${v}"${state.type === v ? ' checked' : ''}> ${label}</label>`).join('')}
        <label class="toggle-chip"><input type="checkbox" data-below${state.belowTarget ? ' checked' : ''}> Below GP target</label>
      </div>
    </div>
    <div data-list></div>
    <button class="fab" data-add aria-label="New recipe">${icons.plus}</button>`;

  el.querySelector('[data-q]').addEventListener('input', e => { state.q = e.target.value; renderList(); });
  el.querySelectorAll('input[name=rtype]').forEach(r => r.addEventListener('change', e => { state.type = e.target.value; renderList(); }));
  el.querySelector('[data-below]').addEventListener('change', e => { state.belowTarget = e.target.checked; renderList(); });
  el.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => openRecipeForm(null)));
  el.querySelector('[data-list]').addEventListener('click', e => {
    const hit = e.target.closest('.card-hit');
    if (hit) location.hash = `#/recipes/${encodeURIComponent(hit.dataset.id)}`;
  });
  renderList();

  if (param) openDetail(param);
  else closeDetail();
}

function describeYield(rec) {
  const parts = [];
  if (rec.YIELD_QTY !== '' && rec.YIELD_UNIT) parts.push(`makes ${fmtQty(rec.YIELD_QTY)} ${normUnit(rec.YIELD_UNIT)}`);
  if (Number(rec.PORTIONS) > 0) parts.push(`${fmtQty(rec.PORTIONS)} portion${Number(rec.PORTIONS) === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

function gpChip(c) {
  if (c.gpPct == null) return '';
  return `<span class="gp-chip ${c.onTarget ? 'ok' : 'low'}">GP ${c.gpPct.toFixed(0)}%<small> / ${fmtQty(c.target)}%</small></span>`;
}

/** Headline figure: cost per kg/L for a sub-recipe with a yield, otherwise per portion. */
function headline(c) {
  if (isSub(c.rec) && c.perBase != null) return [formatUnitCost(c.perBase, BASE[c.family]), 'cost'];
  return [money(c.perPortion), 'per portion'];
}

function renderList() {
  if (!root?.isConnected) return;
  const coster = createCoster();
  const all = store.rows('RECIPES');
  const list = all
    .filter(r => !state.type || typeOf(r) === state.type)
    .filter(r => matches(state.q, r.NAME, TYPE_LABEL[typeOf(r)] ?? '', r.RECIPE_ID))
    .map(r => ({ r, c: coster.cost(r.RECIPE_ID) }))
    .filter(x => !state.belowTarget || x.c.onTarget === false)
    .sort((a, b) => byName(a.r, b.r));

  root.querySelector('[data-count]').textContent =
    list.length === all.length ? `${all.length} on file` : `${list.length} of ${all.length}`;

  const listEl = root.querySelector('[data-list]');
  if (!list.length) {
    listEl.innerHTML = `<div class="empty">${all.length ? 'No recipes match these filters.' : 'No recipes yet. Create your first one to get started.'}</div>`;
    return;
  }

  listEl.innerHTML = `<div class="cards">${list.map(({ r, c }) => {
    const [fig, figLabel] = headline(c);
    const sub = isSub(r);
    const lineCount = c.lines.length;
    return `
    <article class="card">
      <button class="card-hit" data-id="${esc(r.RECIPE_ID)}" aria-label="Open ${esc(r.NAME)}"></button>
      <div class="card-top">
        <div>
          <div class="card-name">${esc(r.NAME)}</div>
          <div class="card-sub">${esc([TYPE_LABEL[typeOf(r)] ?? r.TYPE, describeYield(r)].filter(Boolean).join(' · '))}</div>
        </div>
        <div class="card-figure"><strong>${fig}</strong><span>${figLabel}</span></div>
      </div>
      <div class="card-meta">
        ${sub ? `<span>Batch <b>${money(c.total)}</b></span>`
          : c.sell != null ? `<span>Sells <b>${money(c.sell)}</b></span>${gpChip(c)}` : '<span>No sell price yet</span>'}
        <span>${lineCount ? `${lineCount} line${lineCount === 1 ? '' : 's'}` : 'No ingredients yet'}</span>
        ${c.unpriced ? `<span class="warn">${c.unpriced} not costed</span>` : ''}
      </div>
      ${c.allergens.length ? `<div class="tags">${c.allergens.map(a => `<span class="tag allergen">${esc(a)}</span>`).join('')}</div>` : ''}
    </article>`;
  }).join('')}</div>`;
}

// ============================================================ recipe form

function recipeFields() {
  return [
    { name: 'NAME', label: 'Recipe name', required: true, wide: true },
    { name: 'TYPE', label: 'Type', type: 'select', options: RECIPE_TYPES, half: true },
    { name: 'PORTIONS', label: 'Portions', type: 'number', min: 0.01, step: 'any', inputmode: 'decimal', half: true,
      hint: 'How many it serves' },
    { name: 'YIELD_QTY', label: 'Batch yield', type: 'number', min: 0, step: 'any', inputmode: 'decimal', half: true,
      hint: 'Lets it be used by weight or volume' },
    { name: 'YIELD_UNIT', label: 'Yield unit', type: 'select', options: [['', '—'], 'g', 'kg', 'ml', 'cl', 'L', 'each'], half: true },
    { name: 'SELL_PRICE', label: 'Sell price £', type: 'number', min: 0, step: 0.01, inputmode: 'decimal', half: true,
      hint: 'Per portion, inc VAT' },
    { name: 'VAT_RATE', label: 'VAT %', type: 'number', min: 0, max: 100, step: 'any', inputmode: 'decimal', half: true,
      hint: `Blank = ${RECIPE_DEFAULTS.VAT_RATE}%` },
    { name: 'TARGET_GP%', label: 'Target GP %', type: 'number', min: 0, max: 99, step: 'any', inputmode: 'decimal', half: true,
      hint: `Blank = ${RECIPE_DEFAULTS.TARGET_GP}%` },
    { name: 'METHOD', label: 'Method', type: 'textarea', rows: 6, wide: true },
  ];
}

function openRecipeForm(rec) {
  const isNew = !rec;
  formDialog({
    title: isNew ? 'New recipe' : `Edit ${rec.NAME}`,
    fields: isNew ? [...recipeFields(), {
      name: 'INGREDIENT_LIST', label: 'Ingredients (optional)', type: 'textarea', rows: 6, wide: true,
      placeholder: '200 g celery\n300 g white onion\n1 l chicken stock',
      hint: 'Paste one per line. You\u2019ll check the matches before anything is added.',
    }] : recipeFields(),
    values: rec || { TYPE: state.type || 'dish', PORTIONS: 1 },
    submitLabel: isNew ? 'Create recipe' : 'Save changes',
    onSubmit: async d => {
      const clash = store.rows('RECIPES').find(r => sameName(r.NAME, d.NAME) && r.RECIPE_ID !== rec?.RECIPE_ID);
      if (clash) throw new Error(`A recipe called “${clash.NAME}” already exists (${clash.RECIPE_ID}).`);
      if ((d.YIELD_QTY === '') !== (d.YIELD_UNIT === '')) throw new Error('Enter both the batch yield and its unit, or leave both blank.');
      if (d.YIELD_QTY !== '' && !(d.YIELD_QTY > 0)) throw new Error('Batch yield must be greater than zero.');
      if (d.PORTIONS !== '' && !(d.PORTIONS > 0)) throw new Error('Portions must be greater than zero.');
      if (d.TYPE === 'sub' && d.YIELD_QTY === '' && d.PORTIONS === '') {
        throw new Error('A sub-recipe needs a batch yield or a number of portions, so other recipes can use it.');
      }
      if (isNew) {
        const { INGREDIENT_LIST: list, ...recipe } = d;
        const id = await store.create('RECIPES', recipe);
        toast(`Created ${d.NAME}`);
        pendingPaste = list?.trim() ? list : null;
        location.hash = `#/recipes/${encodeURIComponent(id)}`;
      } else {
        await store.update('RECIPES', rec.RECIPE_ID, d);
        toast(`Saved ${d.NAME}`);
        renderList();
        if (ds.id === rec.RECIPE_ID) renderDetail();
      }
    },
  });
}

// ============================================================ recipe detail

const ds = { id: null, open: null, swap: null, swapQ: '', add: emptyAdd(), scaleTo: '', busy: false };
let pendingPaste = null; // ingredient list typed into the New recipe form, read once it opens
let dlg = null;

function emptyAdd() { return { q: '', pick: null, qty: '', unit: '' }; }

function ensureDialog() {
  if (dlg) return;
  dlg = document.createElement('dialog');
  dlg.className = 'modal recipe-sheet';
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
        <button type="button" class="btn" data-act="paste">Paste list</button>
        <button type="button" class="btn" data-act="edit">Edit details</button>
        <button type="button" class="btn danger" data-act="delete">Delete</button>
      </footer>
    </div>`;
  document.body.append(dlg);
  dlg.addEventListener('close', () => {
    // A close event can arrive after the sheet has already been reopened for another record;
    // acting on it then would shut the new one.
    if (dlg.open) return;
    parkToasts();
    ds.id = null;
    if (/^#\/recipes\/./.test(location.hash)) location.hash = '#/recipes';
  });
  dlg.addEventListener('click', onDetailClick);
  dlg.addEventListener('input', onDetailInput);
  dlg.addEventListener('change', onDetailChange);
  dlg.addEventListener('keydown', onDetailKeydown);
}

export function openDetail(id) {
  if (!store.byId('RECIPES', id)) {
    toast('That recipe no longer exists.', 'error');
    location.hash = '#/recipes';
    return;
  }
  ensureDialog();
  if (ds.id !== id) Object.assign(ds, { id, open: null, swap: null, swapQ: '', add: emptyAdd(), scaleTo: '' });
  if (!dlg.open) dlg.showModal();
  parkToasts();
  renderDetail();
  dlg.querySelector('.modal-body').scrollTop = 0;
  if (pendingPaste) {
    const text = pendingPaste;
    pendingPaste = null;
    openPaste(text);
  }
}

function closeDetail() {
  if (dlg?.open) dlg.close();
}

function scaleBasis(rec) {
  if (Number(rec.PORTIONS) > 0) return { base: Number(rec.PORTIONS), label: 'portions' };
  if (Number(rec.YIELD_QTY) > 0) return { base: Number(rec.YIELD_QTY), label: normUnit(rec.YIELD_UNIT) };
  return { base: 1, label: 'portions' };
}

function scaleFactor(rec) {
  const { base } = scaleBasis(rec);
  const t = Number(ds.scaleTo);
  return ds.scaleTo !== '' && t > 0 && base > 0 ? t / base : 1;
}

function summaryHtml(c) {
  const rec = c.rec;
  if (isSub(rec)) {
    const stats = [
      c.perBase != null ? `<div><span>Unit cost</span><b>${formatUnitCost(c.perBase, BASE[c.family])}</b></div>` : '',
      Number(rec.PORTIONS) > 0 ? `<div><span>Per portion</span><b>${money(c.perPortion)}</b></div>` : '',
    ].join('');
    return `
      <section class="summary">
        <div class="summary-main">
          <div class="stat-big"><span class="overline">Batch cost</span><strong>${money(c.total)}</strong>
            <small>${esc(describeYield(rec)) || 'No yield set'}</small></div>
        </div>
        ${stats ? `<div class="summary-grid">${stats}</div>` : ''}
      </section>`;
  }
  const gpBlock = c.gpPct != null ? `
    <div class="stat-gp ${c.onTarget ? 'ok' : 'low'}"><span class="overline">Gross profit</span>
      <strong>${c.gpPct.toFixed(1)}%</strong><small>Target ${fmtQty(c.target)}%</small></div>` : '';
  const meter = c.gpPct != null ? `
    <div class="gp-meter" role="img" aria-label="GP ${c.gpPct.toFixed(1)}% against a ${fmtQty(c.target)}% target">
      <div class="gp-fill ${c.onTarget ? 'ok' : 'low'}" style="width:${Math.max(0, Math.min(100, c.gpPct))}%"></div>
      <div class="gp-target" style="left:${Math.max(0, Math.min(100, c.target))}%"></div>
    </div>` : '';
  const grid = c.gpPct != null ? `
    <div class="summary-grid">
      <div><span>Sell inc VAT</span><b>${money(c.sell)}</b></div>
      <div><span>Net of ${fmtQty(c.vat)}% VAT</span><b>${money(c.net)}</b></div>
      <div><span>GP per portion</span><b>${money(c.gp)}</b></div>
    </div>` : '';
  const suggest = c.suggested != null && c.total > 0 && !c.onTarget
    ? `<p class="suggest">${c.sell != null ? 'To hit' : 'For'} ${fmtQty(c.target)}% GP, sell at <b>${money(c.suggested)}</b> inc VAT.</p>`
    : '';
  return `
    <section class="summary">
      <div class="summary-main">
        <div class="stat-big"><span class="overline">Cost per portion</span><strong>${money(c.perPortion)}</strong>
          <small>${money(c.total)} for ${fmtQty(c.portions)} portion${c.portions === 1 ? '' : 's'}</small></div>
        ${gpBlock}
      </div>
      ${meter}${grid}
      ${c.sell == null ? '<p class="muted small">No sell price yet. Add one under Edit details to see GP.</p>' : ''}
      ${suggest}
    </section>`;
}

function renderDetail() {
  if (!dlg || !ds.id) return;
  const coster = createCoster();
  const c = coster.cost(ds.id);
  const rec = c.rec;
  if (!rec) { closeDetail(); return; }

  dlg.querySelector('[data-d-overline]').textContent =
    [TYPE_LABEL[typeOf(rec)] ?? rec.TYPE, describeYield(rec)].filter(Boolean).join(' · ');
  dlg.querySelector('[data-d-title]').textContent = rec.NAME;

  const usedIn = store.rows('RECIPE_LINES')
    .filter(l => String(l.ITEM_TYPE).toUpperCase() === 'SUB' && String(l.ITEM_ID) === String(ds.id))
    .map(l => coster.recs.get(String(l.RECIPE_ID)))
    .filter((r, i, arr) => r && arr.indexOf(r) === i);

  const { label } = scaleBasis(rec);
  dlg.querySelector('[data-d-body]').innerHTML = `
    ${summaryHtml(c)}
    <section class="detail-block">
      <h3 class="section-title">Allergens</h3>
      ${c.allergens.length
        ? `<div class="tags">${c.allergens.map(a => `<span class="tag allergen">${esc(a)}</span>`).join('')}</div>`
        : '<p class="muted small">None of the 14 major allergens recorded on its ingredients.</p>'}
    </section>
    ${c.unpriced ? `<p class="notice">${c.unpriced} line${c.unpriced === 1 ? ' isn’t' : 's aren’t'} fully costed, so the cost is understated. Tap a highlighted line to fix it.</p>` : ''}
    ${c.circular ? '<p class="notice">This recipe uses a sub-recipe that loops back into it. That line is not costed.</p>' : ''}
    ${usedIn.length ? `<p class="muted small used-in">Used in ${usedIn.map(r => `<a href="#/recipes/${encodeURIComponent(r.RECIPE_ID)}">${esc(r.NAME)}</a>`).join(', ')}</p>` : ''}
    <section class="detail-block">
      <div class="section-head">
        <h3 class="section-title">Ingredients</h3>
        <span class="muted small" data-lines-total></span>
      </div>
      <label class="scale-row">
        <span>Scale to</span>
        <input type="number" inputmode="decimal" min="0" step="any" data-scale value="${esc(ds.scaleTo)}" placeholder="${esc(fmtQty(scaleBasis(rec).base))}">
        <span>${esc(label)}</span>
        <b data-scale-factor></b>
      </label>
      <div data-lines></div>
    </section>
    ${rec.METHOD ? `<section class="detail-block"><h3 class="section-title">Method</h3><div class="method">${esc(rec.METHOD)}</div></section>` : ''}`;
  renderLines(coster);
}

function lineUnitOptions(lc, current) {
  let units;
  if (lc.type === 'SUB') {
    units = lc.family ? unitsFor(lc.family).filter(u => u !== 'tsp' && u !== 'tbsp') : [];
    units = [...units, 'portion'];
  } else {
    units = lc.family ? unitsFor(lc.family) : ALL_UNITS;
  }
  const cur = normUnit(current);
  if (cur && !units.includes(cur)) units = [cur, ...units];
  return units.map(u => `<option value="${esc(u)}"${u === cur ? ' selected' : ''}>${esc(u === 'portion' ? 'portion' : unitLabel(lc.family, u))}</option>`).join('');
}

const PROBLEM = { unpriced: 'No price', missing: 'Missing', unit: 'Unit mismatch', circular: 'Loops back' };

function lineHtml(lc, factor, supplierNames) {
  const l = lc.line;
  const id = l.LINE_ID ? String(l.LINE_ID) : '';
  const open = id && ds.open === id;
  const name = lc.item ? lc.item.NAME : `${l.ITEM_ID} (deleted)`;
  const kind = lc.type === 'SUB' ? 'Sub-recipe'
    : lc.item ? (supplierNames.get(String(chosenPrice(lc.item)?.price.SUPPLIER_ID)) || 'No supplier price') + (lc.item.ACTIVE ? '' : ' · inactive') : 'Ingredient';
  const qty = Number(l.QTY) * factor;
  const unit = normUnit(l.UNIT);
  const qtyText = `${fmtQty(qty)} ${unit === 'portion' && qty !== 1 ? 'portions' : unit}`;
  const hardProblem = PROBLEM[lc.problem];
  const rate = lc.rate == null ? '' : lc.rateUnit === 'portion' ? `${money(lc.rate)}/portion` : formatUnitCost(lc.rate, lc.rateUnit);
  return `
    <div class="line${lc.problem ? ' flag' : ''}${open ? ' open' : ''}" data-line="${esc(id)}">
      <button type="button" class="line-main" data-act="toggle" ${id ? '' : 'disabled title="This line was added in the sheet without a LINE_ID, so it can only be edited there."'} aria-expanded="${open ? 'true' : 'false'}">
        <span class="line-text">
          <span class="line-name">${esc(name)}</span>
          <span class="line-sub">${esc(kind)}${lc.problem === 'partial' ? ' · part-costed' : ''}</span>
        </span>
        <span class="line-qty">${esc(qtyText)}</span>
        <span class="line-cost">${hardProblem ? `<span class="warn">${hardProblem}</span>` : money(lc.cost * factor)}<small>${rate}</small></span>
      </button>
      ${open ? lineEditorHtml(lc, factor) : ''}
    </div>`;
}

function lineEditorHtml(lc, factor) {
  const l = lc.line;
  const swapping = ds.swap === String(l.LINE_ID);
  return `
    <div class="line-edit">
      <div class="qty-row">
        <input type="number" inputmode="decimal" min="0" step="any" data-edit-qty value="${esc(l.QTY)}" aria-label="Quantity">
        <select data-edit-unit aria-label="Unit">${lineUnitOptions(lc, l.UNIT)}</select>
        <button type="button" class="btn primary sm" data-act="save-qty">Save</button>
      </div>
      ${factor !== 1 ? '<p class="hint">You’re editing the base recipe, not the scaled amounts.</p>' : ''}
      ${lc.problem === 'unpriced' ? '<p class="hint">This ingredient has no price yet. Tap Open to add one.</p>' : ''}
      ${lc.problem === 'unit' ? '<p class="hint">This unit doesn’t match how the item is measured. Pick another unit.</p>' : ''}
      <div class="line-actions">
        ${lc.item ? `<button type="button" class="btn sm" data-act="open-item">Open</button>` : ''}
        <button type="button" class="btn sm" data-act="swap">${swapping ? 'Cancel swap' : 'Swap'}</button>
        <button type="button" class="icon-btn sm" data-act="up" aria-label="Move up">${icons.up}</button>
        <button type="button" class="icon-btn sm" data-act="down" aria-label="Move down">${icons.down}</button>
        <button type="button" class="btn sm danger" data-act="remove">Remove</button>
      </div>
      ${swapping ? `
        <div class="picker" data-swap>
          <label class="search-wrap">${icons.search}
            <input type="search" class="search" data-swap-q value="${esc(ds.swapQ)}" placeholder="Replace with…" autocomplete="off">
          </label>
          <div class="results" data-results>${resultsHtml(ds.swapQ)}</div>
        </div>` : ''}
    </div>`;
}

function renderLines(coster = createCoster()) {
  const host = dlg?.querySelector('[data-lines]');
  if (!host) return;
  const c = coster.cost(ds.id);
  const factor = scaleFactor(c.rec);
  const supplierNames = new Map(store.rows('SUPPLIERS').map(s => [String(s.SUPPLIER_ID), s.NAME]));

  dlg.querySelector('[data-lines-total]').innerHTML =
    `${c.lines.length} line${c.lines.length === 1 ? '' : 's'} · <b>${money(c.total * factor)}</b>`;
  dlg.querySelector('[data-scale-factor]').textContent = factor !== 1 ? `×${fmtQty(factor)}` : '';

  host.innerHTML = `
    <div class="lines">${c.lines.map(lc => lineHtml(lc, factor, supplierNames)).join('')
      || '<p class="muted small lines-empty">No ingredients yet. Search below to add the first one, or paste a list.</p>'}</div>
    <div class="add-line" data-addline>${addLineHtml(coster)}</div>`;
}

// ---------- search (shared by the add row and swap)

function searchItems(q) {
  if (!q.trim()) return [];
  const coster = createCoster();
  const ings = store.rows('INGREDIENTS').filter(i => i.ACTIVE)
    .map(i => ({ type: 'ING', id: String(i.ING_ID), name: i.NAME, unpriced: usableUnitCost(i) == null }));
  const recs = store.rows('RECIPES')
    .filter(r => !coster.wouldLoop(ds.id, r.RECIPE_ID))
    .map(r => ({ type: 'SUB', id: String(r.RECIPE_ID), name: r.NAME, unpriced: false }));
  const nq = normName(q);
  return [...ings, ...recs]
    .filter(x => matches(q, x.name))
    .sort((a, b) => (normName(b.name).startsWith(nq) - normName(a.name).startsWith(nq)) || a.name.localeCompare(b.name))
    .slice(0, 8);
}

function resultsHtml(q) {
  if (!q.trim()) return '';
  const items = searchItems(q);
  return items.map(x => `
      <button type="button" class="result" data-pick-type="${x.type}" data-pick-id="${esc(x.id)}">
        <span>${esc(x.name)}</span>
        <span class="tag${x.unpriced ? ' allergen' : ''}">${x.type === 'SUB' ? 'Sub-recipe' : x.unpriced ? 'Needs price' : 'Ingredient'}</span>
      </button>`).join('')
    + `<button type="button" class="result create" data-act="create-ing">${icons.plus} New ingredient “${esc(q.trim())}”</button>`;
}

function defaultUnit(type, id) {
  if (type === 'SUB') {
    const rec = store.byId('RECIPES', id);
    const fam = familyOf(rec?.YIELD_UNIT);
    return Number(rec?.PORTIONS) > 0 || !fam ? 'portion' : BASE[fam];
  }
  const fam = ingredientFamily(store.byId('INGREDIENTS', id));
  return fam ? BASE[fam] : 'g';
}

function addLineHtml(coster) {
  const a = ds.add;
  if (!a.pick) {
    return `
      <label class="search-wrap">${icons.search}
        <input type="search" class="search" data-add-q value="${esc(a.q)}" placeholder="Add ingredient or sub-recipe" autocomplete="off" aria-label="Add ingredient or sub-recipe">
      </label>
      <div class="results" data-results>${resultsHtml(a.q)}</div>
      <button type="button" class="btn sm paste-inline" data-act="paste">Paste a list of ingredients</button>`;
  }
  const item = a.pick.type === 'SUB' ? store.byId('RECIPES', a.pick.id) : store.byId('INGREDIENTS', a.pick.id);
  const lc = {
    type: a.pick.type,
    family: a.pick.type === 'SUB' ? coster.cost(a.pick.id).family : ingredientFamily(item),
  };
  return `
    <div class="picked">
      <div class="picked-head">
        <span><b>${esc(item?.NAME)}</b><small>${a.pick.type === 'SUB' ? 'Sub-recipe' : 'Ingredient'}</small></span>
        <button type="button" class="icon-btn sm" data-act="add-clear" aria-label="Choose something else">&times;</button>
      </div>
      <div class="qty-row">
        <input type="number" inputmode="decimal" min="0" step="any" data-add-qty value="${esc(a.qty)}" placeholder="Qty" aria-label="Quantity">
        <select data-add-unit aria-label="Unit">${lineUnitOptions(lc, a.unit)}</select>
        <button type="button" class="btn primary sm" data-act="add-commit">Add</button>
      </div>
      <p class="picked-cost" data-add-preview>${previewText()}</p>
    </div>`;
}

/** Cost preview for the line being added, using the same maths as the coster. */
function previewText() {
  const a = ds.add;
  if (!a.pick || !(Number(a.qty) > 0)) return 'Enter a quantity to see the cost.';
  const coster = createCoster();
  const line = { ITEM_TYPE: a.pick.type, ITEM_ID: a.pick.id, QTY: a.qty, UNIT: a.unit, SORT: '', _row: 0 };
  let cost = null;
  if (a.pick.type === 'SUB') {
    const sc = coster.cost(a.pick.id);
    if (normUnit(a.unit) === 'portion') cost = Number(a.qty) * sc.perPortion;
    else {
      const b = sc.family ? toBase(sc.family, line.QTY, line.UNIT) : null;
      if (b != null && sc.yieldBase) cost = (b / sc.yieldBase) * sc.total;
    }
  } else {
    const ing = store.byId('INGREDIENTS', a.pick.id);
    const fam = ingredientFamily(ing);
    const c = usableUnitCost(ing);
    const b = fam ? toBase(fam, line.QTY, line.UNIT) : null;
    if (c == null) return 'This ingredient has no price yet, so it will cost as £0 until you add one.';
    if (b != null) cost = b * c;
  }
  return cost == null ? 'That unit doesn’t fit this item.' : `Line cost <b>${money(cost)}</b>`;
}

// ---------- actions

async function run(fn, success) {
  if (ds.busy) return;
  ds.busy = true;
  dlg.classList.add('busy');
  try {
    await fn();
    if (success) toast(success);
  } catch (err) {
    reportError(err);
  } finally {
    ds.busy = false;
    dlg.classList.remove('busy');
    if (ds.id) renderDetail();
    renderList();
  }
}

const recipeLines = () => createCoster().linesOf(ds.id);

function pickForAdd(type, id) {
  ds.add = { q: '', pick: { type, id }, qty: '', unit: defaultUnit(type, id) };
  renderLines();
  dlg.querySelector('[data-add-qty]')?.focus();
}

function commitAdd() {
  const a = ds.add;
  const qty = Number(a.qty);
  if (!a.pick || !(qty > 0) || !a.unit) { toast('Enter a quantity greater than zero.', 'error'); return; }
  const lines = recipeLines();
  const sort = lines.reduce((m, l) => Math.max(m, Number(l.SORT) || 0), 0) + 1;
  const name = (a.pick.type === 'SUB' ? store.byId('RECIPES', a.pick.id) : store.byId('INGREDIENTS', a.pick.id))?.NAME;
  return run(async () => {
    await store.create('RECIPE_LINES', {
      RECIPE_ID: ds.id, ITEM_TYPE: a.pick.type, ITEM_ID: a.pick.id, QTY: qty, UNIT: a.unit, SORT: sort,
    });
    ds.add = emptyAdd();
  }, `Added ${name}`).then(() => dlg.querySelector('[data-add-q]')?.focus({ preventScroll: true }));
}

function saveQty(lineId) {
  const row = dlg.querySelector(`.line[data-line="${CSS.escape(lineId)}"]`);
  const qty = Number(row.querySelector('[data-edit-qty]').value);
  const unit = row.querySelector('[data-edit-unit]').value;
  if (!(qty > 0)) { toast('Enter a quantity greater than zero.', 'error'); return; }
  run(async () => {
    await store.update('RECIPE_LINES', lineId, { QTY: qty, UNIT: unit });
    ds.open = null;
  }, 'Quantity updated');
}

function commitSwap(lineId, type, id) {
  const line = store.byId('RECIPE_LINES', lineId);
  const fam = type === 'SUB' ? familyOf(store.byId('RECIPES', id)?.YIELD_UNIT) : ingredientFamily(store.byId('INGREDIENTS', id));
  const cur = normUnit(line.UNIT);
  const keep = (fam && toBase(fam, 1, cur) != null) || (type === 'SUB' && cur === 'portion');
  run(async () => {
    await store.update('RECIPE_LINES', lineId, { ITEM_TYPE: type, ITEM_ID: id, UNIT: keep ? cur : defaultUnit(type, id) });
    ds.swap = null;
    ds.swapQ = '';
  }, 'Swapped');
}

function moveLine(lineId, dir) {
  const ids = recipeLines().map(l => String(l.LINE_ID));
  const i = ids.indexOf(lineId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length || ids.some(x => !x)) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  const current = new Map(recipeLines().map(l => [String(l.LINE_ID), l.SORT]));
  const changes = ids.map((id, k) => ({ id, record: { SORT: k + 1 } })).filter(ch => current.get(ch.id) !== ch.record.SORT);
  run(() => store.updateMany('RECIPE_LINES', changes));
}

function removeLine(lineId) {
  if (!confirm('Remove this line from the recipe?')) return;
  run(async () => {
    await store.remove({ RECIPE_LINES: [lineId] });
    ds.open = null;
  }, 'Line removed');
}

function openItem(lineId) {
  const line = store.byId('RECIPE_LINES', lineId);
  if (String(line.ITEM_TYPE).toUpperCase() === 'SUB') {
    location.hash = `#/recipes/${encodeURIComponent(line.ITEM_ID)}`;
  } else {
    ingredientsView.openForm(store.byId('INGREDIENTS', line.ITEM_ID), { onSaved: () => { renderDetail(); renderList(); } });
  }
}

function createIngredientFrom(q, onCreated) {
  ingredientsView.openForm(null, { prefill: { NAME: q.trim() }, onSaved: onCreated });
}

function deleteRecipe() {
  const rec = store.byId('RECIPES', ds.id);
  const usedBy = store.rows('RECIPE_LINES').filter(l => String(l.ITEM_TYPE).toUpperCase() === 'SUB' && String(l.ITEM_ID) === String(ds.id));
  if (usedBy.length) {
    const names = [...new Set(usedBy.map(l => store.byId('RECIPES', l.RECIPE_ID)?.NAME).filter(Boolean))];
    toast(`Can't delete: it's used in ${names.join(', ')}. Remove it from ${names.length === 1 ? 'that recipe' : 'those recipes'} first.`, 'error');
    return;
  }
  const onMenus = [...new Set(store.rows('MENU_LINES').filter(l => String(l.RECIPE_ID) === String(ds.id))
    .map(l => store.byId('MENUS', l.MENU_ID)?.NAME).filter(Boolean))];
  if (onMenus.length) {
    toast(`Can't delete: it's on ${onMenus.length === 1 ? 'the menu' : 'the menus'} ${onMenus.join(', ')}. Remove it there first.`, 'error');
    return;
  }
  const lineIds = recipeLines().map(l => l.LINE_ID).filter(Boolean);
  const msg = lineIds.length
    ? `Delete “${rec.NAME}” and its ${lineIds.length} line${lineIds.length === 1 ? '' : 's'}? This can't be undone.`
    : `Delete “${rec.NAME}”? This can't be undone.`;
  if (!confirm(msg)) return;
  const name = rec.NAME;
  run(async () => {
    await store.remove({ RECIPE_LINES: lineIds, RECIPES: [ds.id] });
    closeDetail();
    location.hash = '#/recipes';
  }, `Deleted ${name}`);
}

// ---------- events

function onDetailClick(e) {
  const t = e.target;
  const act = t.closest('[data-act]')?.dataset.act;
  const lineEl = t.closest('.line[data-line]');
  const lineId = lineEl?.dataset.line;
  const pick = t.closest('[data-pick-id]');

  if (pick) {
    if (t.closest('[data-swap]')) commitSwap(lineId, pick.dataset.pickType, pick.dataset.pickId);
    else pickForAdd(pick.dataset.pickType, pick.dataset.pickId);
    return;
  }
  if (ds.busy && act && act !== 'close') return;

  switch (act) {
    case 'close': closeDetail(); break;
    case 'toggle':
      ds.open = ds.open === lineId ? null : lineId;
      ds.swap = null;
      ds.swapQ = '';
      renderLines();
      break;
    case 'save-qty': saveQty(lineId); break;
    case 'open-item': openItem(lineId); break;
    case 'swap':
      ds.swap = ds.swap === lineId ? null : lineId;
      ds.swapQ = '';
      renderLines();
      dlg.querySelector('[data-swap-q]')?.focus();
      break;
    case 'up': moveLine(lineId, -1); break;
    case 'down': moveLine(lineId, 1); break;
    case 'remove': removeLine(lineId); break;
    case 'add-clear': ds.add = emptyAdd(); renderLines(); dlg.querySelector('[data-add-q]')?.focus(); break;
    case 'add-commit': commitAdd(); break;
    case 'create-ing': {
      const swapping = !!t.closest('[data-swap]');
      const q = swapping ? ds.swapQ : ds.add.q;
      const targetLine = lineId;
      createIngredientFrom(q, id => (swapping ? commitSwap(targetLine, 'ING', id) : pickForAdd('ING', id)));
      break;
    }
    case 'paste': openPaste(); break;
    case 'edit': openRecipeForm(store.byId('RECIPES', ds.id)); break;
    case 'delete': deleteRecipe(); break;
    default: break;
  }
}

function onDetailInput(e) {
  const t = e.target;
  if (t.matches('[data-add-q]')) {
    ds.add.q = t.value;
    t.closest('[data-addline]').querySelector('[data-results]').innerHTML = resultsHtml(ds.add.q);
  } else if (t.matches('[data-swap-q]')) {
    ds.swapQ = t.value;
    t.closest('[data-swap]').querySelector('[data-results]').innerHTML = resultsHtml(ds.swapQ);
  } else if (t.matches('[data-add-qty]')) {
    ds.add.qty = t.value;
    dlg.querySelector('[data-add-preview]').innerHTML = previewText();
  } else if (t.matches('[data-scale]')) {
    ds.scaleTo = t.value;
    renderLines();
  }
}

function onDetailChange(e) {
  if (e.target.matches('[data-add-unit]')) {
    ds.add.unit = e.target.value;
    dlg.querySelector('[data-add-preview]').innerHTML = previewText();
  }
}

function onDetailKeydown(e) {
  if (e.key !== 'Enter') return;
  const t = e.target;
  if (t.matches('[data-add-qty]')) { e.preventDefault(); commitAdd(); } else if (t.matches('[data-edit-qty]')) {
    e.preventDefault();
    saveQty(t.closest('.line').dataset.line);
  } else if (t.matches('[data-add-q], [data-swap-q]')) {
    e.preventDefault();
    t.closest('[data-addline], [data-swap]').querySelector('[data-pick-id]')?.click();
  }
}

// ============================================================ paste importer

let pasteDlg = null;
let parsed = [];

function ensurePasteDialog() {
  if (pasteDlg) return;
  pasteDlg = document.createElement('dialog');
  pasteDlg.className = 'modal paste-sheet';
  pasteDlg.innerHTML = `
    <div class="modal-form">
      <header class="modal-head">
        <h2>Paste a recipe</h2>
        <button type="button" class="icon-btn" data-act="close" aria-label="Close">&times;</button>
      </header>
      <div class="modal-body">
        <p class="muted small">One ingredient per line. Each line is matched to your ingredients; cooking units like cups and ounces are converted to metric. Anything not found is created as a new ingredient for you to price later.</p>
        <textarea data-paste-text rows="7" placeholder="${esc('200g burrata\n2 cloves garlic\n1 tbsp olive oil\n175ml house red')}"></textarea>
        <button type="button" class="btn block" data-act="parse">Read the list</button>
        <p class="small muted paste-summary" data-paste-summary></p>
        <div class="paste-rows" data-paste-rows></div>
        <datalist id="paste-ingredients"></datalist>
      </div>
      <footer class="modal-foot">
        <button type="button" class="btn" data-act="close">Cancel</button>
        <button type="button" class="btn primary" data-act="paste-add" disabled>Add lines</button>
      </footer>
    </div>`;
  document.body.append(pasteDlg);
  pasteDlg.addEventListener('close', parkToasts);
  pasteDlg.addEventListener('cancel', e => { if (!confirmDiscardPaste()) e.preventDefault(); });
  pasteDlg.addEventListener('click', e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') { if (confirmDiscardPaste()) pasteDlg.close(); } else if (act === 'parse') {
      const text = pasteDlg.querySelector('[data-paste-text]').value;
      if (!text.trim()) { toast('Paste an ingredient list first.', 'error'); return; }
      parsed = parseRecipeText(text, store.rows('INGREDIENTS').filter(i => i.ACTIVE));
      renderPasteRows();
    } else if (act === 'paste-add') addParsed();
  });
  pasteDlg.addEventListener('input', onPasteEdit);
  pasteDlg.addEventListener('change', onPasteEdit);
}

function confirmDiscardPaste() {
  const dirty = parsed.length || pasteDlg.querySelector('[data-paste-text]').value.trim();
  return !dirty || confirm('Discard this pasted list?');
}

/** Open the importer; with `text`, it's read straight away (from the New recipe form). */
function openPaste(text = '') {
  ensurePasteDialog();
  parsed = [];
  pasteDlg.querySelector('[data-paste-text]').value = text;
  pasteDlg.querySelector('#paste-ingredients').innerHTML =
    store.rows('INGREDIENTS').filter(i => i.ACTIVE).map(i => `<option value="${esc(i.NAME)}">`).join('');
  if (text) parsed = parseRecipeText(text, store.rows('INGREDIENTS').filter(i => i.ACTIVE));
  renderPasteRows();
  pasteDlg.showModal();
  parkToasts();
  if (!text) pasteDlg.querySelector('[data-paste-text]').focus();
}

function pasteRowCost(p) {
  if (!p.ingId || !(Number(p.qty) > 0)) return '';
  const ing = store.byId('INGREDIENTS', p.ingId);
  const c = usableUnitCost(ing);
  const b = toBase(p.family, p.qty, p.unit);
  if (c == null) return 'No price';
  return b == null ? 'Unit?' : money(b * c);
}

function pasteRowHtml(p, i) {
  const ing = p.ingId ? store.byId('INGREDIENTS', p.ingId) : null;
  const units = ing ? unitsFor(p.family) : ALL_UNITS;
  return `
    <div class="paste-row${p.include ? '' : ' off'}" data-i="${i}">
      <label class="paste-include"><input type="checkbox" data-p="include"${p.include ? ' checked' : ''}><span>${esc(p.raw)}</span></label>
      ${p.note ? `<p class="hint warn">${esc(p.note)}</p>` : ''}
      <input type="text" data-p="name" list="paste-ingredients" value="${esc(ing ? ing.NAME : p.name)}" aria-label="Ingredient">
      <small class="${ing ? 'match-ok' : 'match-new'}">${ing ? '✓ Matches an ingredient' : '+ New ingredient (needs a price)'}</small>
      <div class="qty-row">
        <input type="number" inputmode="decimal" min="0" step="any" data-p="qty" value="${p.qty ?? ''}" placeholder="Qty" aria-label="Quantity">
        <select data-p="unit" aria-label="Unit">${units.map(u => `<option value="${u}"${u === p.unit ? ' selected' : ''}>${esc(unitLabel(p.family, u))}</option>`).join('')}</select>
        <span class="paste-cost" data-p-cost>${pasteRowCost(p)}</span>
      </div>
    </div>`;
}

function renderPasteRows() {
  pasteDlg.querySelector('[data-paste-rows]').innerHTML = parsed.map(pasteRowHtml).join('');
  const n = parsed.filter(p => p.include).length;
  const fresh = new Set(parsed.filter(p => p.include && !p.ingId).map(p => normName(p.name))).size;
  pasteDlg.querySelector('[data-paste-summary]').textContent = parsed.length
    ? `${parsed.length} line${parsed.length === 1 ? '' : 's'} read · ${n} selected${fresh ? ` · ${fresh} new ingredient${fresh === 1 ? '' : 's'} will be created` : ''}`
    : '';
  const btn = pasteDlg.querySelector('[data-act="paste-add"]');
  btn.disabled = !n;
  btn.textContent = n ? `Add ${n} line${n === 1 ? '' : 's'}` : 'Add lines';
}

function onPasteEdit(e) {
  const row = e.target.closest('.paste-row');
  if (!row) return;
  const p = parsed[Number(row.dataset.i)];
  const field = e.target.dataset.p;
  if (field === 'qty') {
    p.qty = e.target.value === '' ? null : Number(e.target.value);
    row.querySelector('[data-p-cost]').textContent = pasteRowCost(p);
    return;
  }
  if (e.type !== 'change') return;
  if (field === 'include') p.include = e.target.checked;
  if (field === 'unit') {
    p.unit = e.target.value;
    if (!p.ingId) p.family = familyOf(p.unit) || (p.family === 'each' ? 'volume' : p.family);
  }
  if (field === 'name') {
    const typed = e.target.value.trim();
    const exact = store.rows('INGREDIENTS').find(i => i.ACTIVE && normName(i.NAME) === normName(typed));
    if (exact) {
      p.ingId = exact.ING_ID;
      p.name = exact.NAME;
      p.family = ingredientFamily(exact) || p.family;
      if (toBase(p.family, 1, p.unit) == null) p.unit = BASE[p.family];
    } else {
      p.ingId = null;
      p.name = typed || p.name;
    }
  }
  renderPasteRows();
}

async function addParsed() {
  const rows = parsed.filter(p => p.include);
  const bad = rows.filter(p => !(Number(p.qty) > 0) || !p.unit || !p.name.trim());
  if (bad.length) { toast(`Set a quantity for every selected line (${bad.length} missing).`, 'error'); return; }
  const btn = pasteDlg.querySelector('[data-act="paste-add"]');
  btn.disabled = true;
  btn.textContent = 'Adding…';
  try {
    // Create each missing ingredient once, even if it appears on several lines.
    const fresh = new Map();
    for (const p of rows.filter(r => !r.ingId)) {
      const key = normName(p.name);
      const nm = p.name.trim();
      if (!fresh.has(key)) fresh.set(key, { NAME: nm.charAt(0).toUpperCase() + nm.slice(1), UNIT: BASE[p.family] || 'g', 'YIELD_%': 100, ACTIVE: true });
    }
    if (fresh.size) {
      const ids = await store.createMany('INGREDIENTS', [...fresh.values()]);
      [...fresh.keys()].forEach((key, i) => { fresh.get(key).id = ids[i]; });
    }
    let sort = recipeLines().reduce((m, l) => Math.max(m, Number(l.SORT) || 0), 0);
    await store.createMany('RECIPE_LINES', rows.map(p => ({
      RECIPE_ID: ds.id, ITEM_TYPE: 'ING', ITEM_ID: p.ingId || fresh.get(normName(p.name)).id,
      QTY: Number(p.qty), UNIT: p.unit, SORT: ++sort,
    })));
    parsed = [];
    pasteDlg.close();
    toast(`Added ${rows.length} line${rows.length === 1 ? '' : 's'}${fresh.size ? `. ${fresh.size} new ingredient${fresh.size === 1 ? ' needs' : 's need'} a price` : ''}`);
    renderDetail();
    renderList();
  } catch (err) {
    reportError(err);
    btn.disabled = false;
    renderPasteRows();
  }
}
