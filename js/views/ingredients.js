import * as store from '../store.js';
import { ALLERGENS, DIETARY, CATEGORY_SUGGESTIONS, STORAGE_SUGGESTIONS } from '../config.js';
import { icons } from '../icons.js';
import { esc, money, formDialog, toast, reportError, parkToasts, byName, sameName, matches, option, splitList } from '../ui.js';
import {
  PACK_UNIT_OPTIONS, MEASURE_OPTIONS, normalisePack, priceUnitCost, pricesFor, chosenPrice, ingredientUnit,
  usableUnitCost, yieldFraction, formatUnitCost, packLabel,
} from '../costing.js';
import { openPriceForm, priceRowHtml, supplierName } from './prices.js';
import { STARTER_INGREDIENTS, guessUnit } from '../starter-ingredients.js';
import { normName } from '../recipe-paste.js';

const state = { q: '', category: '', supplier: '', inactive: false };
let root;

const supplierMap = () => new Map(store.rows('SUPPLIERS').map(s => [String(s.SUPPLIER_ID), s]));

export function render(el) {
  root = el;
  const ings = store.rows('INGREDIENTS');
  const cats = [...new Set(ings.map(i => String(i.CATEGORY).trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'en-GB'));
  if (state.category && !cats.includes(state.category)) state.category = '';
  const sups = store.rows('SUPPLIERS').slice().sort(byName);

  el.innerHTML = `
    <div class="page-head">
      <div>
        <p class="overline" data-count></p>
        <h1 class="title">Ingredients</h1>
      </div>
      <div class="head-actions">
        <button class="btn sm" data-bulk>Add many</button>
        <button class="btn primary add-desktop" data-add>${icons.plus} Add ingredient</button>
      </div>
    </div>
    <div class="toolbar">
      <label class="search-wrap">${icons.search}
        <input type="search" class="search" data-q value="${esc(state.q)}"
          placeholder="Search ingredients" aria-label="Search ingredients">
      </label>
      <div class="filters">
        <select data-cat aria-label="Filter by category">
          <option value="">All categories</option>${cats.map(c => option(c, c, state.category)).join('')}
        </select>
        <select data-sup aria-label="Filter by supplier">
          <option value="">All suppliers</option>
          ${sups.map(s => option(s.SUPPLIER_ID, s.NAME, state.supplier)).join('')}
          ${option('__none', 'No supplier', state.supplier)}
        </select>
        <label class="toggle-chip"><input type="checkbox" data-inactive${state.inactive ? ' checked' : ''}> Show inactive</label>
      </div>
    </div>
    <div data-list></div>
    <button class="fab" data-add aria-label="Add ingredient">${icons.plus}</button>`;

  el.querySelector('[data-q]').addEventListener('input', e => { state.q = e.target.value; renderList(); });
  el.querySelector('[data-cat]').addEventListener('change', e => { state.category = e.target.value; renderList(); });
  el.querySelector('[data-sup]').addEventListener('change', e => { state.supplier = e.target.value; renderList(); });
  el.querySelector('[data-inactive]').addEventListener('change', e => { state.inactive = e.target.checked; renderList(); });
  el.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => openForm(null)));
  el.querySelector('[data-bulk]').addEventListener('click', openBulk);
  el.querySelector('[data-list]').addEventListener('click', e => {
    const hit = e.target.closest('.card-hit');
    if (hit) openForm(store.byId('INGREDIENTS', hit.dataset.id));
  });
  renderList();
}

