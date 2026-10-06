// Parses a pasted ingredient list ("200g plain flour", "2 cloves garlic", "1 ½ cups milk")
// into quantity, unit and name, and matches each to an existing ingredient.
// Ported from Carisma Ops' paste importer. Cooking units convert to metric.

import { BASE } from './units.js';
import { ingredientFamily } from './recipe-cost.js';

// word → [families ('a|b' when ambiguous), unit, multiplier]
const COOK_UNITS = {
  g: ['weight', 'g', 1], gram: ['weight', 'g', 1], grams: ['weight', 'g', 1], gr: ['weight', 'g', 1],
  kg: ['weight', 'kg', 1], kilo: ['weight', 'kg', 1], kilos: ['weight', 'kg', 1], kilogram: ['weight', 'kg', 1], kilograms: ['weight', 'kg', 1],
  oz: ['weight', 'g', 28.35], ounce: ['weight', 'g', 28.35], ounces: ['weight', 'g', 28.35],
  lb: ['weight', 'g', 453.6], lbs: ['weight', 'g', 453.6], pound: ['weight', 'g', 453.6], pounds: ['weight', 'g', 453.6],
  ml: ['volume', 'ml', 1], milliliter: ['volume', 'ml', 1], millilitre: ['volume', 'ml', 1], milliliters: ['volume', 'ml', 1], millilitres: ['volume', 'ml', 1],
  cl: ['volume', 'cl', 1], centilitre: ['volume', 'cl', 1], centilitres: ['volume', 'cl', 1],
  l: ['volume', 'L', 1], litre: ['volume', 'L', 1], litres: ['volume', 'L', 1], liter: ['volume', 'L', 1], liters: ['volume', 'L', 1],
  tbsp: ['volume|weight', 'tbsp', 1], tbs: ['volume|weight', 'tbsp', 1], tablespoon: ['volume|weight', 'tbsp', 1], tablespoons: ['volume|weight', 'tbsp', 1],
  tsp: ['volume|weight', 'tsp', 1], teaspoon: ['volume|weight', 'tsp', 1], teaspoons: ['volume|weight', 'tsp', 1],
  cup: ['volume', 'ml', 240], cups: ['volume', 'ml', 240],
  pc: ['each', 'each', 1], pcs: ['each', 'each', 1], piece: ['each', 'each', 1], pieces: ['each', 'each', 1], each: ['each', 'each', 1],
  clove: ['each', 'each', 1], cloves: ['each', 'each', 1], slice: ['each', 'each', 1], slices: ['each', 'each', 1],
  egg: ['each', 'each', 1], eggs: ['each', 'each', 1], can: ['each', 'each', 1], cans: ['each', 'each', 1], tin: ['each', 'each', 1], tins: ['each', 'each', 1],
  bunch: ['each', 'each', 1], bunches: ['each', 'each', 1], sprig: ['each', 'each', 1], sprigs: ['each', 'each', 1],
  bottle: ['each', 'each', 1], bottles: ['each', 'each', 1],
  dozen: ['each', 'each', 12], pinch: ['weight', 'g', 1], pinches: ['weight', 'g', 1],
};
const UNI_FRAC = { '½': .5, '¼': .25, '¾': .75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': .125, '⅜': .375, '⅝': .625, '⅞': .875, '⅕': .2, '⅖': .4, '⅗': .6 };
const FRAC_CHARS = '½¼¾⅓⅔⅛⅜⅝⅞⅕⅖⅗';
const NOISE = /\b(fresh|dried|chopped|minced|diced|sliced|grated|shredded|ground|finely|roughly|large|small|medium|ripe|to taste|for garnish|optional|softened|melted|beaten|peeled|crushed|plus extra.*)\b/gi;

export const normName = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const singular = w => (w.endsWith('es') && w.length > 4) ? w.slice(0, -2)
  : (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) ? w.slice(0, -1) : w;
// Light stemming so English and Italian plurals meet: tomatoes/tomato → tomat,
// datterini/datterino → datterin. Only -i/-o, so pasta and paste stay apart.
const stem = w => { const s1 = singular(w); return s1.length > 4 ? s1.replace(/[io]$/, '') : s1; };
export const nameTokens = s => normName(s).split(' ').filter(Boolean).map(stem);

/** Edit distance, for typos ("rosmary" → "rosemary"). */
function lev(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** Same word, allowing one typo in words of 5+ letters and two in words of 10+ ("chicken" ≠ "chickpea"). */
function sameWord(a, b) {
  if (a === b) return true;
  const n = Math.max(a.length, b.length);
  return n >= 5 && a[0] === b[0] && Math.abs(a.length - b.length) <= 2 && lev(a, b) <= (n >= 10 ? 2 : 1);
}

const ingTokens = s => nameTokens(String(s).replace(/\(.*?\)/g, ' '));

/**
 * Score how well a typed name ("white onion", "rosmary", "pepper corns") fits an ingredient.
 *  - the ingredient's main word (its last: "Red wine vinegar" → vinegar) must be there, so
 *    "red wine" picks House red wine over Red wine vinegar;
 *  - if both sides have words the other lacks ("coriander seeds" vs "Fennel seeds"), they're
 *    different things; one side being more specific is fine ("white onion" → Onions);
 *  - words run together count too: "pepper corns" → Black peppercorns.
 */
export function matchScore(name, ingName) {
  const nt = nameTokens(name);
  const it = ingTokens(ingName);
  if (!nt.length || !it.length) return 0;
  const hit = (t, list) => list.some(u => sameWord(t, u));
  const overlap = nt.filter(t => hit(t, it)).length;
  if (!overlap) {
    const cn = nt.join('');
    const ci = it.join('');
    return cn.length >= 6 && (ci.includes(cn) || cn.includes(ci)) ? 1.2 : 0;
  }
  // Main word missing: only OK for a single word naming an Italian-style "noun first" ingredient
  // ("parmigiano" → Parmigiano Reggiano, "mozzarella" → Mozzarella di bufala).
  if (!hit(it[it.length - 1], nt) && !(nt.length === 1 && sameWord(nt[0], it[0]))) return 0;
  const extraTyped = nt.length - overlap;
  const extraIng = it.filter(u => !hit(u, nt)).length;
  if (extraTyped && extraIng) return 0;
  return overlap / it.length + overlap / nt.length + (normName(ingName) === normName(name) ? 1 : 0);
}

/** Best-scoring ingredient for `name`: { ing, score }, or null if nothing fits. */
export function bestMatch(name, ingredients) {
  let best = null;
  for (const ing of ingredients) {
    const score = matchScore(name, ing.NAME);
    if (score > (best?.score ?? 0)) best = { ing, score };
  }
  return best && best.score >= 0.9 ? best : null;
}

export function matchIngredient(name, ingredients) {
  return bestMatch(name, ingredients)?.ing ?? null;
}

const cleanName = s => s.replace(/\(.*?\)/g, ' ').split(',')[0].replace(NOISE, ' ').replace(/\s+/g, ' ').trim();

function peelUnit(s) {
  const m = s.match(/^([a-zA-Z]+)\.?\s*/);
  if (m) {
    const t0 = m[1].toLowerCase();
    const hit = COOK_UNITS[t0] || COOK_UNITS[singular(t0)];
    if (hit) return { cook: hit, unitRaw: m[1], rest: s.slice(m[0].length) };
  }
  return { cook: null, unitRaw: '', rest: s };
}

function extractLeading(s) {
  let m;
  let qty;
  if ((m = s.match(/^(\d+)\s+(\d+)\/(\d+)\s*/))) qty = +m[1] + m[2] / m[3];
  else if ((m = s.match(new RegExp(`^(\\d+)\\s*([${FRAC_CHARS}])\\s*`)))) qty = +m[1] + UNI_FRAC[m[2]];
  else if ((m = s.match(/^(\d+)\/(\d+)\s*/))) qty = m[1] / m[2];
  else if ((m = s.match(new RegExp(`^([${FRAC_CHARS}])\\s*`)))) qty = UNI_FRAC[m[1]];
  else if ((m = s.match(/^(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)\s*/))) qty = parseFloat(m[1]);
  else if ((m = s.match(/^(\d+(?:\.\d+)?)\s*/))) qty = parseFloat(m[1]);
  else return null;
  const after = s.slice(m[0].length);
  const { cook, unitRaw, rest } = peelUnit(after);
  if (cook && rest.trim()) return { qty, cook, unitRaw, name: rest };
  return { qty, cook: null, unitRaw: '', name: after };
}

function extractEmbedded(s) {
  let m;
  let qty;
  if ((m = s.match(/(\d+)\s+(\d+)\/(\d+)/))) qty = +m[1] + m[2] / m[3];
  else if ((m = s.match(new RegExp(`(\\d+)\\s*([${FRAC_CHARS}])`)))) qty = +m[1] + UNI_FRAC[m[2]];
  else if ((m = s.match(/(\d+)\/(\d+)/))) qty = m[1] / m[2];
  else if ((m = s.match(new RegExp(`[${FRAC_CHARS}]`)))) qty = UNI_FRAC[m[0]];
  else if ((m = s.match(/\d+(?:\.\d+)?/))) qty = parseFloat(m[0]);
  else return null;
  const start = m.index;
  const end = start + m[0].length;
  const { cook, unitRaw, rest } = peelUnit(s.slice(end).replace(/^\s+/, ''));
  return { qty, cook, unitRaw, name: (s.slice(0, start) + ' ' + rest).replace(/\s+/g, ' ').trim() };
}

function parseQtyUnit(raw) {
  let s = raw.trim().replace(/^[-*•–—▪●·]\s*/, '');
  // A metric amount in brackets wins: "1 cup (240ml) milk".
  const mp = s.match(/\((\d+(?:\.\d+)?)\s*(kg|kilograms?|g|grams?|ml|milliliters?|millilitres?|cl|l|litres?|liters?)\)/i);
  let metric = null;
  if (mp) {
    const u0 = mp[2].toLowerCase();
    metric = { qty: parseFloat(mp[1]), cook: COOK_UNITS[u0] || COOK_UNITS[singular(u0)], unitRaw: mp[2] };
  }
  s = s.replace(/\([^)]*\)/g, ' ').replace(/\s+-\s+.*$/, '').replace(/\s+/g, ' ').trim();
  const leading = extractLeading(s);
  const found = leading || extractEmbedded(s) || { qty: null, cook: null, unitRaw: '', name: s };
  const name = cleanName(found.name.replace(/^of\s+/i, ''));
  const base = metric?.cook ? metric : found;
  return { qty: base.qty, cook: base.cook, unitRaw: base.unitRaw, name, leadingQty: !!leading };
}

function looksLikeIngredient(p, raw) {
  if (p.leadingQty) return true;
  const t = raw.trim();
  if (!t || t.length > 45) return false;
  if (/[.!?]$/.test(t)) return false;
  if (/^(step|method|instructions?|directions?|preheat|heat|cook|bake|stir|serve|mix|add|combine|season|for the)/i.test(t)) return false;
  return true;
}

// Unit → [the other family, its equivalent unit] for the 1 g = 1 ml swap.
const LIQUID_SWAP = { g: ['volume', 'ml', 1], kg: ['volume', 'L', 1], ml: ['weight', 'g', 1], cl: ['weight', 'g', 10], L: ['weight', 'kg', 1] };

/**
 * One row per pasted line:
 * { raw, name, ingId (null = create new), family, unit, qty, include, note }
 */
export function parseRecipeText(text, ingredients) {
  return text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(raw => {
    const p = parseQtyUnit(raw);
    const match = p.name ? matchIngredient(p.name, ingredients) : null;
    const cookFamilies = p.cook ? p.cook[0].split('|') : [];
    const family = (match && ingredientFamily(match)) || cookFamilies[0] || 'each';
    let unit = BASE[family];
    let qty = p.qty;
    let note = '';
    if (p.cook) {
      if (cookFamilies.includes(family)) {
        unit = p.cook[1];
        qty = p.qty != null ? +(p.qty * p.cook[2]).toFixed(2) : null;
      } else if (LIQUID_SWAP[p.cook[1]] && LIQUID_SWAP[p.cook[1]][0] === family) {
        // Weight for a liquid or volume for a solid ("400 g red wine"): close enough at 1 g = 1 ml.
        unit = LIQUID_SWAP[p.cook[1]][1];
        qty = p.qty != null ? +(p.qty * p.cook[2] * LIQUID_SWAP[p.cook[1]][2]).toFixed(2) : null;
        note = `Converted ${p.unitRaw} to ${unit} at 1 g = 1 ml. Check it's right for ${match ? match.NAME : 'this'}.`;
      } else {
        note = `“${p.unitRaw}” doesn't fit how ${match ? match.NAME : 'this'} is bought. Check the quantity.`;
      }
    }
    return {
      raw, name: p.name || raw, note,
      ingId: match ? match.ING_ID : null,
      family, unit, qty,
      include: looksLikeIngredient(p, raw),
    };
  });
}
