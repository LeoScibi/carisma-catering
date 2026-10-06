// Measurement families for recipe quantities. Everything reduces to a base unit:
// weight → g, volume → ml, each → each. Metric only, fixed multipliers.
//
// tsp/tbsp are exact for volume (5 / 15 ml). For weight they're an average (~3 g per
// teaspoon of a typical ground spice): good enough for costing, not for baking.

export const BASE = { weight: 'g', volume: 'ml', each: 'each' };

const UNITS = {
  g: ['weight', 1], kg: ['weight', 1000],
  ml: ['volume', 1], cl: ['volume', 10], L: ['volume', 1000],
  each: ['each', 1],
};
const SPOONS = { tsp: { weight: 3, volume: 5 }, tbsp: { weight: 9, volume: 15 } };

const FAMILY_UNITS = {
  weight: ['g', 'kg', 'tsp', 'tbsp'],
  volume: ['ml', 'cl', 'L', 'tsp', 'tbsp'],
  each: ['each'],
};

/** Canonical spelling: 'l' → 'L', 'KG' → 'kg', 'portions' → 'portion'. */
export function normUnit(u) {
  const s = String(u ?? '').trim();
  if (/^l$/i.test(s)) return 'L';
  const low = s.toLowerCase();
  if (low === 'portions') return 'portion';
  return low;
}

/** Family of a concrete unit, or null for spoons (which belong to both) and unknowns. */
export function familyOf(unit) {
  return UNITS[normUnit(unit)]?.[0] ?? null;
}

export function unitsFor(family) {
  return FAMILY_UNITS[family] ?? [];
}

/** Convert `qty unit` to the family's base unit, or null if the unit doesn't belong to the family. */
export function toBase(family, qty, unit) {
  const u = normUnit(unit);
  const n = Number(qty);
  if (!isFinite(n)) return null;
  if (UNITS[u] && UNITS[u][0] === family) return n * UNITS[u][1];
  if (SPOONS[u] && SPOONS[u][family]) return n * SPOONS[u][family];
  return null;
}

export function unitLabel(family, unit) {
  const u = normUnit(unit);
  return family === 'weight' && SPOONS[u] ? `${u} (≈${SPOONS[u].weight} g)` : u;
}

/** Quantity for display: at most 2 decimals, no trailing zeros. */
export function fmtQty(n) {
  return isFinite(n) ? String(+Number(n).toFixed(2)) : '';
}