function renderList() {
  const all = store.rows('INGREDIENTS');
  const sups = supplierMap();
  const list = all.filter(i => {
    if (!state.inactive && !i.ACTIVE) return false;
    if (state.category && String(i.CATEGORY).trim() !== state.category) return false;
    const prices = pricesFor(i.ING_ID);
    if (state.supplier === '__none' && prices.length) return false;
    if (state.supplier && state.supplier !== '__none' && !prices.some(p => String(p.SUPPLIER_ID) === state.supplier)) return false;
    return matches(state.q, i.NAME, i.CATEGORY, i.ALLERGENS, i.DIETARY, i.ING_ID,
      ...prices.map(p => `${p.SUPPLIER_CODE} ${p.PRODUCT_NAME} ${sups.get(String(p.SUPPLIER_ID))?.NAME ?? ''}`));
  }).sort(byName);

  const shown = all.filter(i => state.inactive || i.ACTIVE).length;
  root.querySelector('[data-count]').textContent =
    list.length === shown ? (state.inactive ? `${shown} total` : `${shown} in use`) : `${list.length} of ${shown}`;

  if (!list.length) {
    root.querySelector('[data-list]').innerHTML = `<div class="empty">${
      all.length ? 'No ingredients match these filters.' : 'No ingredients yet. Add your first one to get started.'}</div>`;
    return;
  }

  root.querySelector('[data-list]').innerHTML = `<div class="cards">${list.map(i => {
    const chosen = chosenPrice(i);
    const p = chosen?.price;
    const supplierCount = new Set(pricesFor(i.ING_ID).map(x => String(x.SUPPLIER_ID))).size;
    const sup = p ? esc(sups.get(String(p.SUPPLIER_ID))?.NAME ?? supplierName(p.SUPPLIER_ID)) : '';
    const sub = [esc(i.CATEGORY), sup && (supplierCount > 1 ? `${sup} +${supplierCount - 1}` : sup)].filter(Boolean).join(' · ') || 'No category';
    const allergens = splitList(i.ALLERGENS);
    const dietary = splitList(i.DIETARY);
    const yieldPct = i['YIELD_%'] === '' ? 100 : i['YIELD_%'];
    return `
    <article class="card${i.ACTIVE ? '' : ' inactive'}">
      <button class="card-hit" data-id="${esc(i.ING_ID)}" aria-label="Edit ${esc(i.NAME)}"></button>
      <div class="card-top">
        <div>
          <div class="card-name">${esc(i.NAME)}${i.ACTIVE ? '' : ' <span class="tag">Inactive</span>'}${
            p ? '' : ' <span class="tag allergen">Needs price</span>'}</div>
          <div class="card-sub">${sub}</div>
        </div>
        <div class="card-figure"><strong>${formatUnitCost(usableUnitCost(i), ingredientUnit(i))}</strong><span>usable cost</span></div>
      </div>
      <div class="card-meta">
        ${p ? `<span><b>${esc(packLabel(p.PACK_SIZE, p.PACK_UNIT))}</b> for <b>${money(p.PACK_PRICE)}</b></span>` : '<span>No supplier price yet</span>'}
        ${Number(yieldPct) !== 100 ? `<span>Yield <b>${esc(yieldPct)}%</b></span>` : ''}
        ${p?.SUPPLIER_CODE ? `<span>Code <b>${esc(p.SUPPLIER_CODE)}</b></span>` : ''}
      </div>
      ${allergens.length || dietary.length ? `<div class="tags">${
        dietary.map(a => `<span class="tag diet">${esc(a)}</span>`).join('')}${
        allergens.map(a => `<span class="tag allergen">${esc(a)}</span>`).join('')}</div>` : ''}
    </article>`;
  }).join('')}</div>`;
}

function historyHtml(ingId) {
  const rows = store.rows('PRICE_HISTORY')
    .filter(r => String(r.ING_ID) === String(ingId))
    .sort((a, b) => String(b.DATE).localeCompare(String(a.DATE)) || b._row - a._row)
    .slice(0, 8);
  if (!rows.length) return '';
  return `
    <section class="history">
      <h3>Price history</h3>
      <table><tbody>${rows.map(r => `
        <tr><td>${esc(r.DATE)}</td><td>${esc(r.SUPPLIER_ID ? supplierName(r.SUPPLIER_ID) : '')}</td><td class="num">${money(r.PACK_PRICE)}</td><td class="muted">${esc(r.INVOICE_REF)}</td></tr>`).join('')}
      </tbody></table>
    </section>`;
}

function pricesSectionHtml(ing) {
  const rows = pricesFor(ing.ING_ID).slice().sort((a, b) => (priceUnitCost(a) ?? Infinity) - (priceUnitCost(b) ?? Infinity));
  return `
    <div class="section-head">
      <h3 class="section-title">Supplier prices</h3>
      <button type="button" class="btn sm" data-add-price>${icons.plus} Add price</button>
    </div>
    ${rows.length
      ? `<div class="price-rows">${rows.map(p => priceRowHtml(p, supplierName(p.SUPPLIER_ID))).join('')}</div>`
      : '<p class="muted small">No supplier prices yet. Add one so recipes can cost this ingredient.</p>'}`;
}

