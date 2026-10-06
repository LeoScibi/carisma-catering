// Thin wrapper over the Google Sheets API v4, called directly from the browser.
// Tables are read by header name, so column order in the sheet doesn't matter
// and extra columns added by hand are preserved on update.

import { spreadsheetId } from './config.js';
import { getToken, markExpired, AuthError } from './auth.js';

const API = 'https://sheets.googleapis.com/v4/spreadsheets';

export class SheetsError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// `sheet` defaults to the app's own spreadsheet; '' addresses the collection (to create one).
async function request(path, { method = 'GET', query, body, sheet = spreadsheetId() } = {}) {
  const url = new URL(API + (sheet ? `/${sheet}` : '') + path);
  for (const [k, v] of Object.entries(query || {})) {
    for (const item of [].concat(v)) url.searchParams.append(k, item);
  }
  for (let attempt = 0; ; attempt++) {
    const t = getToken();
    if (!t) throw new AuthError('Your Google session has expired.');
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${t}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.ok) return res.json();
    if (res.status === 401) {
      markExpired();
      throw new AuthError('Your Google session has expired.');
    }
    // Back off on quota (60 req/min/user) and transient server errors.
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    let msg = res.statusText;
    try { msg = (await res.json()).error.message; } catch { /* keep statusText */ }
    if (res.status === 403) msg = `No permission for that spreadsheet. Ask for it to be shared with you. (${msg})`;
    if (res.status === 404) msg = 'Spreadsheet not found. Check the spreadsheet ID.';
    throw new SheetsError(res.status, msg);
  }
}

/** Quote a tab name for A1 notation. */
const q = tab => `'${tab.replace(/'/g, "''")}'`;

export function colLetter(n) {
  let s = '';
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/**
 * Create any missing tabs, and append any missing header columns to existing tabs.
 * Never removes or reorders anything already in the sheet.
 */
export async function ensureSchema(schema) {
  const tabs = Object.keys(schema);
  const meta = await request('', { query: { fields: 'sheets.properties(sheetId,title)' } });
  const existing = new Set(meta.sheets.map(s => s.properties.title));
  const missing = tabs.filter(t => !existing.has(t));

  if (missing.length) {
    const res = await request(':batchUpdate', {
      method: 'POST',
      body: {
        requests: missing.map(title => ({
          addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } },
        })),
      },
    });
    // Bold the header row of new tabs.
    await request(':batchUpdate', {
      method: 'POST',
      body: {
        requests: res.replies.map(r => ({
          repeatCell: {
            range: { sheetId: r.addSheet.properties.sheetId, startRowIndex: 0, endRowIndex: 1 },
            cell: { userEnteredFormat: { textFormat: { bold: true } } },
            fields: 'userEnteredFormat.textFormat.bold',
          },
        })),
      },
    });
  }

  const got = await request('/values:batchGet', { query: { ranges: tabs.map(t => `${q(t)}!1:1`) } });
  const data = [];
  const addedColumns = {};
  got.valueRanges.forEach((vr, i) => {
    const tab = tabs[i];
    const current = (vr.values?.[0] || []).map(h => String(h).trim());
    const add = schema[tab].headers.filter(h => !current.includes(h));
    if (!add.length) return;
    data.push({ range: `${q(tab)}!${colLetter(current.length + 1)}1`, values: [add] });
    if (existing.has(tab)) addedColumns[tab] = add;
  });
  if (data.length) {
    await request('/values:batchUpdate', { method: 'POST', body: { valueInputOption: 'RAW', data } });
  }
  return { createdTabs: missing, addedColumns };
}

function parseTable(values = []) {
  const headers = (values[0] || []).map(h => String(h).trim());
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const raw = values[i] || [];
    if (!raw.some(v => v !== '' && v != null)) continue;
    const obj = { _row: i + 1, _raw: raw };
    headers.forEach((h, j) => { if (h) obj[h] = raw[j] ?? ''; });
    rows.push(obj);
  }
  return { headers, rows };
}

/** Read several whole tabs in one request. Returns { TAB: { headers, rows } }. */
export async function readTables(tabs) {
  const res = await request('/values:batchGet', {
    query: {
      ranges: tabs.map(q),
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'FORMATTED_STRING',
    },
  });
  const out = {};
  res.valueRanges.forEach((vr, i) => { out[tabs[i]] = parseTable(vr.values); });
  return out;
}

