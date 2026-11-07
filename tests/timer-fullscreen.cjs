const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    for (const width of [1365, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 844 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.hostname !== 'axiom.test') return route.abort();
        const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404 });
        return route.fulfill({ contentType: { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' }[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
      });
      await page.addInitScript(() => {
        const key = 'axiom_studia_database_v16';
        if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({
          userProfile: { name: 'Student', section: 'A', major: 'Engineering', semester: '1st Semester', schoolYear: '2026–2027' },
          subjects: [{ id: 'math', code: 'MATH', name: 'Mathematics' }], tasks: [], resources: [], focusSessions: []
        }));
      });
      await page.goto('http://axiom.test/#subjects');
      const button = page.locator('#ws-btn-toggle-fullscreen');
      if (width < 900) await page.locator('[data-tab="timer"]').click();
      await button.click();
      assert.equal(await page.locator('.ws-focus-fullscreen').count(), 1);
      assert.equal(await button.getAttribute('aria-pressed'), 'true');
      const panel = await page.locator('#ws-panel-timer').boundingBox();
      const exit = await button.boundingBox();
      assert(panel && panel.width >= width - 1 && panel.height >= 843);
      assert(exit && exit.x >= 0 && exit.x + exit.width <= width && exit.y >= 0);
      await button.click();
      assert.equal(await page.locator('.ws-focus-fullscreen').count(), 0);
      await button.click();
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.ws-focus-fullscreen').count(), 0);
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('Timer fullscreen enter, exit, Escape, and responsive layout passed.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