/**
 * Add or edit an ingredient. New ingredients can take a first supplier price in the same form;
 * existing ones show every supplier's price, and which one recipes use.
 * `prefill` seeds a new ingredient's fields; `onSaved(id)` runs after a successful save.
 */
export function openForm(ing, { prefill = {}, onSaved } = {}) {
  const isNew = !ing;
  const sups = store.rows('SUPPLIERS').slice().sort(byName);
  const supOptions = sups.map(s => [s.SUPPLIER_ID, s.NAME]);
  const categories = [...new Set([...CATEGORY_SUGGESTIONS, ...store.rows('INGREDIENTS').map(i => i.CATEGORY).filter(Boolean)])];

  const fields = [
    { name: 'NAME', label: 'Ingredient name', required: true, wide: true },
    { name: 'CATEGORY', label: 'Category', suggestions: categories, half: true },
    { name: 'STORAGE', label: 'Storage', suggestions: STORAGE_SUGGESTIONS, half: true },
    { name: 'UNIT', label: 'Measured by', type: 'select', required: true, options: MEASURE_OPTIONS, half: true,
      hint: isNew ? 'Set from the first price if you add one' : '' },
    { name: 'YIELD_%', label: 'Yield %', type: 'number', min: 1, max: 100, step: 'any', inputmode: 'decimal', half: true,
      hint: 'Usable after trim' },
  ];
  if (isNew) {
    fields.push(
      { name: 'P_SUPPLIER', label: 'Supplier', type: 'select', options: [['', 'Add a price later'], ...supOptions], wide: true,
        hint: 'First price (optional). Add more suppliers after saving.' },
      { name: 'P_SIZE', label: 'Pack size', type: 'number', min: 0.001, step: 'any', inputmode: 'decimal', half: true },
      { name: 'P_UNIT', label: 'Unit', type: 'select', options: PACK_UNIT_OPTIONS, half: true },
      { name: 'P_PRICE', label: 'Pack price £', type: 'number', min: 0, step: 0.01, inputmode: 'decimal', half: true, hint: 'Ex VAT' },
      { name: 'P_CODE', label: 'Product code', half: true, autocomplete: 'off' },
      { name: 'P_REF', label: 'Invoice ref', wide: true, placeholder: 'Optional' },
    );
  } else {
    fields.push({ name: 'SUPPLIER_ID', label: 'Preferred supplier', type: 'select', wide: true,
      options: [['', 'Cheapest price (automatic)'], ...supOptions],
      hint: 'Recipes use this supplier\u2019s price. If it has none, the cheapest is used.' });
  }
  fields.push(
    { name: 'SHELF_LIFE', label: 'Shelf life', placeholder: 'e.g. 5 days, 3 days once opened' },
    { name: 'ACTIVE', label: 'Active (in use)', type: 'checkbox', wide: true },
    { name: 'ALLERGENS', label: 'Allergens', type: 'chips', options: ALLERGENS, wide: true },
    { name: 'DIETARY', label: 'Suitable for', type: 'chips', options: DIETARY, wide: true },
  );

  const refreshPrices = dlg => {
    const host = dlg.querySelector('[data-prices]');
    if (host) host.innerHTML = pricesSectionHtml(store.byId('INGREDIENTS', ing.ING_ID));
    dlg.querySelector('form').dispatchEvent(new Event('input'));
    if (root?.isConnected) renderList();
    onSaved?.(ing.ING_ID);
  };

  formDialog({
    title: isNew ? 'Add ingredient' : `Edit ${ing.NAME}`,
    fields,
    values: ing || { ACTIVE: true, 'YIELD_%': 100, UNIT: 'g', P_UNIT: 'g', ...prefill },
    submitLabel: isNew ? 'Add ingredient' : 'Save changes',
    extraHtml: `<p class="cost-preview" data-preview aria-live="polite"></p>${
      isNew ? '' : `<section class="prices" data-prices>${pricesSectionHtml(ing)}</section>${historyHtml(ing.ING_ID)}`}`,
    onOpen: dlg => {
      dlg.querySelector('[data-prices]')?.addEventListener('click', e => {
        if (e.target.closest('[data-add-price]')) {
          openPriceForm({ ingId: ing.ING_ID, onSaved: () => refreshPrices(dlg) });
          return;
        }
        const row = e.target.closest('[data-price-id]');
        if (row) {
          const price = store.byId('SUPPLIER_PRICES', row.dataset.priceId);
          openPriceForm({ price, onSaved: () => refreshPrices(dlg), onDeleted: () => refreshPrices(dlg) });
        }
      });
    },
    onChange: (d, dlg) => {
      const el = dlg.querySelector('[data-preview]');
      const y = yieldFraction({ 'YIELD_%': d['YIELD_%'] });
      if (isNew) {
        const { size, unit } = normalisePack(d.P_SIZE, d.P_UNIT);
        const bought = priceUnitCost({ PACK_SIZE: size, PACK_UNIT: unit, PACK_PRICE: d.P_PRICE });
        if (bought == null) { el.textContent = 'Add a first price to see the unit cost.'; return; }
        el.innerHTML = y && y !== 1
          ? `<strong>${formatUnitCost(bought / y, unit)}</strong> usable · ${formatUnitCost(bought, unit)} as bought`
          : `<strong>${formatUnitCost(bought, unit)}</strong>`;
        return;
      }
      const live = { ...store.byId('INGREDIENTS', ing.ING_ID), SUPPLIER_ID: d.SUPPLIER_ID, UNIT: d.UNIT };
      const chosen = chosenPrice(live);
      if (!chosen) { el.textContent = 'No usable price yet, so recipes cost this as £0.'; return; }
      const bought = priceUnitCost(chosen.price);
      const unit = ingredientUnit(live);
      const fellBack = d.SUPPLIER_ID && chosen.why === 'cheapest';
      el.innerHTML = `<strong>${formatUnitCost(y ? bought / y : null, unit)}</strong> usable · from ${esc(supplierName(chosen.price.SUPPLIER_ID))}${
        fellBack ? ' (your preferred supplier has no price, so the cheapest is used)' : chosen.why === 'cheapest' ? ', the cheapest' : ''}`;
    },
    onSubmit: async d => {
      const clash = store.rows('INGREDIENTS').find(i => sameName(i.NAME, d.NAME) && i.ING_ID !== ing?.ING_ID);
      if (clash) throw new Error(`An ingredient called “${clash.NAME}” already exists (${clash.ING_ID}).`);
      const yieldPct = d['YIELD_%'] === '' ? 100 : d['YIELD_%'];
      if (!(yieldPct > 0 && yieldPct <= 100)) throw new Error('Yield must be between 1 and 100%.');

      const base = {
        NAME: d.NAME, CATEGORY: d.CATEGORY, STORAGE: d.STORAGE, UNIT: d.UNIT, 'YIELD_%': yieldPct,
        SHELF_LIFE: d.SHELF_LIFE, ACTIVE: d.ACTIVE, ALLERGENS: d.ALLERGENS, DIETARY: d.DIETARY,
      };

      if (!isNew) {
        const clashes = pricesFor(ing.ING_ID).filter(p => normalisePack(1, p.PACK_UNIT).unit !== d.UNIT);
        if (clashes.length) {
          throw new Error(`${clashes.length} supplier price${clashes.length === 1 ? ' is' : 's are'} in ${clashes[0].PACK_UNIT}. Change or remove ${clashes.length === 1 ? 'it' : 'them'} before changing how this is measured.`);
        }
        await store.update('INGREDIENTS', ing.ING_ID, { ...base, SUPPLIER_ID: d.SUPPLIER_ID });
        toast(`Saved ${d.NAME}`);
        if (root?.isConnected) renderList();
        onSaved?.(ing.ING_ID);
        return;
      }

      const wantsPrice = d.P_SUPPLIER || d.P_SIZE !== '' || d.P_PRICE !== '';
      let pack = null;
      if (wantsPrice) {
        if (!d.P_SUPPLIER) throw new Error('Choose the supplier for the first price, or clear the price fields.');
        pack = normalisePack(d.P_SIZE, d.P_UNIT);
        if (!(pack.size > 0)) throw new Error('Pack size must be greater than zero.');
        if (d.P_PRICE === '' || !(d.P_PRICE >= 0)) throw new Error('Enter the pack price.');
        base.UNIT = pack.unit; // the first price decides how it's measured
      }
      const id = await store.create('INGREDIENTS', base);
      if (pack) {
        try {
          const priceId = await store.create('SUPPLIER_PRICES', {
            SUPPLIER_ID: d.P_SUPPLIER, ING_ID: id, SUPPLIER_CODE: d.P_CODE, PACK_SIZE: pack.size, PACK_UNIT: pack.unit,
            PACK_PRICE: d.P_PRICE, UPDATED: store.today(),
          });
          await store.logPrices([{ ING_ID: id, SUPPLIER_ID: d.P_SUPPLIER, PRICE_ID: priceId, PACK_PRICE: d.P_PRICE, INVOICE_REF: d.P_REF }]);
        } catch (err) {
          console.error(err);
          toast(`Added ${d.NAME}, but its price wasn't saved: ${err.message}`, 'error');
        }
      }
      toast(`Added ${d.NAME}`);
      if (root?.isConnected) renderList();
      onSaved?.(id);
    },
  });
}

