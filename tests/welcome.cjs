const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const key = 'axiom_studia_database_v16';
const seed = {
  userProfile: { name: 'Existing Student', major: 'BS Electronics Engineering', theme: 'dark', semester: '1st Semester', schoolYear: '2026–2027' },
  subjects: [{ id: 'saved-subject', name: 'Circuits', grades: { prelim: 8 } }],
  tasks: [{ id: 'saved-task', title: 'Study circuits', status: 'pending' }],
  resources: [{ id: 'saved-resource', type: 'notes', content: 'Keep these notes' }],
  pdfProgress: { notes: { page: 8 } }
};
const mockCloud = `
export const cloudConfigured = () => true;
export async function getCloudClients() {
  return { visitor: {
    auth: {
      getSession: async () => ({data: {session: {user: {id: 'existing-unique-user', is_anonymous: true}}}}),
      signInAnonymously: async () => { throw Error('Must reuse existing user'); }
    },
    from() { return {select() {return this}, eq(column, uid) { window.__uid = uid; return this; },
      async maybeSingle() { if (window.__offline) throw Error('Offline'); return {data: window.__remote || null}; }}; },
    async rpc(name, args) {
      if (window.__offline) throw Error('Offline');
      if (name === 'touch_visitor') return {};
      const revision = (window.__remote?.revision || 0) + 1;
      window.__remote = {payload: args.document, revision};
      return {data: revision};
    }
  }};
}`;

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
  try {
    const context = await browser.newContext();
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'axiom.test') return route.abort();
      if (url.pathname === '/js/cloudClient.js') return route.fulfill({contentType: 'text/javascript', body: mockCloud});
      const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
      if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.fulfill({status: 404});
      return route.fulfill({contentType: file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream', body: fs.readFileSync(file)});
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({seed, key}) => {
      if (!sessionStorage.getItem('welcome-test-seeded')) {
        localStorage.setItem(key, JSON.stringify(seed));
        sessionStorage.setItem('welcome-test-seeded', 'true');
      }
    }, {seed, key});
    await page.goto('https://axiom.test/#subjects');
    await page.locator('#welcome-form').waitFor();
    assert.equal(await page.inputValue('[name="name"]'), seed.userProfile.name);
    assert.equal(await page.inputValue('[name="major"]'), seed.userProfile.major);
    for (const hash of ['#settings', '#admin', '#focus', '#resources']) {
      await page.evaluate(hash => { location.hash = hash; }, hash);
      await page.waitForFunction(() => location.hash === '#welcome');
      assert.equal(await page.locator('#main-content').getAttribute('data-route'), 'welcome');
    }
    await page.fill('[name="section"]', '   ');
    await page.getByRole('button', {name: 'Start', exact: true}).click();
    assert.equal(await page.locator('[data-error="section"]').textContent(), 'Enter your section.');
    await page.fill('[name="section"]', ' ECE 2A ');
    await page.evaluate(() => { window.__offline = true; });
    await page.getByRole('button', {name: 'Start', exact: true}).click();
    await page.getByRole('button', {name: 'Retry', exact: true}).waitFor();
    assert.equal(await page.inputValue('[name="section"]'), ' ECE 2A ');
    await page.evaluate(() => { location.hash = '#grades'; });
    await page.waitForFunction(() => location.hash === '#welcome');
    assert.equal(await page.inputValue('[name="section"]'), ' ECE 2A ');
    await page.reload();
    await page.locator('#welcome-form').waitFor();
    assert.equal(await page.inputValue('[name="section"]'), 'ECE 2A');
    await page.getByRole('button', {name: 'Start', exact: true}).click();
    await page.waitForFunction(() => document.querySelector('#main-content').dataset.route === 'dashboard');
    const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
    for (const field of ['subjects', 'tasks', 'resources', 'pdfProgress']) assert.deepEqual(saved[field], seed[field]);
    assert.equal(saved.__axiomCloud.uid, 'existing-unique-user');
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#main-content').dataset.route === 'dashboard');
    await page.evaluate(() => { location.hash = '#settings'; });
    await page.locator('#profile-form').waitFor();
    await page.fill('[name="name"]', 'Updated Student');
    await page.fill('[name="section"]', 'ECE 2B');
    await page.fill('[name="major"]', 'BS ECE');
    await page.getByRole('button', {name: 'Save Profile Changes'}).click();
    await page.getByText('Academic profile updated.', {exact: true}).waitFor();
    assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).userProfile.section, key), 'ECE 2B');

    // Fresh users, all-field validation, durable-storage failure, and responsive layout.
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.locator('#welcome-form').waitFor();
    await page.fill('[name="name"]', ' ');
    await page.fill('[name="major"]', ' ');
    await page.getByRole('button', {name: 'Start', exact: true}).click();
    assert.equal(await page.locator('[aria-invalid="true"]').count(), 3);
    await page.fill('[name="name"]', '<b>Same name</b>');
    await page.fill('[name="section"]', 'ECE 1A');
    await page.fill('[name="major"]', 'BS ECE');
    await page.evaluate(() => {
      window.__originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) { if (key === 'axiom_studia_database_v16') throw Error('Storage full'); return window.__originalSetItem.call(this, key, value); };
    });
    await page.getByRole('button', {name: 'Start', exact: true}).click();
    await page.getByRole('button', {name: 'Retry', exact: true}).waitFor();
    assert.equal(await page.inputValue('[name="name"]'), '<b>Same name</b>');
    for (const width of [320, 390, 1365]) {
      await page.setViewportSize({width, height: 844});
      assert.equal(await page.locator('.sidebar').isVisible(), false);
      assert.equal(await page.locator('.mobile-utility-bar').isVisible(), false);
      assert.equal(await page.locator('.mobile-nav').isVisible(), false);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert(await page.evaluate(() => {
        const card = document.querySelector('.welcome-card').getBoundingClientRect();
        return card.x >= 0 && card.y >= 0 && card.right <= innerWidth;
      }), 'Welcome card must stay inside the viewport');
      await page.screenshot({path: path.join(root, `tests/welcome-${width}.png`)});
    }
    await page.evaluate(() => { Storage.prototype.setItem = window.__originalSetItem; });
    await page.getByRole('button', {name: 'Retry', exact: true}).click();
    await page.waitForFunction(() => document.querySelector('#main-content').dataset.route === 'dashboard');
    assert((await page.locator('.greeting-time').textContent()).includes('<b>Same name</b>'));
    assert.equal(await page.locator('.greeting-time b').count(), 0, 'Name must render as text');

    // Restore a complete remote profile before presenting any setup form.
    await page.evaluate(({key, seed}) => {
      localStorage.setItem(key, JSON.stringify({...seed, __axiomCloud: {uid: 'existing-unique-user', revision: 1, pending: false}}));
    }, {key, seed});
    await page.addInitScript(seed => {
      window.__remote = {revision: 2, payload: {...seed, userProfile: {...seed.userProfile, section: 'ECE 3A'}}};
    }, seed);
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#main-content').dataset.route === 'dashboard');
    assert.equal(await page.locator('#welcome-form').count(), 0);
    assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).userProfile.section, key), 'ECE 3A');
    assert.deepEqual(errors, []);
    console.log('Welcome: route guards, validation, partial profiles, cloud/local failures, retry/reload, UID reuse, data preservation, Settings, and responsive layouts passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