/** Create a new, empty spreadsheet in the signed-in user's Drive; returns its ID. */
export async function createSpreadsheet(title) {
  return (await request('', { method: 'POST', sheet: '', body: { properties: { title } } })).spreadsheetId;
}

/** Tab titles of the app's spreadsheet; throws if it can't be opened. */
export async function tabTitles(sheet = spreadsheetId()) {
  const meta = await request('', { sheet, query: { fields: 'sheets.properties.title' } });
  return meta.sheets.map(s => s.properties.title);
}

/** Read whichever of `tabs` exist in another spreadsheet (read-only). Returns { TAB: { headers, rows } }. */
export async function readForeignTables(sheet, tabs) {
  const have = new Set(await tabTitles(sheet));
  const wanted = tabs.filter(t => have.has(t));
  const out = Object.fromEntries(tabs.map(t => [t, { headers: [], rows: [] }]));
  if (!wanted.length) return out;
  const res = await request('/values:batchGet', {
    sheet,
    query: { ranges: wanted.map(q), valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'FORMATTED_STRING' },
  });
  res.valueRanges.forEach((vr, i) => { out[wanted[i]] = parseTable(vr.values); });
  return out;
}

export async function readTable(tab) {
  return (await readTables([tab]))[tab];
}

/** Lay out a record as a row in the sheet's actual header order, keeping unknown columns from `base`. */
function toRow(headers, record, base = []) {
  return headers.map((h, i) => (h && h in record ? record[h] : base[i] ?? ''));
}

export async function appendRows(tab, headers, records) {
  return request(`/values/${encodeURIComponent(`${q(tab)}!A1`)}:append`, {
    method: 'POST',
    query: { valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS' },
    body: { values: records.map(r => toRow(headers, r)) },
  });
}

/**
 * Update rows by ID: `patches` is [{ id, patch }]. Re-reads the tab first so rows are located
 * by ID even if they were inserted or sorted in the sheet since we loaded it. One write request.
 */
export async function updateRowsById(tab, idField, patches) {
  const { headers, rows } = await readTable(tab);
  const data = patches.map(({ id, patch }) => {
    const row = rows.find(r => String(r[idField]) === String(id));
    if (!row) throw new SheetsError(404, `${id} was not found in ${tab}. It may have been deleted in the sheet.`);
    return {
      range: `${q(tab)}!A${row._row}:${colLetter(headers.length)}${row._row}`,
      values: [toRow(headers, patch, row._raw)],
    };
  });
  if (!data.length) return null;
  return request('/values:batchUpdate', { method: 'POST', body: { valueInputOption: 'RAW', data } });
}

export async function updateRowById(tab, idField, id, patch) {
  return updateRowsById(tab, idField, [{ id, patch }]);
}

let sheetIds = null;

async function sheetIdOf(tab) {
  if (!sheetIds || !(tab in sheetIds)) {
    const meta = await request('', { query: { fields: 'sheets.properties(sheetId,title)' } });
    sheetIds = Object.fromEntries(meta.sheets.map(s => [s.properties.title, s.properties.sheetId]));
  }
  if (!(tab in sheetIds)) throw new SheetsError(404, `The ${tab} tab is missing from the spreadsheet.`);
  return sheetIds[tab];
}

/**
 * Delete rows by ID across one or more tabs in a single, all-or-nothing request.
 * `specs` is [{ tab, idField, ids }].
 */
export async function deleteRowsById(specs) {
  const tables = await readTables(specs.map(s => s.tab));
  const requests = [];
  for (const { tab, idField, ids } of specs) {
    const want = new Set(ids.map(String));
    const sheetId = await sheetIdOf(tab);
    // Bottom-up, so earlier deletions don't shift the rows still to delete.
    tables[tab].rows
      .filter(r => want.has(String(r[idField])))
      .map(r => r._row - 1)
      .sort((a, b) => b - a)
      .forEach(i => requests.push({ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: i, endIndex: i + 1 } } }));
  }
  if (!requests.length) return null;
  return request(':batchUpdate', { method: 'POST', body: { requests } });
}