// ============================================================ add many

let bulkDlg = null;
let bulk = []; // { NAME, CATEGORY, UNIT, ALLERGENS, STORAGE, include, exists }

function ensureBulkDialog() {
  if (bulkDlg) return;
  bulkDlg = document.createElement('dialog');
  bulkDlg.className = 'modal paste-sheet bulk-sheet';
  bulkDlg.innerHTML = `
    <div class="modal-form">
      <header class="modal-head">
        <h2>Add many ingredients</h2>
        <button type="button" class="icon-btn" data-act="close" aria-label="Close">&times;</button>
      </header>
      <div class="modal-body">
        <p class="muted small">Start from a list of common Italian kitchen ingredients, or type your own, one per line (optionally <i>name, category</i>). They're added without a supplier or price; link them from each supplier's page later. Allergens on the starter list are the obvious ones only: check them against your suppliers' specs.</p>
        <button type="button" class="btn block" data-act="starter">Load the starter list (${STARTER_INGREDIENTS.length})</button>
        <textarea data-bulk-text rows="4" placeholder="${esc('Wild garlic\nBlood oranges, Fruit\nSmoked almonds, Dry goods')}"></textarea>
        <button type="button" class="btn block" data-act="typed">Add these names to the list</button>
        <p class="small muted paste-summary" data-bulk-summary></p>
        <div data-bulk-rows></div>
      </div>
      <footer class="modal-foot">
        <button type="button" class="btn" data-act="close">Cancel</button>
        <button type="button" class="btn primary" data-act="save" disabled>Add ingredients</button>
      </footer>
    </div>`;
  document.body.append(bulkDlg);
  bulkDlg.addEventListener('close', parkToasts);
  bulkDlg.addEventListener('cancel', e => { if (!confirmBulkDiscard()) e.preventDefault(); });
  bulkDlg.addEventListener('click', e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') { if (confirmBulkDiscard()) bulkDlg.close(); } else if (act === 'starter') addBulkRows(STARTER_INGREDIENTS);
    else if (act === 'typed') addTyped();
    else if (act === 'save') saveBulk();
  });
  bulkDlg.addEventListener('change', e => {
    const t = e.target;
    if (t.matches('[data-cat-toggle]')) {
      bulk.filter(r => r.CATEGORY === t.dataset.catToggle && !r.exists).forEach(r => { r.include = t.checked; });
      renderBulk();
      return;
    }
    const row = t.closest('[data-b]');
    if (!row) return;
    const r = bulk[Number(row.dataset.b)];
    if (t.matches('[data-f=include]')) r.include = t.checked;
    if (t.matches('[data-f=unit]')) r.UNIT = t.value;
    if (t.matches('[data-f=name]')) { r.NAME = t.value.trim() || r.NAME; markExisting(r); }
    renderBulk();
  });
}

