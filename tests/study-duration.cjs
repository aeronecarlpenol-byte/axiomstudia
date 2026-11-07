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
    const input = page.locator('#ws-duration-minutes');
    const hours = page.locator('#ws-duration-hours');
    const seconds = page.locator('#ws-duration-seconds');
    const commit = async value => { await input.fill(value); await input.press('Enter'); };
    await input.waitFor();
    assert.equal(await page.locator('#ws-panel-timer .preset-chip').count(), 0);
    for (const value of ['', '-4', '1.5', 'abc', '1e2', '60', '999999999999999999']) {
      await commit(value);
      assert.equal(await input.getAttribute('aria-invalid'), 'true');
      assert.equal(await page.locator('#ws-duration-error').isVisible(), true);
      await page.locator('#ws-btn-start-pause').click();
      assert.match(await page.locator('#ws-btn-start-pause').innerText(), /START/);
    }
    await commit('0');
    assert.equal(await page.locator('#ws-duration-error').isVisible(), true);
    await hours.fill('100');
    await hours.press('Enter');
    assert.equal(await hours.getAttribute('aria-invalid'), 'true');
    await hours.fill('0');
    await seconds.fill('60');
    await seconds.press('Enter');
    assert.equal(await seconds.getAttribute('aria-invalid'), 'true');
    await seconds.fill('31');
    await seconds.press('Enter');
    assert.equal(await page.locator('#ws-focus-timer-text').innerText(), '00:00:31');
    await page.reload();
    assert.equal(await seconds.inputValue(), '31');
    await seconds.fill('00');
    await commit('37');
    assert.equal(await page.locator('#ws-focus-timer-text').innerText(), '00:37:00');
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
    assert.equal(await page.locator('#ws-focus-timer-text').innerText(), '00:12:00');
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
    assert.equal(await page.locator('#ws-focus-timer-text').innerText(), '00:09:00');
    await page.locator('#ws-btn-start-pause').click();
    await page.evaluate(async () => {
      const { timer } = await import('/js/timer.js');
      timer.addFiveMinutes();
      timer.reset();
    });
    assert.equal(await page.locator('#ws-focus-timer-text').innerText(), '00:09:00');
    await hours.fill('99');
    await input.fill('59');
    await seconds.fill('59');
    await seconds.press('Enter');
    assert.equal(await page.locator('#ws-focus-timer-text').innerText(), '99:59:59');
    await hours.fill('00');
    await seconds.fill('00');
    await commit('9');
    await seconds.press('ArrowUp');
    await page.waitForTimeout(300);
    assert.equal(await seconds.inputValue(), '01');
    await seconds.hover();
    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(300);
    assert.equal(await seconds.inputValue(), '02');
    await page.locator('[data-duration-column]').nth(2).locator('.ws-duration-scroll').evaluate(el => { el.scrollTop = 5 * 36; });
    await page.waitForTimeout(500);
    assert.equal(await seconds.inputValue(), '05');
    await seconds.fill('00');
    await seconds.press('Enter');
    for (const width of [1365, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await input.isVisible(), true);
      assert.ok(await page.locator('#ws-panel-timer').evaluate(el => el.scrollWidth <= el.clientWidth));
    }
    await page.locator('#ws-panel-timer').screenshot({path:'tmp/duration-picker-mobile.png'});
    const client = await page.context().newCDPSession(page);
    const box = await seconds.boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await client.send('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:[{x,y}]});
    await client.send('Input.dispatchTouchEvent', {type:'touchMove',touchPoints:[{x,y:y-72}]});
    await client.send('Input.dispatchTouchEvent', {type:'touchEnd',touchPoints:[]});
    await page.waitForTimeout(300);
    assert.equal(await seconds.inputValue(), '02');
    await seconds.fill('00');
    await seconds.press('Enter');
    await page.evaluate(() => { location.hash = '#settings'; });
    await page.locator('#profile-form').waitFor();
    await page.evaluate(() => { location.hash = '#subjects'; });
    await input.waitFor();
    assert.equal(await input.inputValue(), '09');
    await page.reload();
    assert.equal(await input.inputValue(), '09');
    assert.deepEqual(errors, []);
    console.log('Study duration passed: validation, persistence, navigation, pause/resume, restart acceptance/cancellation, accumulated study time, completion modal, reset after extension, desktop/mobile layout.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
