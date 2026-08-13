// Shared config + auth helpers used by every page.
// Config (Client ID / Spreadsheet ID) and the access token are kept in
// localStorage so you only enter them once per browser, and pages share
// the same signed-in session instead of re-authenticating each time.

const CARISMA_KEYS = {
  clientId: 'carisma_clientId',
  spreadsheetId: 'carisma_spreadsheetId',
  token: 'carisma_accessToken',
  tokenExpiry: 'carisma_tokenExpiry'
};

function getStoredConfig() {
  return {
    clientId: localStorage.getItem(CARISMA_KEYS.clientId) || '',
    spreadsheetId: localStorage.getItem(CARISMA_KEYS.spreadsheetId) || ''
  };
}

function saveStoredConfig(clientId, spreadsheetId) {
  localStorage.setItem(CARISMA_KEYS.clientId, clientId.trim());
  localStorage.setItem(CARISMA_KEYS.spreadsheetId, spreadsheetId.trim());
}

function getStoredToken() {
  const token = localStorage.getItem(CARISMA_KEYS.token);
  const expiry = parseInt(localStorage.getItem(CARISMA_KEYS.tokenExpiry) || '0', 10);
  if (token && Date.now() < expiry) return token;
  return null;
}

function storeToken(token, expiresInSeconds) {
  const safeExpiry = Date.now() + ((expiresInSeconds || 3600) * 1000) - 60000; // 1 min safety buffer
  localStorage.setItem(CARISMA_KEYS.token, token);
  localStorage.setItem(CARISMA_KEYS.tokenExpiry, String(safeExpiry));
}

function clearToken() {
  localStorage.removeItem(CARISMA_KEYS.token);
  localStorage.removeItem(CARISMA_KEYS.tokenExpiry);
}

// Sets up a Google Identity Services token client.
// onToken(token) fires on every successful sign-in (including silent refresh).
function initGoogleAuth({ clientId, onToken, onError }) {
  return google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    callback: (resp) => {
      if (resp.error) { onError && onError(resp.error); return; }
      storeToken(resp.access_token, resp.expires_in);
      onToken && onToken(resp.access_token);
    }
  });
}

// Call this on every page load. If a valid cached token exists, it's used
// immediately (no re-sign-in needed within the ~1hr window). Otherwise the
// caller is left in a "signed out" state and should show the sign-in button.
function tryResumeSession() {
  return getStoredToken();
}
