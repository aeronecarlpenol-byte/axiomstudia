const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const storageKey = 'axiom_studia_database_v16';
const seed = {
  userProfile: { name: 'Aerone', semester: '1st Semester', schoolYear: '2025–2026', theme: 'dark', dailyFocusGoalMinutes: 240, purposeStatement: 'Keep this saved data.' },
  subjects: [
    { id: 'ee', code: 'EE124', name: 'Electrical Engineering', units: 3, grades: { prelim: 7, midterm: 3, endterm: null }, targetGrade: 6 },
    { id: 'math', code: 'MATH', name: 'Mathematics', units: 3, grades: { prelim: 8, midterm: 9 }, academicPeriod: { semester: '3rd Semester', schoolYear: '2024–2025' } },
    { id: 'old', code: 'OLD', name: 'Previous course', grades: { prelim: 5 }, semester: '2nd Semester', schoolYear: '2023–2024' }
  ],
  tasks: [], topics: [], resources: [{ id: 'notes', subjectId: 'ee', type: 'notes', title: 'Preserved notes', content: 'Study notes' }],
  gradingSystem: { minimum: 0, maximum: 10, passing: 5, direction: 'higher' }
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'axiom.test') return route.abort();
      const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
      if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
      const type = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png' }[path.extname(file)] || 'application/octet-stream';
      return route.fulfill({ contentType: type, body: fs.readFileSync(file) });
    });
    await page.addInitScript(({ seed, storageKey }) => {
      if (window === window.top && !localStorage.getItem(storageKey)) localStorage.setItem(storageKey, JSON.stringify(seed));
    }, { seed, storageKey });
    const database = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
    const navigate = async route => {
      await page.evaluate(route => { location.hash = route; }, route);
      await page.locator(`#main-content[data-route="${route}"]`).waitFor();
    };
    const screenshot = async name => {
      if (!process.env.AXIOM_SCREENSHOTS) return;
      fs.mkdirSync(process.env.AXIOM_SCREENSHOTS, { recursive: true });
      await page.screenshot({ path: path.join(process.env.AXIOM_SCREENSHOTS, name + '.png') });
    };
    await page.goto('http://axiom.test/#settings');
    await page.locator('#profile-form').waitFor();
    assert.deepEqual((await database()).subjects, seed.subjects, 'Startup must not migrate or erase saved grades');
    assert.equal(await page.locator('#academic-semester').inputValue(), '1st Semester');
    assert.deepEqual(await page.locator('#academic-semester option:not([disabled])').allTextContents(), ['1st Semester', '2nd Semester', '3rd Semester']);
    assert.equal(await page.locator('#academic-school-year').inputValue(), '2025–2026');
    assert.equal(await page.locator('#purpose-form, #btn-theme-dark, #btn-theme-light').count(), 0);
    assert.doesNotMatch(await page.locator('#main-content').innerText(), /Appearance & Atmosphere|Personal Purpose Statement/);
    await page.locator('#academic-semester').selectOption('2nd Semester');
    await page.locator('#academic-school-year').fill('invalid year');
    assert.equal(await page.locator('#academic-school-year').evaluate(el => el.checkValidity()), false);
    await page.locator('#academic-school-year').fill('2026–2027');
    assert.equal(await page.locator('#academic-school-year').evaluate(el => el.checkValidity()), true);
    await page.locator('#profile-form button[type="submit"]').click();
    await page.reload();
    assert.equal(await page.locator('#academic-semester').inputValue(), '2nd Semester');
    assert.equal(await page.locator('#academic-school-year').inputValue(), '2026–2027');
    const saved = await database();
    assert.deepEqual(saved.subjects[0].academicPeriod, { semester: '1st Semester', schoolYear: '2025–2026' });
    assert.deepEqual(saved.subjects[1].academicPeriod, seed.subjects[1].academicPeriod);
    assert.deepEqual(saved.subjects[2].academicPeriod, { semester: '2nd Semester', schoolYear: '2023–2024' });
    for (let index = 0; index < seed.subjects.length; index++) {
      const { academicPeriod, ...subject } = saved.subjects[index];
      const { academicPeriod: originalPeriod, ...original } = seed.subjects[index];
      assert.deepEqual(subject, original, 'Only missing period metadata may be added');
    }
    assert.deepEqual(saved.resources, seed.resources);
    assert.equal(saved.userProfile.purposeStatement, seed.userProfile.purposeStatement);
    await screenshot('settings-desktop');
    await navigate('grades');
    assert.equal(await page.locator('[data-academic-semester]').innerText(), '2nd Semester');
    assert.equal(await page.locator('[data-academic-school-year]').innerText(), '2026–2027');
    assert.equal(await page.locator('#main-content input[name="semester"], #main-content select[name="semester"], #main-content input[name="schoolYear"]').count(), 0);
    assert.doesNotMatch(await page.locator('#main-content').innerText(), /Admission Status/);
    assert.match(await page.locator('[data-goal-subject="ee"] [data-proj-note]').innerText(), /Required Endterm: ≥ 7.50/);
    for (const term of ['prelim', 'midterm', 'endterm']) assert.equal(await page.locator(`[data-sub-id="ee"][data-term="${term}"]`).count(), 1);
    await screenshot('grades-desktop');
    // A live profile update also refreshes the read-only text without replacing grade inputs.
    await page.evaluate(async () => {
      const { db } = await import('/js/db.js');
      db.updateUserProfile({ semester: '3rd Semester', schoolYear: '2027-2028' });
    });
    assert.equal(await page.locator('[data-academic-semester]').innerText(), '3rd Semester');
    assert.equal(await page.locator('[data-academic-school-year]').innerText(), '2027-2028');
    assert.deepEqual((await database()).subjects, saved.subjects, 'Repeated period changes must preserve all prior associations');
    await page.reload();
    assert.equal(await page.locator('[data-academic-semester]').innerText(), '3rd Semester');
    assert.equal((await page.locator('.sidebar-nav a[href="#subjects"]').innerText()).trim(), 'Workspace');
    assert.equal((await page.locator('.mobile-nav a[href="#subjects"]').innerText()).trim(), 'Workspace');
    assert.equal(await page.locator('.sidebar-nav a[href="#focus"], .mobile-nav a[href="#focus"], .mobile-more-links a[href="#focus"]').count(), 0);
    await page.locator('.sidebar-nav a[href="#subjects"]').click();
    await page.locator('.ws-page-title').waitFor();
    assert.equal(await page.locator('.ws-page-title').innerText(), 'Workspace');
    assert.equal(await page.locator('#ws-subject-dropdown option').count(), 3);
    assert.equal(await page.locator('#ws-btn-start-pause').isVisible(), true);
    await page.locator('#ws-btn-start-pause').click();
    assert.match(await page.locator('#ws-btn-start-pause').innerText(), /PAUSE/);
    await page.evaluate(async () => { (await import('/js/timer.js')).timer.reset(); });
    await screenshot('workspace-desktop');
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      const brand = page.locator(width <= 640 ? '.mobile-brand' : '.topbar-left');
      assert.equal(await brand.isVisible(), true);
      assert.equal(await brand.locator('.app-brand-name').innerText(), 'AXIOM STUDIA');
      assert.equal(await brand.locator('.app-brand-tagline').innerText(), 'Built by Aerone. Made for progress.');
      assert.ok(await brand.evaluate(el => el.scrollWidth <= el.clientWidth), `Brand clipping at ${width}`);
      assert.ok(await page.evaluate(() => document.body.scrollWidth <= innerWidth), `Page overflow at ${width}`);
      await screenshot('workspace-' + width);
      if (width <= 640) {
        await page.locator('.mobile-nav a[href="#grades"]').click();
        await page.locator('[data-academic-semester]').waitFor();
        await page.locator('#mobile-nav-more-trigger').click();
        await page.locator('.mobile-more-links a[href="#settings"]').click();
        await page.locator('#profile-form').waitFor();
        await screenshot('settings-' + width);
        assert.equal(await page.locator('#academic-semester').inputValue(), '3rd Semester');
        assert.ok(await page.locator('#profile-form').evaluate(el => el.scrollWidth <= el.clientWidth), `Settings clipping at ${width}`);
        await page.locator('.mobile-nav a[href="#subjects"]').click();
        await page.locator('#ws-btn-start-pause').waitFor();
        assert.equal(await page.locator('#ws-btn-start-pause').isVisible(), true);
      }
    }
    await navigate('focus');
    assert.equal(await page.locator('#btn-why-doing-this').count(), 0);
    assert.equal(await page.locator('#btn-settle-meditation').isVisible(), true);
    assert.deepEqual((await database()).subjects, saved.subjects);
    const created = await page.evaluate(async () => {
      const { db } = await import('/js/db.js');
      return db.addSubject({ code: 'NEW', grades: {} });
    });
    assert.deepEqual(created.academicPeriod, { semester: '3rd Semester', schoolYear: '2027-2028' });
    const legacyPeriod = await page.evaluate(async () => {
      const { db } = await import('/js/db.js');
      return db.getAcademicPeriod({ semester: '2nd Semester, 2024–2025' });
    });
    assert.deepEqual(legacyPeriod, { semester: '2nd Semester', schoolYear: '2024–2025' });
    assert.deepEqual(errors, []);
    console.log('Academic settings passed: persistence, live Grades sync, legacy and explicit period preservation, unchanged grades/resources, navigation, workspace timer, removed UI, and branding at 320–1440px.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
