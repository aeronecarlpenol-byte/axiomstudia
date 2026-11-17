const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const seed = {
  version: 16,
  userProfile: { name: 'Test Student', section: 'A', major: 'Science', theme: 'dark' },
  subjects: [{ id: 'math', name: 'Mathematics', code: 'MATH', color: '#38bdf8' }],
  tasks: [], topics: [], focusSessions: [], exams: [], examWeekSchedule: [], holidays: [],
  examWeeks: [], gradeDeadlines: [], academicEvents: [],
  resources: [
    { id: 'gizmo', subjectId: 'math', title: 'Gizmo', type: 'website', url: 'https://app.gizmo.ai/chat' },
    { id: 'notes', subjectId: 'math', title: 'Notes', type: 'website', url: 'https://example.com/notes' }
  ]
};

(async () => {
  const browser = await chromium.launch({ executablePath: edge, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.stack || error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'axiom.test') return route.abort();
    const filename = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
    if (!filename.startsWith(root + path.sep) || !fs.existsSync(filename)) return route.fulfill({ status: 404, body: '' });
    const contentType = filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : filename.endsWith('.html') ? 'text/html' : 'application/octet-stream';
    return route.fulfill({ status: 200, contentType, body: fs.readFileSync(filename) });
  });
  await page.addInitScript(data => {
    if (location.hostname !== 'axiom.test') return;
    localStorage.setItem('axiom_studia_database_v16', JSON.stringify(data));
    localStorage.setItem('axiom_studia_fresh_start_v1', 'done');
    Object.defineProperty(window, 'documentPictureInPicture', { configurable: true, value: {
      requestWindow: async () => {
        const events = new EventTarget();
        const pip = {
          document: document.implementation.createHTMLDocument('Axiom Timer'),
          closed: false,
          focus() {},
          addEventListener: (...args) => events.addEventListener(...args),
          close() { this.closed = true; events.dispatchEvent(new Event('pagehide')); }
        };
        window.__testPip = pip;
        return pip;
      }
    } });
  }, seed);
  try {
    await page.goto('http://axiom.test/#subjects');
    await page.locator('#ws-btn-float-timer').waitFor();
    await page.locator('.ws-resource-card[data-resource-id="gizmo"]').click();
    await page.locator('#ws-btn-float-timer').click();
    await page.locator('#ws-floating-indicator').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#ws-panel-timer').evaluate(element => element.classList.contains('is-floating')), true);
    assert.equal(await page.locator('#ws-subject-dropdown').isDisabled(), true);
    assert.equal(await page.evaluate(() => window.__testPip.document.body.textContent.includes('Mathematics')), true);
    assert.equal(await page.evaluate(() => window.__testPip.document.body.textContent.includes('Resources')), false);
    assert.equal(await page.evaluate(() => window._axiomTimer.timer.state), 'idle');
    await page.evaluate(() => window.__testPip.document.querySelector('#floating-pause').click());
    assert.equal(await page.evaluate(() => window._axiomTimer.timer.state), 'running');
    await page.waitForTimeout(1100);
    await page.evaluate(() => window.__testPip.document.querySelector('#floating-pause').click());
    const paused = await page.evaluate(() => window._axiomTimer.timer.getElapsedSeconds());
    assert.equal(await page.evaluate(() => window._axiomTimer.timer.state), 'paused');
    await page.evaluate(() => window.__testPip.close());
    await page.locator('#ws-floating-indicator').waitFor({ state: 'hidden' });
    await page.locator('#ws-btn-float-timer').click();
    await page.locator('#ws-floating-indicator').waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => window._axiomTimer.timer.state), 'paused');
    const afterPause = await page.evaluate(() => window._axiomTimer.timer.getElapsedSeconds());
    assert.ok(Math.abs(afterPause - paused) < 0.05);
    await page.evaluate(() => window.__testPip.document.querySelector('#floating-pause').click());
    await page.waitForTimeout(550);
    await page.locator('.ws-resource-card[data-resource-id="notes"]').click({ force: true });
    assert.equal(await page.locator('.ws-resource-card.is-active').getAttribute('data-resource-id'), 'gizmo');
    await page.evaluate(() => window.__testPip.document.querySelector('#floating-end').click());
    await page.locator('#ws-floating-indicator').waitFor({ state: 'hidden' });
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('axiom_studia_database_v16')).focusSessions);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].subjectId, 'math');
    assert.ok(saved[0].durationSeconds > 1.4 && saved[0].durationSeconds < 2.5);
    assert.equal(await page.evaluate(() => window._axiomTimer.timer.state), 'idle');
    await page.locator('.ws-resource-card[data-resource-id="notes"]').click();
    assert.equal(await page.locator('.ws-resource-card.is-active').getAttribute('data-resource-id'), 'notes');
    await page.locator('#ws-btn-float-timer').click();
    await page.locator('#ws-floating-indicator').waitFor({ state: 'visible' });
    await page.evaluate(() => window.__testPip.document.querySelector('#floating-pause').click());
    await page.evaluate(() => window.__testPip.close());
    await page.locator('#ws-floating-indicator').waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => window._axiomTimer.timer.state), 'running');
    const started = await page.evaluate(() => window._axiomTimer.timer.startTime);
    await page.locator('#ws-btn-float-timer').click();
    await page.locator('#ws-floating-indicator').waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => window._axiomTimer.timer.state), 'running');
    assert.equal(await page.evaluate(() => window._axiomTimer.timer.startTime), started);
    await page.evaluate(() => window.__testPip.close());
    await page.locator('#ws-floating-indicator').waitFor({ state: 'hidden' });
    assert.equal((await page.evaluate(() => JSON.parse(localStorage.getItem('axiom_studia_database_v16')).focusSessions)).length, 1);
    await page.evaluate(() => window._axiomTimer.timer.reset());
    await page.locator('#ws-btn-float-timer').click();
    await page.locator('#ws-floating-indicator').waitFor({ state: 'visible' });
    await page.evaluate(() => {
      window._axiomTimer.timer.setDurationSeconds(1);
      window.__testPip.document.querySelector('#floating-pause').click();
    });
    await page.locator('#ws-floating-indicator').waitFor({ state: 'hidden', timeout: 5000 });
    assert.equal((await page.evaluate(() => JSON.parse(localStorage.getItem('axiom_studia_database_v16')).focusSessions)).length, 2);
    assert.equal(await page.evaluate(() => window._axiomTimer.timer.state), 'idle');
    assert.deepEqual(errors, []);
    console.log('Floating timer controls, source lock, paused time, one-time session save, automatic completion, and close recovery passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
