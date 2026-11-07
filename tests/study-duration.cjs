const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1365, height: 900 } });
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
    const input = page.locator('#ws-study-duration');
    const commit = async value => { await input.fill(value); await input.press('Enter'); };
    await input.waitFor();
    assert.equal(await page.locator('#ws-panel-timer .preset-chip').count(), 0);
    for (const value of ['', '0', '-4', '1.5', 'abc', '1e2', '999999999999999999']) {
      await commit(value);
      assert.equal(await input.getAttribute('aria-invalid'), 'true');
      assert.equal(await page.locator('#ws-duration-error').isVisible(), true);
      await page.locator('#ws-btn-start-pause').click();
      assert.match(await page.locator('#ws-btn-start-pause').innerText(), /START/);
    }
    await commit('37');
    assert.equal(await page.locator('#ws-focus-timer-text').innerText(), '37:00');
    await page.reload();
    assert.equal(await input.inputValue(), '37');
    await page.locator('#ws-btn-start-pause').click();
    await page.locator('#ws-btn-start-pause').click();
    await page.locator('#res-pause-btn').click();
    assert.match(await page.locator('#ws-btn-start-pause').innerText(), /RESUME/);
    page.once('dialog', dialog => dialog.dismiss());
    await commit('12');
    assert.equal(await input.inputValue(), '37');
    page.once('dialog', dialog => dialog.accept());
    await commit('12');
    assert.match(await page.locator('#ws-btn-start-pause').innerText(), /RESUME/);
    assert.equal(await page.locator('#ws-focus-timer-text').innerText(), '12:00');
    await page.locator('#ws-btn-start-pause').click();
    await page.evaluate(async () => {
      const { timer } = await import('/js/timer.js');
      timer._deadlineMs = Date.now() + (timer.totalSeconds - 120) * 1000;
    });
    page.once('dialog', dialog => dialog.dismiss());
    await commit('9');
    assert.equal(await input.inputValue(), '12');
    page.once('dialog', dialog => dialog.accept());
    await commit('9');
    assert.match(await page.locator('#ws-btn-start-pause').innerText(), /PAUSE/);
    // Finish the restarted countdown without waiting nine real minutes.
    await page.evaluate(async () => { (await import('/js/timer.js')).timer._deadlineMs = Date.now() - 1; });
    await page.locator('#session-log-dialog').waitFor();
    assert.match(await page.locator('#session-log-dialog').innerText(), /11 minutes/);
    await page.evaluate(() => { document.querySelector('#session-log-dialog').remove(); });
    await page.locator('#ws-btn-reset-timer').click();
    assert.equal(await page.locator('#ws-focus-timer-text').innerText(), '09:00');
    await page.locator('#ws-btn-start-pause').click();
    await page.evaluate(async () => {
      const { timer } = await import('/js/timer.js');
      timer.addFiveMinutes();
      timer.reset();
    });
    assert.equal(await page.locator('#ws-focus-timer-text').innerText(), '09:00');
    for (const width of [1365, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await input.isVisible(), true);
      assert.ok(await page.locator('#ws-panel-timer').evaluate(el => el.scrollWidth <= el.clientWidth));
    }
    await page.evaluate(() => { location.hash = '#settings'; });
    await page.locator('#profile-form').waitFor();
    await page.evaluate(() => { location.hash = '#subjects'; });
    await input.waitFor();
    assert.equal(await input.inputValue(), '9');
    await page.reload();
    assert.equal(await input.inputValue(), '9');
    assert.deepEqual(errors, []);
    console.log('Study duration passed: validation, persistence, navigation, pause/resume, restart acceptance/cancellation, accumulated study time, completion modal, reset after extension, desktop/mobile layout.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
