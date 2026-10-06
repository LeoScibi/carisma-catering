// In-memory cache of the spreadsheet tabs, with typed records and ID generation.

import { SCHEMA } from './config.js';
import * as sheets from './sheets.js';

const tables = {};
let version = 0;

/** Bumped on every reload of any tab, so derived caches know when to rebuild. */
export const dataVersion = () => version;

function coerceIn(tab, rec) {
  const s = SCHEMA[tab];
  for (const f of s.numbers || []) {
    const v = rec[f];
    if (typeof v === 'string' && v.trim() !== '' && !isNaN(v)) rec[f] = Number(v);
  }
  // Blank ACTIVE (e.g. a row typed straight into the sheet) counts as active.
  for (const f of s.booleans || []) {
    const v = rec[f];
    rec[f] = v === '' || v == null || v === true || String(v).toUpperCase() === 'TRUE';
  }
  return rec;
}

function coerceOut(tab, rec) {
  const s = SCHEMA[tab];
  const out = { ...rec };
  delete out._row;
  delete out._raw;
  for (const f of s.numbers || []) {
    if (!(f in out)) continue;
    const v = out[f];
    out[f] = v === '' || v == null || isNaN(v) ? '' : Number(v);
  }
  for (const f of s.booleans || []) if (f in out) out[f] = !!out[f];
  for (const [k, v] of Object.entries(out)) if (typeof v === 'string') out[k] = v.trim();
  return out;
}

function put(tab, table) {
  table.rows.forEach(r => coerceIn(tab, r));
  tables[tab] = table;
  version++;
}

export async function loadAll() {
  await refresh(...Object.keys(SCHEMA));
}

export async function refresh(...tabs) {
  const res = await sheets.readTables(tabs);
  for (const tab of tabs) put(tab, res[tab]);
}

export function rows(tab) {
  return tables[tab]?.rows ?? [];
}

export function byId(tab, id) {
  const f = SCHEMA[tab].idField;
  return rows(tab).find(r => String(r[f]) === String(id)) || null;
}

function nextId(tab) {
  const { idField, idPrefix } = SCHEMA[tab];
  const re = new RegExp(`^${idPrefix}-(\\d+)$`);
  const max = rows(tab).reduce((m, r) => {
    const match = re.exec(String(r[idField]));
    return match ? Math.max(m, Number(match[1])) : m;
  }, 0);
  return `${idPrefix}-${String(max + 1).padStart(4, '0')}`;
}

/** Append new records; returns their generated IDs in order. */
export async function createMany(tab, records) {
  // Re-read first so new IDs account for rows other users added since we loaded.
  await refresh(tab);
  const { idField, idPrefix } = SCHEMA[tab];
  const start = Number(nextId(tab).slice(idPrefix.length + 1));
  const ids = records.map((_, i) => `${idPrefix}-${String(start + i).padStart(4, '0')}`);
  await sheets.appendRows(tab, tables[tab].headers, records.map((r, i) => ({ ...coerceOut(tab, r), [idField]: ids[i] })));
  await refresh(tab);
  return ids;
}

/** Append a new record; returns its generated ID. */
export async function create(tab, record) {
  return (await createMany(tab, [record]))[0];
}

/** `changes` is [{ id, record }]; only the fields in each record are written. */
export async function updateMany(tab, changes) {
  const { idField } = SCHEMA[tab];
  await sheets.updateRowsById(tab, idField, changes.map(({ id, record }) => ({
    id, patch: { ...coerceOut(tab, record), [idField]: id },
  })));
  await refresh(tab);
}

export async function update(tab, id, record) {
  await updateMany(tab, [{ id, record }]);
}

/** Delete records from one or more tabs in one all-or-nothing request. `spec` is { TAB: [ids] }. */
export async function remove(spec) {
  const tabs = Object.keys(spec);
  await sheets.deleteRowsById(tabs.map(tab => ({ tab, idField: SCHEMA[tab].idField, ids: spec[tab] })));
  await refresh(...tabs);
}

export const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local time

/** Append price-history rows: entries are { ING_ID, SUPPLIER_ID, PRICE_ID, PACK_PRICE, INVOICE_REF }. */
export async function logPrices(entries) {
  if (!entries.length) return;
  const tab = 'PRICE_HISTORY';
  const headers = tables[tab]?.headers?.length ? tables[tab].headers : SCHEMA[tab].headers;
  await sheets.appendRows(tab, headers, entries.map(e => coerceOut(tab, { DATE: today(), INVOICE_REF: '', ...e })));
  await refresh(tab);
}
