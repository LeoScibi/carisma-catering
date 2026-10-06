import { SCHEMA, legacySpreadsheetId, clientId, spreadsheetId, rememberClientId, rememberSpreadsheetId, sheetIdFrom } from './config.js';
import * as auth from './auth.js';
import * as sheets from './sheets.js';
import * as store from './store.js';
import { toast, setReconnectHandler } from './ui.js';
import { openLegacyImport, canImport, legacyTabsIn, hasKeptTabs, setAsideLegacyTabs, importKeptTabs } from './legacy-import.js';
import * as ingredients from './views/ingredients.js';
import * as suppliers from './views/suppliers.js';
import * as recipes from './views/recipes.js';
import * as menus from './views/menus.js';

const ROUTES = { ingredients, suppliers, recipes, menus };
const DEFAULT_ROUTE = 'ingredients';

const $ = sel => document.querySelector(sel);
const screens = ['#loading', '#signin', '#setup', '#fatal', '#app'];

function show(id, message) {
  screens.forEach(s => { $(s).hidden = s !== id; });
  if (id === '#loading' && message) $('#loading-msg').textContent = message;
}

function showSignin(message = '') {
  const el = $('#signin-msg');
  el.textContent = message;
  el.hidden = !message;
  $('#signin-btn').disabled = false;
  show('#signin');
}

/** First-run setup: `step` is 'client' (OAuth client ID), 'sheet' (which spreadsheet) or 'convert' (old layout). */
function showSetup(step, message = '') {
  const el = $('#setup-msg');
  el.textContent = message;
  el.hidden = !message;
  $('#setup-client').hidden = step !== 'client';
  $('#setup-sheet').hidden = step !== 'sheet';
  $('#setup-convert').hidden = step !== 'convert';
  $('#setup-create').disabled = false;
  $('#setup-convert-btn').disabled = false;
  show('#setup');
}

function showFatal(message) {
  $('#fatal-msg').textContent = message;
  show('#fatal');
}

let currentRoute = null;

