// Shared logic for the three measurement "families" used across Ingredients,
// SupplierIngredients and RecipeLines. Everything reduces to one of these —
// weight, volume, or unit — with a base measure (kg / L / pc) and a
// convertible display unit. Metric only, deliberately simple: no generic
// unit-conversion engine, just fixed multipliers within each family.

// tsp/tbsp are exact for Volume (1 tsp = 5ml, 1 tbsp = 15ml). For Weight
// they're necessarily an average — a teaspoon of paprika and a teaspoon of
// salt don't weigh the same — based on ~3g per teaspoon for a typical
// ground spice. Good enough for costing, not for baking chemistry.
const MEASURE_FAMILIES = {
  Weight: { base: 'kg', units: { kg: 1, g: 0.001, tsp: 0.003, tbsp: 0.009 } },
  Volume: { base: 'L', units: { L: 1, ml: 0.001, tsp: 0.005, tbsp: 0.015 } },
  Unit:   { base: 'pc', units: { pc: 1 } }
};

function baseUnitFor(measureType) {
  return MEASURE_FAMILIES[measureType] ? MEASURE_FAMILIES[measureType].base : '';
}

function unitsForType(measureType) {
  return MEASURE_FAMILIES[measureType] ? Object.keys(MEASURE_FAMILIES[measureType].units) : [];
}

// Display label for a unit option — flags the two units whose conversion is
// an average rather than an exact figure, so anyone picking them can see that.
function unitLabel(measureType, unit) {
  return (measureType === 'Weight' && (unit === 'tsp' || unit === 'tbsp')) ? unit + ' (≈ avg.)' : unit;
}

// Converts an amount in `unit` to the family's base unit (kg, L, or pc).
function toBaseAmount(measureType, amount, unit) {
  const fam = MEASURE_FAMILIES[measureType];
  if (!fam || !(unit in fam.units)) return amount;
  return amount * fam.units[unit];
}

// Generates the next sequential ID for a prefix, e.g. nextId(rows, 'ING') -> 'ING004'
// based on the highest existing number found in column A of the given rows
// (rows includes the header row as element 0).
function nextId(rows, prefix, padLength = 3) {
  let max = 0;
  for (let i = 1; i < rows.length; i++) {
    const cell = (rows[i][0] || '').toString();
    if (cell.startsWith(prefix)) {
      const n = parseInt(cell.slice(prefix.length), 10);
      if (!isNaN(n) && n > max) max = n;
    }
  }
  return prefix + String(max + 1).padStart(padLength, '0');
}

// Converts a 1-based column number to a spreadsheet column letter (1 -> A, 27 -> AA).
function colLetter(n) {
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function fmtMoney(n) {
  return '£' + (isFinite(n) ? n : 0).toFixed(4).replace(/0+$/, '').replace(/\.$/, '.00');
}

function fmtMoney2(n) {
  return '£' + (isFinite(n) ? n : 0).toFixed(2);
}
