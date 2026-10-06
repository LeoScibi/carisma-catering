// Cost calculations. The sheet stores raw inputs only; everything here is derived.
//
// Prices come from supplier price lists (SUPPLIER_PRICES). An ingredient's cost uses its
// preferred supplier's price if it has one, otherwise the cheapest price on any list.

import * as store from './store.js';
import { money } from './ui.js';
import { familyOf, toBase, normUnit } from './units.js';

// Friendly units accepted in forms, converted to the stored base units (g / ml / each).
const CONVERT = { g: ['g', 1], kg: ['g', 1000], ml: ['ml', 1], cl: ['ml', 10], l: ['ml', 1000], each: ['each', 1] };

export const PACK_UNIT_OPTIONS = [['g', 'g'], ['kg', 'kg → g'], ['ml', 'ml'], ['cl', 'cl → ml'], ['L', 'L → ml'], ['each', 'each']];

export const MEASURE_OPTIONS = [['g', 'Weight (g, kg)'], ['ml', 'Volume (ml, cl, L)'], ['each', 'Each (pieces, bottles)']];

export function normalisePack(size, unit) {
  const [base, factor] = CONVERT[String(unit).toLowerCase()] || [unit, 1];
  const n = Number(size);
  return { size: size === '' || isNaN(n) ? '' : Math.round(n * factor * 1e6) / 1e6, unit: base };
}

const UNIT_FAMILY = { g: 'weight', ml: 'volume', each: 'each' };

/** How an ingredient is measured: 'g', 'ml' or 'each' (falls back to the pre-price-list PACK_UNIT). */
export function ingredientUnit(ing) {
  const u = normUnit(ing?.UNIT || ing?.PACK_UNIT);
  return UNIT_FAMILY[u] ? u : '';
}

export const ingredientFamily = ing => UNIT_FAMILY[ingredientUnit(ing)] ?? null;

/** Cost per g / ml / each of one price-list row as bought, or null if incomplete. */
export function priceUnitCost(p) {
  const fam = familyOf(p?.PACK_UNIT);
  const base = fam ? toBase(fam, p.PACK_SIZE, p.PACK_UNIT) : null;
  const price = Number(p?.PACK_PRICE);
  if (p?.PACK_PRICE === '' || p?.PACK_PRICE == null || !(base > 0) || !(price >= 0)) return null;
  return price / base;
}

let index = null;
let indexVersion = -1;

/** All price-list rows for an ingredient. */
export function pricesFor(ingId) {
  if (indexVersion !== store.dataVersion()) {
    index = new Map();
    for (const p of store.rows('SUPPLIER_PRICES')) {
      const k = String(p.ING_ID);
      if (!index.has(k)) index.set(k, []);
      index.get(k).push(p);
    }
    indexVersion = store.dataVersion();
  }
  return index.get(String(ingId)) || [];
}

/** Rows that can actually cost the ingredient: complete, and in the same measure as the ingredient. */
export function usablePrices(ing) {
  const fam = ingredientFamily(ing);
  return pricesFor(ing?.ING_ID).filter(p => priceUnitCost(p) != null && (!fam || familyOf(p.PACK_UNIT) === fam));
}

const cheapestOf = rows => rows.reduce((a, b) => (priceUnitCost(b) < priceUnitCost(a) ? b : a));

/**
 * The price recipes use: { price, why: 'preferred' | 'cheapest', cheapest } or null.
 * With several packs from the preferred supplier, the cheapest of those wins.
 */
export function chosenPrice(ing) {
  const rows = usablePrices(ing);
  if (!rows.length) return null;
  const cheapest = cheapestOf(rows);
  const pref = ing.SUPPLIER_ID ? rows.filter(p => String(p.SUPPLIER_ID) === String(ing.SUPPLIER_ID)) : [];
  return pref.length ? { price: cheapestOf(pref), why: 'preferred', cheapest } : { price: cheapest, why: 'cheapest', cheapest };
}

/** Cost per g / ml / each as purchased, from the chosen price. */
export function unitCost(ing) {
  const c = chosenPrice(ing);
  return c ? priceUnitCost(c.price) : null;
}

export function yieldFraction(ing) {
  const y = ing?.['YIELD_%'] === '' || ing?.['YIELD_%'] == null ? 100 : Number(ing['YIELD_%']);
  return y > 0 ? y / 100 : null;
}

/** Cost per usable g / ml / each after trim and waste (yield). */
export function usableUnitCost(ing) {
  const c = unitCost(ing);
  const y = yieldFraction(ing);
  return c == null || y == null ? null : c / y;
}

const DISPLAY = { g: [1000, '/kg'], ml: [1000, '/L'], each: [1, ' each'] };

export function formatUnitCost(cost, unit) {
  if (cost == null) return '—';
  const [factor, suffix] = DISPLAY[unit] || [1, `/${unit}`];
  return money(cost * factor) + suffix;
}

/** "750 ml", "5 kg" style pack label from a stored size in g / ml / each. */
export function packLabel(size, unit) {
  const n = Number(size);
  if (size === '' || !isFinite(n)) return '';
  if (unit === 'g' && n >= 1000) return `${+(n / 1000).toFixed(3)} kg`;
  if (unit === 'ml' && n >= 1000) return `${+(n / 1000).toFixed(3)} L`;
  return `${+n.toFixed(3)} ${unit}`;
}