// Hash routes look like #/recipes or #/recipes/REC-0001 (the second part opens a record).
function route() {
  const [name = DEFAULT_ROUTE, param] = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  const view = ROUTES[name || DEFAULT_ROUTE];
  if (!view) { location.hash = `#/${DEFAULT_ROUTE}`; return; }
  // Leaving a section closes anything it had open.
  if (currentRoute && currentRoute !== name) document.querySelectorAll('dialog[open]').forEach(d => d.close());
  currentRoute = name || DEFAULT_ROUTE;
  document.querySelectorAll('.nav a[data-route]').forEach(a => {
    a.classList.toggle('active', a.dataset.route === currentRoute);
    if (a.dataset.route === currentRoute) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  view.render($('#view'), param);
}

async function start() {
  try {
    show('#loading', 'Checking your account…');
    const user = await auth.fetchUser();
    auth.rememberHint(user.email);
    $('#user-email').textContent = user.email;
    $('#user-initial').textContent = (user.given_name || user.email).trim().charAt(0);

    if (!spreadsheetId()) { showSetup('sheet'); return; }
    $('#sheet-link').href = `https://docs.google.com/spreadsheets/d/${spreadsheetId()}/edit`;

    show('#loading', 'Preparing the spreadsheet…');
    // A spreadsheet still in the old multi-page layout has to be converted before the new tabs fit.
    const titles = await sheets.tabTitles();
    if (legacyTabsIn(titles).length) { showSetup('convert'); return; }
    const { createdTabs, addedColumns } = await sheets.ensureSchema(SCHEMA);

    show('#loading', 'Loading data…');
    await store.loadAll();
    let imported = '';
    if (canImport() && hasKeptTabs(titles)) {
      show('#loading', 'Copying your data into the new layout…');
      imported = await importKeptTabs();
    }

    show('#app');
    $('#banner').hidden = true;
    route();
    if (imported) toast(imported);
    else if (createdTabs.length) toast(`Set up spreadsheet tabs: ${createdTabs.join(', ')}`);
    // A brand-new spreadsheet, in a browser that used the old app: offer to bring the data across.
    if (canImport() && legacySpreadsheetId() && legacySpreadsheetId() !== spreadsheetId()) openLegacyImport(route);
    const added = Object.entries(addedColumns);
    if (added.length) toast(`Added missing columns: ${added.map(([t, cols]) => `${t} (${cols.join(', ')})`).join('; ')}`);
  } catch (err) {
    console.error(err);
    if (err instanceof auth.AuthError) showSignin(err.message);
    else showFatal(err.message || String(err));
  }
}

async function handleSignIn() {
  $('#signin-btn').disabled = true;
  try {
    await auth.signIn();
    await start();
  } catch (err) {
    showSignin(err.message);
  }
}

async function handleReconnect() {
  const btn = $('#reconnect-btn');
  btn.disabled = true;
  try {
    await auth.signIn();
    $('#banner').hidden = true;
    toast('Reconnected. You can carry on where you left off.');
    return true;
  } catch (err) {
    toast(err.message, 'error');
    return false;
  } finally {
    btn.disabled = false;
  }
}

async function handleRefresh() {
  const btn = $('#refresh-btn');
  btn.disabled = true;
  btn.classList.add('spinning');
  try {
    await store.loadAll();
    route();
    toast('Data refreshed from the spreadsheet');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.classList.remove('spinning');
  }
}

async function handleCreateSheet() {
  $('#setup-create').disabled = true;
  try {
    show('#loading', 'Creating the spreadsheet…');
    rememberSpreadsheetId(await sheets.createSpreadsheet('Carisma Ops'));
    await start();
  } catch (err) {
    if (err instanceof auth.AuthError) showSignin(err.message);
    else showSetup('sheet', err.message || String(err));
  }
}

async function handleConvert() {
  $('#setup-convert-btn').disabled = true;
  try {
    show('#loading', 'Setting the old tabs aside…');
    await setAsideLegacyTabs();
    await start();
  } catch (err) {
    if (err instanceof auth.AuthError) showSignin(err.message);
    else showSetup('convert', err.message || String(err));
  }
}

async function handleUseSheet(e) {
  e.preventDefault();
  const id = sheetIdFrom(e.target.elements.sheet.value);
  if (!id) { showSetup('sheet', 'Paste the spreadsheet link or ID first.'); return; }
  try {
    show('#loading', 'Checking the spreadsheet…');
    await sheets.tabTitles(id);
    rememberSpreadsheetId(id);
    await start();
  } catch (err) {
    if (err instanceof auth.AuthError) showSignin(err.message);
    else showSetup('sheet', err.message || String(err));
  }
}

function handleSignOut() {
  $('.account').open = false;
  auth.signOut();
  document.querySelectorAll('dialog[open]').forEach(d => d.close());
  showSignin();
}

async function boot() {
  $('#setup-client').addEventListener('submit', e => {
    e.preventDefault();
    rememberClientId(e.target.elements.clientId.value);
    connect();
  });
  $('#setup-sheet').addEventListener('submit', handleUseSheet);
  $('#setup-create').addEventListener('click', handleCreateSheet);
  $('#setup-convert-btn').addEventListener('click', handleConvert);
  $('#import-btn').addEventListener('click', () => { $('.account').open = false; openLegacyImport(route); });
  $('#signin-btn').addEventListener('click', handleSignIn);
  $('#reconnect-btn').addEventListener('click', handleReconnect);
  setReconnectHandler(handleReconnect);
  $('#refresh-btn').addEventListener('click', handleRefresh);
  $('#signout-btn').addEventListener('click', handleSignOut);
  $('#retry-btn').addEventListener('click', start);
  window.addEventListener('hashchange', () => { if (!$('#app').hidden) route(); });
  // Close the account menu when tapping anywhere else.
  document.addEventListener('click', e => {
    const menu = $('.account');
    if (menu.open && !menu.contains(e.target)) menu.open = false;
  });

  // Tokens last an hour. When one expires mid-session, keep the page (and any open form) as-is
  // and ask for a one-click reconnect instead of throwing the user back to the sign-in screen.
  auth.onExpired(() => { if (!$('#app').hidden) $('#banner').hidden = false; });

  await connect();
}

/** Load Google sign-in once the client ID is known, then resume a session or ask to sign in. */
async function connect() {
  if (!clientId()) { showSetup('client'); return; }
  try {
    await auth.init();
  } catch (err) {
    showFatal(err.message);
    return;
  }
  if (auth.getToken()) await start();
  else showSignin();
}

boot();
