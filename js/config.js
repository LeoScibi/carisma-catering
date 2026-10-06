// App-wide configuration and the spreadsheet data model.

export const CONFIG = {
  // Fill these in so everyone just presses "Sign in". While either is blank the app asks for
  // it on first run and remembers the answer in that browser only.
  CLIENT_ID: '',
  SPREADSHEET_ID: '',
  // Sheets access, plus openid/email to show who is signed in. Anyone the spreadsheet is
  // shared with can use the app; sharing is the access control.
  SHEETS_SCOPE: 'https://www.googleapis.com/auth/spreadsheets',
  SCOPES: 'https://www.googleapis.com/auth/spreadsheets openid email profile',
};

// Browser-remembered settings. The carisma_* keys are the ones the old multi-page app used, so
// a browser that ran it already knows the client ID and where the old spreadsheet is.
const LOCAL = { clientId: 'carisma_clientId', spreadsheetId: 'carisma.spreadsheetId', legacySheet: 'carisma_spreadsheetId' };
const recall = key => { try { return localStorage.getItem(key) || ''; } catch { return ''; } };
const remember = (key, value) => { try { localStorage.setItem(key, value); } catch { /* storage unavailable */ } };

/** Accepts a bare spreadsheet ID or a full docs.google.com URL. */
export const sheetIdFrom = text => (/\/d\/([\w-]+)/.exec(String(text)) || [, String(text).trim()])[1];

export const clientId = () => CONFIG.CLIENT_ID || recall(LOCAL.clientId);
export const spreadsheetId = () => CONFIG.SPREADSHEET_ID || recall(LOCAL.spreadsheetId);
/** The old Carisma Ops spreadsheet, if this browser used it: the default source for the one-off import. */
export const legacySpreadsheetId = () => recall(LOCAL.legacySheet);
export const rememberClientId = id => remember(LOCAL.clientId, id.trim());
export const rememberSpreadsheetId = id => remember(LOCAL.spreadsheetId, sheetIdFrom(id));

// One tab per entity. Row 1 = headers. Records link by ID, never by name.
// `numbers` / `booleans` drive type coercion on read and write; everything else is text.
export const SCHEMA = {
  SUPPLIERS: {
    idField: 'SUPPLIER_ID',
    idPrefix: 'SUP',
    headers: ['SUPPLIER_ID', 'NAME', 'CONTACT', 'EMAIL', 'PHONE', 'ORDER_DAYS', 'LEAD_TIME', 'MIN_ORDER', 'NOTES'],
    numbers: ['LEAD_TIME', 'MIN_ORDER'],
  },
  // An ingredient is generic: what it is and how it's measured (UNIT: g / ml / each).
  // Prices live in SUPPLIER_PRICES. SUPPLIER_ID here is the *preferred* supplier; blank means
  // recipes use the cheapest price. Sheets created before price lists still carry old
  // SUPPLIER_CODE / PACK_* columns on this tab; the app no longer reads them after migrating.
  INGREDIENTS: {
    idField: 'ING_ID',
    idPrefix: 'ING',
    headers: ['ING_ID', 'NAME', 'CATEGORY', 'UNIT', 'SUPPLIER_ID', 'YIELD_%', 'ALLERGENS', 'DIETARY', 'STORAGE',
      'SHELF_LIFE', 'ACTIVE'],
    numbers: ['YIELD_%'],
    booleans: ['ACTIVE'],
  },
  // A supplier's price list: one row per supplier + ingredient + pack. PACK_UNIT is stored as
  // g / ml / each; UPDATED is the date the price was last set.
  SUPPLIER_PRICES: {
    idField: 'PRICE_ID',
    idPrefix: 'SP',
    headers: ['PRICE_ID', 'SUPPLIER_ID', 'ING_ID', 'SUPPLIER_CODE', 'PRODUCT_NAME', 'PACK_SIZE', 'PACK_UNIT',
      'PACK_PRICE', 'UPDATED'],
    numbers: ['PACK_SIZE', 'PACK_PRICE'],
  },
  PRICE_HISTORY: {
    headers: ['DATE', 'ING_ID', 'PACK_PRICE', 'INVOICE_REF', 'SUPPLIER_ID', 'PRICE_ID'],
    numbers: ['PACK_PRICE'],
  },
  RECIPES: {
    idField: 'RECIPE_ID',
    idPrefix: 'REC',
    headers: ['RECIPE_ID', 'NAME', 'TYPE', 'YIELD_QTY', 'YIELD_UNIT', 'PORTIONS', 'SELL_PRICE',
      'VAT_RATE', 'TARGET_GP%', 'METHOD'],
    numbers: ['YIELD_QTY', 'PORTIONS', 'SELL_PRICE', 'VAT_RATE', 'TARGET_GP%'],
  },
  // LINE_ID and SORT let a single line be edited, reordered or removed in place.
  RECIPE_LINES: {
    idField: 'LINE_ID',
    idPrefix: 'RL',
    headers: ['RECIPE_ID', 'ITEM_TYPE', 'ITEM_ID', 'QTY', 'UNIT', 'LINE_ID', 'SORT'],
    numbers: ['QTY', 'SORT'],
  },
  // A menu is a named list of recipes and how much of each an event needs. UNIT is `portion`
  // or a weight / volume unit of the recipe's batch yield. The shopping list is derived.
  MENUS: {
    idField: 'MENU_ID',
    idPrefix: 'MENU',
    headers: ['MENU_ID', 'NAME', 'NOTES'],
  },
  MENU_LINES: {
    idField: 'LINE_ID',
    idPrefix: 'ML',
    headers: ['LINE_ID', 'MENU_ID', 'RECIPE_ID', 'QTY', 'UNIT'],
    numbers: ['QTY'],
  },
};

export const RECIPE_TYPES = [['dish', 'Dish'], ['drink', 'Drink'], ['sub', 'Sub-recipe']];

// Used when a recipe leaves these blank.
export const RECIPE_DEFAULTS = { VAT_RATE: 20, TARGET_GP: 70 };

// UK FIR 14 major allergens.
export const ALLERGENS = ['Celery', 'Gluten', 'Crustaceans', 'Eggs', 'Fish', 'Lupin', 'Milk',
  'Molluscs', 'Mustard', 'Tree nuts', 'Peanuts', 'Sesame', 'Soya', 'Sulphites'];

export const DIETARY = ['Vegan', 'Vegetarian', 'Gluten-free'];

export const ORDER_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const CATEGORY_SUGGESTIONS = ['Meat', 'Fish', 'Dairy', 'Cheese', 'Charcuterie', 'Veg', 'Fruit',
  'Herbs & spices', 'Dry goods', 'Oils & vinegars', 'Bakery', 'Wine', 'Spirits', 'Beer', 'Soft drinks',
  'Packaging'];

export const STORAGE_SUGGESTIONS = ['Ambient', 'Chilled', 'Frozen', 'Cellar'];
