// Google Identity Services token client. Holds the access token in memory,
// mirrored to sessionStorage so a page reload in the same tab stays signed in.

import { CONFIG, clientId } from './config.js';

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const TOKEN_KEY = 'carisma.token';
const HINT_KEY = 'carisma.loginHint';

let tokenClient = null;
let token = null;
let expiresAt = 0;
let pending = null;
let expiryTimer = null;
const expiredListeners = new Set();

export class AuthError extends Error {}

function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load Google sign-in. Check your connection.'));
    document.head.append(s);
  });
}

export async function init() {
  await loadGis();
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: clientId(),
    scope: CONFIG.SCOPES,
    callback: onToken,
    error_callback: onError,
  });
  restore();
}

function restore() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(TOKEN_KEY) || 'null');
    if (saved && saved.expiresAt > Date.now()) setToken(saved.token, saved.expiresAt);
  } catch { /* storage unavailable */ }
}

function setToken(t, exp) {
  token = t;
  expiresAt = exp;
  try { sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ token, expiresAt })); } catch { /* ignore */ }
  clearTimeout(expiryTimer);
  expiryTimer = setTimeout(markExpired, Math.max(0, expiresAt - Date.now()));
}

function onToken(resp) {
  const p = pending;
  pending = null;
  if (!p) return;
  if (resp.error) return p.reject(new AuthError(resp.error_description || resp.error));
  if (!google.accounts.oauth2.hasGrantedAllScopes(resp, CONFIG.SHEETS_SCOPE)) {
    return p.reject(new AuthError('Spreadsheet access was not granted. Please sign in again and allow access.'));
  }
  // Treat the token as expired a minute early so requests never race the real expiry.
  setToken(resp.access_token, Date.now() + (Number(resp.expires_in) - 60) * 1000);
  p.resolve(token);
}

function onError(err) {
  const p = pending;
  pending = null;
  if (!p) return;
  const msg = err?.type === 'popup_failed_to_open'
    ? 'The sign-in popup was blocked. Allow popups for this site and try again.'
    : err?.type === 'popup_closed' ? 'Sign-in was cancelled.' : (err?.message || 'Sign-in failed.');
  p.reject(new AuthError(msg));
}

/** Opens the Google popup. Must be called from a user gesture (click). */
export function signIn() {
  if (!tokenClient) return Promise.reject(new AuthError('Sign-in is not ready yet.'));
  let hint = '';
  try { hint = localStorage.getItem(HINT_KEY) || ''; } catch { /* ignore */ }
  return new Promise((resolve, reject) => {
    pending = { resolve, reject };
    tokenClient.requestAccessToken(hint ? { prompt: '', login_hint: hint } : { prompt: 'select_account' });
  });
}

export function getToken() {
  return token && Date.now() < expiresAt ? token : null;
}

export function markExpired() {
  if (!token) return;
  token = null;
  expiresAt = 0;
  try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
  expiredListeners.forEach(fn => fn());
}

export function onExpired(fn) {
  expiredListeners.add(fn);
}

export async function fetchUser() {
  const t = getToken();
  if (!t) throw new AuthError('Not signed in.');
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${t}` },
  });
  if (res.status === 401) { markExpired(); throw new AuthError('Session expired.'); }
  if (!res.ok) throw new Error(`Could not read your Google profile (${res.status}).`);
  return res.json();
}

export function rememberHint(email) {
  try { localStorage.setItem(HINT_KEY, email); } catch { /* ignore */ }
}

/** Forget the token locally. `revoke` also withdraws the app's grant. */
export function signOut({ revoke = false } = {}) {
  const t = token;
  token = null;
  expiresAt = 0;
  clearTimeout(expiryTimer);
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    if (revoke) localStorage.removeItem(HINT_KEY);
  } catch { /* ignore */ }
  if (revoke && t) google.accounts.oauth2.revoke(t, () => {});
}
