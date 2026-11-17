const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: true
  });
  try {
    const page = await browser.newPage({ timezoneId: 'Asia/Manila', viewport: { width: 390, height: 844 } });
    await page.clock.setFixedTime(new Date('2026-11-17T04:00:00Z'));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'axiom.test') return route.abort();
      if (url.pathname === '/') {
        const head = fs.readFileSync(path.join(root, 'index.html'), 'utf8').split('<body>')[0];
        return route.fulfill({ contentType: 'text/html', body: head + `<body><main></main>
          <script type="module">
            import { renderAnalytics } from '/js/views/analyticsView.js';
            renderAnalytics(document.querySelector('main'));
          </script></body></html>` });
      }
      const file = path.resolve(root, '.' + url.pathname);
      if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404 });
      return route.fulfill({ path: file });
    });
    await page.addInitScript(() => {
      const key = 'axiom_studia_database_v16';
      if (localStorage.getItem(key)) return;
      const first = { id: 'first', startTime: '2024-10-14T16:30:00Z', subjectId: 'math', durationMinutes: 150 };
      localStorage.setItem(key, JSON.stringify({
        subjects: [{ id: 'math', name: 'Differential Equations', color: '#38bdf8' }, { id: 'circuits', name: 'Circuits 1', color: '#a78bfa' }],
        tasks: [],
        focusSessions: [first, { ...first, id: 'duplicate' }, {
          id: 'second', startTime: '2024-10-15T01:00:00Z', subjectId: 'circuits', durationMinutes: 100
        }, { id: 'today', startTime: '2026-11-17T02:00:00Z', subjectId: 'math', durationMinutes: 45 }]
      }));
    });
    const chart = page.locator('.focus-history-chart');
    const calendar = page.getByRole('button', { name: 'Choose a focus history date' });
    const date = key => page.locator(`[data-focus-date="${key}"]`);
    const pickHistory = async () => {
      await calendar.click();
      await page.getByRole('combobox', { name: 'Year' }).selectOption('2024');
      await page.getByRole('combobox', { name: 'Month' }).selectOption('9');
      assert.equal(await date('2024-10-15').locator('.focus-history-dot').count(), 1);
      assert.equal(await date('2024-10-14').locator('.focus-history-dot').count(), 0);
      await date('2024-10-15').click();
    };

    await page.goto('http://axiom.test/');
    const logsToggle = page.getByRole('button', { name: /Study Session Logs/ });
    const logTable = page.locator('.study-logs table');
    assert.equal(await logsToggle.getAttribute('aria-expanded'), 'true');
    assert.equal(await logTable.locator('tbody tr').count(), 4);
    await logsToggle.press('Enter');
    assert.equal(await logsToggle.getAttribute('aria-expanded'), 'false');
    assert.equal(await page.getByRole('table').count(), 0);
    await page.waitForFunction(() => document.querySelector('#study-logs-content').offsetHeight === 0);
    await chart.getByRole('img', { name: 'Focus time over the last seven days' }).waitFor();
    await calendar.click();
    assert.equal(await date('2026-11-17').getAttribute('aria-current'), 'date');
    assert.equal(await date('2026-11-18').isDisabled(), true);
    await calendar.click();
    await pickHistory();
    assert.match(await chart.innerText(), /October 15, 2024/);
    assert.match(await chart.innerText(), /4h 10m/);
    assert.match(await chart.innerText(), /Differential Equations\s+2h 30m \(60%\)/);
    assert.match(await chart.innerText(), /Circuits 1\s+1h 40m \(40%\)/);

    await page.evaluate(async () => {
      const { db } = await import('/js/db.js');
      const session = { startTime: '2024-10-15T02:30:00Z', subjectId: 'math', durationSeconds: 3000, durationMinutes: 50 };
      const saved = db.addFocusSession(session, { recordOnly: true });
      db.addFocusSession({ ...saved, whatLearned: 'Practice' });
      db.addFocusSession(session);
    });
    assert.match(await chart.innerText(), /Total Focus Time\s+5h/);
    await calendar.click();
    assert.equal(await date('2024-10-15').getAttribute('aria-pressed'), 'true');
    await date('2024-10-14').click();
    assert.match(await chart.innerText(), /No study sessions recorded on this day\./);
    await page.getByRole('button', { name: 'Back to Current 7 Days' }).click();
    await chart.getByRole('img').waitFor();
    await page.reload();
    assert.equal(await logsToggle.getAttribute('aria-expanded'), 'false');
    await logsToggle.click();
    assert.equal(await logsToggle.getAttribute('aria-expanded'), 'true');
    assert.equal(await logTable.locator('tbody tr').count(), 5);
    assert.match(await logTable.innerText(), /Learned: Practice/);
    await pickHistory();
    assert.match(await chart.innerText(), /Total Focus Time\s+5h/);
    assert.equal(await page.locator('.focus-history').evaluate(el => el.scrollWidth > el.clientWidth), false);
    console.log('Focus history passed: calendar modes, timezone, duplicates, live updates, reload, and mobile chart.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
