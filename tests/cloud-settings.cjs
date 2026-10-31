const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const key = 'axiom_studia_database_v16';
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
  try {
    const context = await browser.newContext();
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'axiom.test') return route.abort();
      const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
      if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ contentType: { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png' }[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
    });
    let page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://axiom.test/#settings');
    await page.locator('#profile-form').waitFor();
    const text = await page.locator('#main-content').innerText();
    assert.doesNotMatch(text, /Data Operations & Portability|Export Backup|Import Backup|Reset to Defaults|Export a backup before switching/);
    assert.match(text, /Privacy/); assert.match(text, /Clearing browser data/);
    assert.equal(await page.locator('#btn-export-data, #file-import-input, #btn-reset-data').count(), 0);
    await page.locator('#display-name').fill('Anonymous visitor');
    await page.locator('#academic-semester').selectOption('1st Semester');
    await page.locator('#academic-school-year').fill('2026–2027');
    page.on('dialog', dialog => dialog.accept());
    await page.locator('#profile-form button').click();
    await page.reload();
    assert.equal(await page.locator('#display-name').inputValue(), 'Anonymous visitor');
    const before = await page.evaluate(key => localStorage.getItem(key), key);
    // Keyboard accessible equivalent of the five-click gesture.
    await page.locator('#settings-brand').focus();
    for (let i = 0; i < 4; i++) await page.keyboard.press('Enter');
    assert.equal(new URL(page.url()).hash, '#settings');
    await page.keyboard.press('Enter');
    await page.locator('#admin-login').waitFor();
    assert.equal(await page.locator('#admin-content').isVisible(), false);
    assert.equal(await page.locator('#admin-content').innerText(), '');
    await page.reload();
    await page.locator('#admin-login').waitFor();
    assert.equal(await page.locator('#admin-content').innerText(), '', 'Direct URL never exposes visitor data');
    assert.equal(await page.evaluate(key => localStorage.getItem(key), key), before, 'Opening admin never alters visitor workspace');
    await page.close();
    page = await context.newPage();
    await page.goto('http://axiom.test/#settings');
    assert.equal(await page.locator('#display-name').inputValue(), 'Anonymous visitor');
    assert.deepEqual(errors, []);
    console.log('Settings cleanup, privacy, profile persistence, keyboard gesture, direct admin URL, and visitor workspace preservation passed.');
    await context.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
