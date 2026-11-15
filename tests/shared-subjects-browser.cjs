const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const seed = {
  userProfile: { name: 'Test Student', section: 'A', major: 'Science', semester: '1st Semester', schoolYear: '2026–2027' },
  gradingSystem: { minimum: 0, maximum: 100, passing: 75, direction: 'higher' },
  subjects: [{ id: 'math', name: 'Mathematics', code: 'MATH', units: 3, grades: { prelim: 80, midterm: 85, endterm: 90 } }],
  tasks: [{ id: 'task', subjectId: 'math', title: 'Existing task', status: 'completed' }],
  resources: [{ id: 'resource', subjectId: 'math', title: 'Existing notes', type: 'link', url: 'https://example.com' }],
  focusSessions: [{ id: 'session', subjectId: 'math', duration: 1500 }]
};
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
      if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ contentType: file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html', body: fs.readFileSync(file) });
    });
    await page.addInitScript(seed => {
      if (!localStorage.getItem('axiom_studia_database_v16')) localStorage.setItem('axiom_studia_database_v16', JSON.stringify(seed));
    }, seed);
    const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('axiom_studia_database_v16')));
    const summary = page.locator('#gwa-summary');
    await page.goto('http://axiom.test/#grades');
    assert.match(await summary.innerText(), /Final GWA\s+85.50/i);
    for (const term of ['Prelim', 'Midterm', 'Endterm', 'Final']) assert.match(await summary.innerText(), new RegExp(term + ' GWA'));
    await page.locator('#grades-add-subject').click();
    await page.locator('#grade-subject-form [name="name"]').fill('Physics');
    await page.locator('#grade-subject-form [name="units"]').selectOption('3');
    await page.locator('#grade-subject-form button[type="submit"]').click();
    let state = await saved();
    const physics = state.subjects.find(subject => subject.name === 'Physics');
    assert.ok(physics);
    assert.equal(state.subjects.length, 2);
    assert.match(await summary.innerText(), /Based on subjects with complete grades and academic units/);
    for (const [term, value] of Object.entries({ prelim: '90', midterm: '95', endterm: '100' })) await page.locator(`[data-sub-id="${physics.id}"][data-term="${term}"]`).fill(value);
    assert.doesNotMatch(await summary.innerText(), /Based on subjects with complete grades and academic units/);
    assert.match(await summary.innerText(), /Final GWA\s+90.50/i);
    await page.locator(`[data-include-subject="${physics.id}"]`).uncheck();
    assert.match(await summary.innerText(), /Final GWA\s+85.50/i);
    await page.locator('[data-sub-id="math"][data-field="units"]').selectOption('');
    assert.match(await summary.innerText(), /Final GWA\s+N\/A/i);
    assert.equal((await saved()).subjects[0].units, null);
    await page.locator('[data-sub-id="math"][data-field="units"]').selectOption('3');
    await page.locator('[data-edit-subject="math"]').click();
    await page.locator('#grade-subject-form [name="name"]').fill('Advanced Mathematics');
    await page.locator('#grade-subject-form  .grade-trimester-options label').filter({ hasText: '2nd Trimester' }).click();
    await page.locator('#grade-subject-form button[type="submit"]').click();
    assert.equal(await page.locator('[data-row-sub="math"]').count(), 0);
    await page.evaluate(() => { location.hash = '#subjects'; });
    await page.locator('#ws-subject-dropdown').waitFor();
    assert.equal(await page.locator('#ws-subject-dropdown option[value="math"]').count(), 0);
    assert.match(await page.locator('.ws-subject-name-inline').innerText(), /Physics/i);
    await page.evaluate(() => { location.hash = '#grades'; });
    await page.locator('#grades-period-form  .grade-trimester-options label').filter({ hasText: '2nd Trimester' }).click();
    assert.equal(await page.locator('[data-row-sub="math"]').count(), 1);
    await page.evaluate(() => { location.hash = '#subjects'; });
    await page.getByText('Advanced Mathematics', { exact: true }).last().waitFor();
    assert.match(await page.locator('.ws-subject-inline-meta').innerText(), /2nd Semester/);
    assert.equal(await page.locator(`#ws-subject-dropdown option[value="${physics.id}"]`).count(), 0);
    await page.evaluate(() => { location.hash = '#grades'; });
    await page.locator('[data-row-sub="math"]').waitFor();
    await page.reload();
    await page.locator('[data-row-sub="math"]').waitFor();
    state = await saved();
    for (const field of ['tasks', 'resources', 'focusSessions']) assert.deepEqual(state[field], seed[field]);
    assert.equal(state.subjects.length, 2);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(root, 'tmp/shared-subjects-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Mobile page must not overflow horizontally');
    await page.screenshot({ path: path.join(root, 'tmp/shared-subjects-mobile.png'), fullPage: true });
    console.log('Browser passed: create, auto-workspace, grades, GWA, exclusion, missing units, rename, period edit/filter, reload, linked records, and no page errors.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
