// Recipe costing. Nothing here is stored: every figure is derived from the raw inputs in
// INGREDIENTS, RECIPES and RECIPE_LINES, so a price change shows up everywhere at once.

import * as store from './store.js';
import { RECIPE_DEFAULTS } from './config.js';
import { usableUnitCost, ingredientFamily } from './costing.js';
import { splitList } from './ui.js';
import { BASE, familyOf, toBase, normUnit } from './units.js';

export { ingredientFamily };

/** A recipe's yield family (from YIELD_UNIT), or null if it has no measurable yield. */
export const recipeFamily = rec => familyOf(rec?.YIELD_UNIT);

export const isSub = rec => String(rec?.TYPE).toLowerCase() === 'sub';
export const portionsOf = rec => (Number(rec?.PORTIONS) > 0 ? Number(rec.PORTIONS) : 1);

export function sortLines(lines) {
  return lines.slice().sort((a, b) => {
    const sa = a.SORT === '' ? Infinity : Number(a.SORT);
    const sb = b.SORT === '' ? Infinity : Number(b.SORT);
    return sa - sb || a._row - b._row;
  });
}

/**
 * Snapshot of the current data with a memoised `cost(recipeId)`.
 * Create one per render; it is cheap and always reflects the store at creation time.
 */
export function createCoster() {
  const ings = new Map(store.rows('INGREDIENTS').map(i => [String(i.ING_ID), i]));
  const recs = new Map(store.rows('RECIPES').map(r => [String(r.RECIPE_ID), r]));
  const linesBy = new Map();
  for (const l of store.rows('RECIPE_LINES')) {
    const k = String(l.RECIPE_ID);
    if (!linesBy.has(k)) linesBy.set(k, []);
    linesBy.get(k).push(l);
  }
  for (const [k, v] of linesBy) linesBy.set(k, sortLines(v));

  const memo = new Map();
  const stack = new Set();

  function lineCost(l) {
    const type = String(l.ITEM_TYPE).toUpperCase();
    const id = String(l.ITEM_ID);
    const unit = normUnit(l.UNIT);
    const qty = Number(l.QTY) || 0;
    const out = { line: l, type, cost: 0, rate: null, rateUnit: '', problem: null, allergens: [], item: null, family: null };

    if (type === 'SUB') {
      const sub = recs.get(id);
      out.item = sub;
      if (!sub) return { ...out, problem: 'missing' };
      if (stack.has(id)) return { ...out, problem: 'circular' };
      const sc = cost(id);
      out.allergens = [...sc.allergens];
      out.family = sc.family;
      if (sc.unpriced || sc.circular) out.problem = 'partial';
      if (unit === 'portion') {
        out.cost = qty * sc.perPortion;
        out.rate = sc.perPortion;
        out.rateUnit = 'portion';
      } else {
        const base = sc.family ? toBase(sc.family, qty, unit) : null;
        if (base == null || !sc.yieldBase) return { ...out, problem: 'unit' };
        out.cost = (base / sc.yieldBase) * sc.total;
        out.rate = sc.total / sc.yieldBase;
        out.rateUnit = BASE[sc.family];
      }
      return out;
    }

    const ing = ings.get(id);
    out.item = ing;
    if (!ing) return { ...out, problem: 'missing' };
    out.allergens = splitList(ing.ALLERGENS);
    out.family = ingredientFamily(ing);
    const c = usableUnitCost(ing);
    if (c == null || !out.family) return { ...out, problem: 'unpriced' };
    const base = toBase(out.family, qty, unit);
    if (base == null) return { ...out, problem: 'unit' };
    out.cost = base * c;
    out.rate = c;
    out.rateUnit = BASE[out.family];
    return out;
  }

  function cost(recipeId) {
    const key = String(recipeId);
    if (memo.has(key)) return memo.get(key);
    const rec = recs.get(key);
    stack.add(key);
    const lines = (linesBy.get(key) || []).map(lineCost);
    stack.delete(key);

    const total = lines.reduce((s, l) => s + l.cost, 0);
    const family = recipeFamily(rec);
    const yieldBase = family ? toBase(family, rec.YIELD_QTY, rec.YIELD_UNIT) : null;
    const portions = portionsOf(rec);
    const allergens = new Set(lines.flatMap(l => l.allergens));
    const result = {
      rec, lines, total, family, portions,
      yieldBase: yieldBase > 0 ? yieldBase : null,
      perPortion: total / portions,
      perBase: yieldBase > 0 ? total / yieldBase : null,
      allergens: [...allergens].sort((a, b) => a.localeCompare(b)),
      unpriced: lines.filter(l => ['unpriced', 'partial', 'missing', 'unit'].includes(l.problem)).length,
      circular: lines.some(l => l.problem === 'circular'),
      // GP means nothing until there is something to cost.
      ...(lines.length ? pricing(rec, total / portions) : { ...pricing(rec, 0), gp: null, gpPct: null, onTarget: null }),
    };
    memo.set(key, result);
    return result;
  }

  /** True if `candidateId` is `recipeId` or (indirectly) uses it — adding it would loop. */
  function wouldLoop(recipeId, candidateId, seen = new Set()) {
    const c = String(candidateId);
    if (c === String(recipeId)) return true;
    if (seen.has(c)) return false;
    seen.add(c);
    return (linesBy.get(c) || []).some(l =>
      String(l.ITEM_TYPE).toUpperCase() === 'SUB' && wouldLoop(recipeId, l.ITEM_ID, seen));
  }

  return { cost, wouldLoop, ings, recs, linesOf: id => linesBy.get(String(id)) || [] };
}

/** Sell-side figures for one portion. All money inc/ex VAT as labelled. */
export function pricing(rec, perPortion) {
  const vat = rec?.VAT_RATE === '' || rec?.VAT_RATE == null ? RECIPE_DEFAULTS.VAT_RATE : Number(rec.VAT_RATE);
  const target = rec?.['TARGET_GP%'] === '' || rec?.['TARGET_GP%'] == null ? RECIPE_DEFAULTS.TARGET_GP : Number(rec['TARGET_GP%']);
  const sell = Number(rec?.SELL_PRICE);
  const hasSell = rec?.SELL_PRICE !== '' && sell > 0;
  const net = hasSell ? sell / (1 + vat / 100) : null;
  const gp = hasSell ? net - perPortion : null;
  const gpPct = hasSell ? (gp / net) * 100 : null;
  const suggested = target < 100 ? (perPortion / (1 - target / 100)) * (1 + vat / 100) : null;
  return { vat, target, sell: hasSell ? sell : null, net, gp, gpPct, suggested, onTarget: hasSell ? gpPct >= target : null };
}
