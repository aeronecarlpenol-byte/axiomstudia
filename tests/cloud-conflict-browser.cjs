const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'axiom.test') return route.abort();
      if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: `<main></main><script type="module">
        import { cloudSync, mountCloudStatus } from '/js/cloudSync.js';
        import { db } from '/js/db.js';
        const remote = { revision: 2, payload: { ...db.data, userProfile: { ...db.data.userProfile, name: 'Cloud name' } } };
        db.data.userProfile.name = 'Local name';
        cloudSync.meta = { uid: 'visitor', revision: 1, pending: true };
        cloudSync.conflict = { base: null, remote };
        cloudSync.clientFactory = async () => ({ visitor: {
          auth: { getSession: async () => ({ data: { session: { user: { id: 'visitor', is_anonymous: true } } } }) },
          from: () => ({ select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: remote }) }),
          rpc: async () => ({})
        } });
        mountCloudStatus(document.querySelector('main'));
        cloudSync.setStatus('conflict', 'Changes were saved in two places.');
      </script>` });
      const file = path.resolve(root, '.' + url.pathname);
      if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404 });
      return route.fulfill({ contentType: file.endsWith('.js') ? 'text/javascript' : 'text/css', body: fs.readFileSync(file) });
    });
    await page.goto('https://axiom.test/');
    await page.getByRole('button', { name: 'Review changes' }).click();
    await page.getByRole('button', { name: 'Use cloud edits' }).click();
    await page.getByRole('status').getByText('Saved to cloud').waitFor();
    const saved = await page.evaluate(() => ({
      name: JSON.parse(localStorage.getItem('axiom_studia_database_v16')).userProfile.name,
      recovery: Object.keys(localStorage).filter(key => key.startsWith('axiom-cloud-recovery-')).map(key => JSON.parse(localStorage.getItem(key)))
    }));
    assert.equal(saved.name, 'Cloud name');
    assert.equal(saved.recovery[0].local.userProfile.name, 'Local name');
    assert.equal(saved.recovery[0].remote.payload.userProfile.name, 'Cloud name');
    assert.deepEqual(errors, []);
    console.log('Conflict review resolves to Saved and preserves both original versions.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