function confirmBulkDiscard() {
  return !bulk.some(r => r.include) || confirm('Discard this list without adding anything?');
}

function openBulk() {
  ensureBulkDialog();
  bulk = [];
  bulkDlg.querySelector('[data-bulk-text]').value = '';
  renderBulk();
  bulkDlg.showModal();
  parkToasts();
}

function markExisting(r) {
  const taken = new Set(store.rows('INGREDIENTS').map(i => normName(i.NAME)));
  r.exists = taken.has(normName(r.NAME));
  if (r.exists) r.include = false;
}

function addBulkRows(items) {
  const already = new Set(bulk.map(r => normName(r.NAME)));
  for (const it of items) {
    if (already.has(normName(it.NAME))) continue;
    already.add(normName(it.NAME));
    const r = { ALLERGENS: '', STORAGE: '', ...it, include: true };
    markExisting(r);
    bulk.push(r);
  }
  renderBulk();
}

function addTyped() {
  const box = bulkDlg.querySelector('[data-bulk-text]');
  const items = box.value.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(line => {
    const [name, cat = ''] = line.split(/\s*[,\t]\s*/);
    const category = cat || 'Other';
    return { NAME: name.charAt(0).toUpperCase() + name.slice(1), CATEGORY: category, UNIT: guessUnit(name, category) };
  });
  if (!items.length) { toast('Type at least one name.', 'error'); return; }
  addBulkRows(items);
  box.value = '';
}

