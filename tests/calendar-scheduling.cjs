const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const key = 'axiom_studia_database_v16';
const seed = {
  userProfile: { name: 'Test Student', section: 'A', major: 'Science' },
  subjects: [{ id: 'math', code: 'MATH', name: 'Mathematics', color: '#38bdf8' }],
  tasks: [
    { id: 'legacy', title: 'Legacy assignment', subjectId: 'math', deadline: '2026-11-20T15:00', status: 'not_started', priority: 'high' },
    { id: 'unscheduled', title: 'Practice problems', subjectId: 'math', status: 'not_started', priority: 'medium' },
    { id: 'done', title: 'Finished reading', subjectId: 'math', scheduledDate: '2026-11-20', status: 'completed', priority: 'low' }
  ],
  exams: [{ id: 'exam', title: 'Final exam', date: '2026-11-20', subjectId: 'math' }],
  resources: [], focusSessions: []
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1365, height: 950 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'axiom.test') return route.abort();
      const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
      if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404 });
      return route.fulfill({ contentType: { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' }[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
    });
    await page.addInitScript(({ key, seed }) => {
      if (location.hostname !== 'axiom.test') return;
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(seed));
    }, { key, seed });
    const saved = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
    await page.goto('http://axiom.test/#tasks');
    await page.locator('#btn-create-task').waitFor();
    assert.equal((await saved()).tasks.find(task => task.id === 'legacy').scheduledDate, '2026-11-20');
    await page.locator('#btn-create-task').click();
    assert.equal(await page.locator('#create-task-form [name="deadline"]').count(), 0);
    await page.locator('#create-task-form [name="title"]').fill('Review circuits');
    await page.locator('#create-task-form [name="subjectId"]').selectOption('math');
    await page.locator('#create-task-form [name="priority"]').selectOption('urgent');
    await page.locator('#save-task-btn').click();
    const created = (await saved()).tasks.find(task => task.title === 'Review circuits');
    assert.equal(created.scheduledDate, null);
    assert.equal(created.deadline, undefined);
    assert.equal(created.description, '');
    assert.equal(created.priority, 'urgent');
    await page.evaluate(() => { location.hash = '#calendar?date=2026-11-20'; });
    await page.locator('#calendar-add-existing').waitFor();
    assert.match(await page.locator('.calendar-selected-day').innerText(), /Legacy assignment/);
    assert.match(await page.locator('.calendar-selected-day').innerText(), /Finished reading/);
    assert.match(await page.locator('.calendar-selected-day').innerText(), /Final exam/);
    await page.locator('#calendar-add-existing').click();
    await page.locator('#calendar-existing-task').selectOption(created.id);
    await page.locator('#calendar-schedule-dialog button[type="submit"]').click();
    assert.equal((await saved()).tasks.find(task => task.id === created.id).scheduledDate, '2026-11-20');
    assert.equal(await page.evaluate(async id => (await import('/js/db.js')).db.getTaskDeadlineStatus((await import('/js/db.js')).db.getTaskById(id)), created.id), 'no_deadline');
    await page.locator(`.calendar-task-pill[data-task-id="${created.id}"]`).dragTo(page.locator('[data-date-key="2026-11-21"].calendar-day-cell'));
    await page.waitForFunction(({ key, id }) => JSON.parse(localStorage.getItem(key)).tasks.find(task => task.id === id)?.scheduledDate === '2026-11-21', { key, id: created.id });
    assert.equal((await saved()).tasks.find(task => task.id === created.id).scheduledDate, '2026-11-21');
    await page.locator(`.calendar-task-pill[data-task-id="${created.id}"]`).dragTo(page.locator('#calendar-unscheduled'));
    await page.waitForFunction(({ key, id }) => JSON.parse(localStorage.getItem(key)).tasks.find(task => task.id === id)?.scheduledDate === null, { key, id: created.id });
    assert.equal((await saved()).tasks.find(task => task.id === created.id).scheduledDate, null);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#calendar-selected-date').fill('2026-11-22');
    await page.locator('#calendar-selected-date').dispatchEvent('change');
    await page.locator('#calendar-new-task').click();
    await page.locator('#create-task-form [name="title"]').fill('Read chapter 4');
    await page.locator('#save-task-btn').click();
    assert.equal((await saved()).tasks.find(task => task.title === 'Read chapter 4')?.scheduledDate, '2026-11-22');
    await page.locator(`[data-schedule-task="${created.id}"]`).click();
    assert.equal((await saved()).tasks.find(task => task.id === created.id).scheduledDate, '2026-11-22');
    await page.locator(`.mobile-calendar-agenda-item[data-task-id="${created.id}"]`).click();
    await page.locator('#calendar-complete-task').click();
    assert.equal((await saved()).tasks.find(task => task.id === created.id).status, 'completed');
    await page.reload();
    await page.locator('#calendar-selected-date').waitFor();
    assert.equal((await saved()).tasks.find(task => task.id === created.id).scheduledDate, '2026-11-22');
    assert.deepEqual(errors, []);
    console.log('Calendar task creation, migration, drag scheduling, mobile scheduling, completion, events, and persistence passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
