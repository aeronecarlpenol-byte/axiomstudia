// Google Identity Services keeps the grant at Google. Access tokens stay in memory.
const scope = 'https://www.googleapis.com/auth/drive.metadata.readonly';
let accessToken = null;
let expiresAt = 0;
let clientPromise;

export function googleClientId() {
  return localStorage.getItem('axiom-google-client-id') || '';
}

export function saveGoogleClientId(value) {
  const clientId = value.trim();
  if (clientId && !/^[\w.-]+\.apps\.googleusercontent\.com$/.test(clientId)) {
    throw new Error('Enter a valid Google OAuth Web Client ID.');
  }
  if (clientId) localStorage.setItem('axiom-google-client-id', clientId);
  else localStorage.removeItem('axiom-google-client-id');
  accessToken = null;
  expiresAt = 0;
}

function loadGoogleIdentity() {
  if (!clientPromise) clientPromise = new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) { resolve(window.google.accounts.oauth2); return; }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => resolve(window.google.accounts.oauth2);
    script.onerror = () => { clientPromise = null; reject(new Error('Google sign-in could not load.')); };
    document.head.append(script);
  });
  return clientPromise;
}
export function prepareGoogleConnection() { return loadGoogleIdentity(); }

export function googleConnectionStatus() {
  return accessToken && Date.now() < expiresAt ? 'Connected' : googleClientId() ? 'Connect or reauthorize' : 'Setup required';
}

export async function connectGoogle() {
  if (!googleClientId()) throw new Error('Enter a Google OAuth Web Client ID first.');
  const oauth = await loadGoogleIdentity();
  return new Promise((resolve, reject) => {
    const client = oauth.initTokenClient({
      client_id: googleClientId(), scope,
      callback: response => {
        if (response.error || !response.access_token || !oauth.hasGrantedAllScopes(response, scope)) {
          reject(new Error(response.error || 'Google Drive access was not granted.'));
          return;
        }
        accessToken = response.access_token;
        expiresAt = Date.now() + Math.max(0, Number(response.expires_in) - 60) * 1000;
        resolve();
      }
    });
    client.requestAccessToken({ prompt: '' });
  });
}

export async function listGoogleDriveFiles() {
  if (googleConnectionStatus() !== 'Connected') throw new Error('Connect Google Drive to view your files.');
  const url = new URL('https://www.googleapis.com/drive/v3/files');
  url.searchParams.set('q', 'trashed = false');
  url.searchParams.set('fields', 'nextPageToken,files(id,name,mimeType,webViewLink,description)');
  url.searchParams.set('page_size', '100');
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (response.status === 401) { accessToken = null; expiresAt = 0; throw new Error('Google authorization expired. Reauthorize in Settings.'); }
  if (!response.ok) throw new Error('Google Drive could not load your files.');
  return (await response.json()).files || [];
}

export async function disconnectGoogle() {
  if (accessToken) {
    const oauth = await loadGoogleIdentity();
    await new Promise(resolve => oauth.revoke(accessToken, resolve));
  }
  accessToken = null;
  expiresAt = 0;
}
