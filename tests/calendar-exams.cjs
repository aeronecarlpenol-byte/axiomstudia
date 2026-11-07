const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const key = 'axiom_studia_database_v16';
const exam = { id: 'saved-exam', title: 'Circuits final', subjectId: 'ee', date: '2027-02-18T09:30:00+08:00', notes: 'Bring calculator', reminders: [1440, 60], readiness: 72, topics: ['circuits'] };
const seed = {
  userProfile: { name: 'Student', section: 'A', major: 'Engineering' },
  subjects: [{ id: 'ee', code: 'EE124', name: 'Electrical Engineering' }],
  exams: [exam, { id: 'undated', title: 'Unscheduled exam', subjectId: 'missing', notes: 'Keep this' }],
  tasks: [{ id: 'task', title: 'Assignment', deadline: '2027-02-18', status: 'pending' }],
  examWeeks: [{ name: 'Finals', term: 'Second', startDate: '2027-02-17', endDate: '2027-02-20' }],
  examWeekSchedule: [{ day: 'Monday', subjectId: 'ee' }], holidays: [{ date: '2027-02-18', name: 'Holiday' }],
  resources: [], focusSessions: []
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1365, height: 950 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'axiom.test') return route.abort();
      const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
      if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404 });
      return route.fulfill({ contentType: { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' }[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
    });
    await page.addInitScript(({ seed, key }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(seed));
    }, { seed, key });
    const saved = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
    await page.goto('https://axiom.test/#exams?exam=saved-exam');
    await page.locator('#calendar-exams').waitFor();
    assert.match(page.url(), /#calendar\?exam=saved-exam&view=exams/);
    assert.equal(await page.locator('#main-content').getAttribute('data-route'), 'calendar');
    assert.equal(await page.locator('a[href="#exams"]').count(), 0);
    assert.equal(await page.locator('.sidebar a[href="#calendar"]').getAttribute('class'), 'nav-item active');
    assert.deepEqual((await saved()).exams, seed.exams, 'Opening Calendar must preserve exam records exactly');
    assert.match(await page.locator('.calendar-selected-day').innerText(), /Circuits final/);
    assert.match(await page.locator('.calendar-selected-day').innerText(), /Holiday/);
    assert.match(await page.locator('.calendar-selected-day').innerText(), /Finals/);
    await page.locator('#calendar-exam-search').fill('electrical');
    assert.equal(await page.locator('.calendar-exam-row').count(), 1);
    await page.locator('#calendar-exam-list [data-edit-exam="saved-exam"]').click();
    await page.locator('#exam-title').fill('Updated circuits final');
    await page.locator('#calendar-exam-form button[type="submit"]').click();
    assert.deepEqual((await saved()).exams.find(e => e.id === exam.id), { ...exam, title: 'Updated circuits final' });
    await page.reload();
    assert.match(await page.locator('#calendar-exam-list').innerText(), /Updated circuits final/);
    await page.locator('#calendar-add-exam').click();
    await page.locator('#exam-title').fill('   ');
    await page.locator('#calendar-exam-form button[type="submit"]').click();
    assert.equal(await page.locator('#exam-form-error').innerText(), 'Enter an exam title.');
    await page.locator('#exam-title').fill('Signals midterm');
    await page.locator('#exam-subject').selectOption('ee');
    await page.locator('#exam-date').fill('2027-06-15');
    await page.locator('#exam-time').fill('14:15');
    await page.locator('#exam-notes').fill('Chapters 1–3');
    await page.locator('#calendar-exam-form button[type="submit"]').click();
    let added = (await saved()).exams.find(e => e.title === 'Signals midterm');
    assert.equal(added.date, '2027-06-15T14:15');
    assert.match(await page.locator('.calendar-selected-day').innerText(), /Signals midterm/);
    await page.locator(`#calendar-exam-list [data-edit-exam="${added.id}"]`).click();
    await page.locator('#exam-date').fill('2027-07-21');
    await page.locator('#calendar-exam-form button[type="submit"]').click();
    assert.equal((await saved()).exams.find(e => e.id === added.id).date, '2027-07-21T14:15');
    await page.locator('#calendar-exam-search').fill('Unscheduled');
    await page.locator('#calendar-exam-list [data-edit-exam="undated"]').click();
    assert.equal(await page.locator('#exam-subject').inputValue(), 'missing');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.deepEqual((await saved()).exams.find(e => e.id === 'undated'), seed.exams[1]);
    await page.locator('#calendar-exam-search').fill('Signals');
    await page.locator(`#calendar-exam-list [data-edit-exam="${added.id}"]`).click();
    page.once('dialog', dialog => dialog.dismiss());
    await page.locator('#calendar-delete-exam').click();
    assert.equal((await saved()).exams.length, 3);
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#calendar-delete-exam').click();
    assert.equal((await saved()).exams.length, 2);
    for (const field of ['tasks', 'examWeeks', 'examWeekSchedule', 'holidays']) assert.deepEqual((await saved())[field], seed[field]);
    await page.locator('#calendar-exam-search').fill('circuits');
    await page.locator('#calendar-exam-list a').click();
    assert.match(await page.locator('.calendar-selected-day').innerText(), /Updated circuits final/);
    for (const width of [1365, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 950 });
      assert.equal(await page.locator(width <= 640 ? '.mobile-nav a[href="#calendar"]' : '.sidebar a[href="#calendar"]').isVisible(), true);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Page overflow at ${width}`);
      if (process.env.AXIOM_SCREENSHOTS) {
        fs.mkdirSync(process.env.AXIOM_SCREENSHOTS, { recursive: true });
        await page.screenshot({ path: path.join(process.env.AXIOM_SCREENSHOTS, `calendar-page-${width}.png`) });
      }
      await page.locator('#calendar-add-exam').click();
      assert.ok(await page.locator('#calendar-exam-dialog').evaluate(el => el.getBoundingClientRect().right <= innerWidth));
      if (process.env.AXIOM_SCREENSHOTS) {
        fs.mkdirSync(process.env.AXIOM_SCREENSHOTS, { recursive: true });
        await page.screenshot({ path: path.join(process.env.AXIOM_SCREENSHOTS, `calendar-exam-${width}.png`) });
      }
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    }
    await page.reload();
    assert.equal((await saved()).exams.length, 2);
    assert.deepEqual(errors, []);
    console.log('Calendar exams passed: legacy routing, navigation, all-date search, add/edit/delete/cancel, timestamp/reminder/metadata preservation, undated records, related calendar data, refresh, desktop/mobile layout.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