function renderBulk() {
  const host = bulkDlg.querySelector('[data-bulk-rows]');
  const groups = new Map();
  bulk.forEach((r, i) => {
    if (!groups.has(r.CATEGORY)) groups.set(r.CATEGORY, []);
    groups.get(r.CATEGORY).push([r, i]);
  });
  host.innerHTML = [...groups].map(([cat, items]) => {
    const open = items.filter(([r]) => !r.exists);
    const allOn = open.length && open.every(([r]) => r.include);
    return `
      <section class="bulk-group">
        <label class="bulk-cat"><input type="checkbox" data-cat-toggle="${esc(cat)}"${allOn ? ' checked' : ''}${open.length ? '' : ' disabled'}>
          <span>${esc(cat)}</span><small>${items.filter(([r]) => r.include).length} of ${items.length}</small></label>
        ${items.map(([r, i]) => `
          <div class="bulk-row${r.include ? '' : ' off'}" data-b="${i}">
            <input type="checkbox" data-f="include"${r.include ? ' checked' : ''}${r.exists ? ' disabled' : ''} aria-label="Add ${esc(r.NAME)}">
            <span class="bulk-name">
              <input type="text" data-f="name" value="${esc(r.NAME)}" aria-label="Name">
              ${r.exists ? '<small class="muted">Already in your ingredients</small>'
                : r.ALLERGENS ? `<small class="bulk-allergens">${esc(r.ALLERGENS)}</small>` : ''}
            </span>
            <select data-f="unit" aria-label="Measured by">${['g', 'ml', 'each'].map(u => `<option${u === r.UNIT ? ' selected' : ''}>${u}</option>`).join('')}</select>
          </div>`).join('')}
      </section>`;
  }).join('');
  const n = bulk.filter(r => r.include).length;
  const existing = bulk.filter(r => r.exists).length;
  bulkDlg.querySelector('[data-bulk-summary]').textContent = bulk.length
    ? `${n} of ${bulk.length} selected${existing ? ` · ${existing} already in your ingredients` : ''}`
    : '';
  const btn = bulkDlg.querySelector('[data-act="save"]');
  btn.disabled = !n;
  btn.textContent = n ? `Add ${n} ingredient${n === 1 ? '' : 's'}` : 'Add ingredients';
}

async function saveBulk() {
  bulk.forEach(markExisting);
  const chosen = bulk.filter(r => r.include && !r.exists);
  if (!chosen.length) { renderBulk(); return; }
  const btn = bulkDlg.querySelector('[data-act="save"]');
  btn.disabled = true;
  btn.textContent = 'Adding…';
  try {
    await store.createMany('INGREDIENTS', chosen.map(r => ({
      NAME: r.NAME, CATEGORY: r.CATEGORY === 'Other' ? '' : r.CATEGORY, UNIT: r.UNIT, ALLERGENS: r.ALLERGENS,
      STORAGE: r.STORAGE, 'YIELD_%': 100, ACTIVE: true,
    })));
    bulk = [];
    bulkDlg.close();
    toast(`Added ${chosen.length} ingredient${chosen.length === 1 ? '' : 's'}. Link them to suppliers to price them.`);
    if (root?.isConnected) render(root);
  } catch (err) {
    reportError(err);
    renderBulk();
  }
}
