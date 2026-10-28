const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const seed = {
  version: 16, userProfile: { theme: 'dark' },
  subjects: [{ id: 'math', code: 'MATH', name: 'Mathematics', color: '#8855ff' }],
  topics: [],
  tasks: [{ id: 'saved-task', subjectId: 'math', title: 'Review chapter one', status: 'pending', priority: 'medium', notes: 'Keep these study notes', subtasks: [] }],
  focusSessions: [{ id: 'saved-session', subjectId: 'math', durationMinutes: 25, startTime: '2026-10-27T10:00:00.000Z' }],
  exams: [], examWeekSchedule: [],
  holidays: [], examWeeks: [], gradeDeadlines: [], academicEvents: [],
  resources: [
    { id: 'pdf-1', type: 'pdf', title: 'Saved module', subjectId: 'math', pdfDataUrl: 'data:application/pdf;base64,JVBERg==' },
    { id: 'video-1', type: 'youtube', title: 'Lecture', subjectId: 'math', videoId: 'dQw4w9WgXcQ', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', lastPlaybackPosition: 1122 }
  ]
};

(async () => {
  const browser = await chromium.launch({ executablePath: edge, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1365, height: 768 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'axiom.test') return route.abort();
    const requestPath = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const file = path.resolve(root, '.' + requestPath);
    if (!file.startsWith(root) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
    const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream';
    return route.fulfill({ status: 200, contentType: type, body: fs.readFileSync(file) });
  });
  await page.addInitScript(data => {
    if (!localStorage.getItem('axiom_studia_database_v16')) localStorage.setItem('axiom_studia_database_v16', JSON.stringify(data));
    localStorage.setItem('axiom_studia_fresh_start_v1', 'done');
    window.YT = {
      PlayerState: { PAUSED: 2, ENDED: 0 },
      Player: class {
        constructor(element, options) {
          window.__videoOptions = options;
          element.innerHTML = '<span>Player ready</span>';
          setTimeout(() => options.events.onReady(), 0);
        }
        getCurrentTime() { return 1125; }
        destroy() {}
      }
    };
    window['pdfjs-dist/build/pdf'] = {
      GlobalWorkerOptions: {},
      getDocument() { return { promise: Promise.resolve({
        numPages: 2,
        getPage: async () => ({
          getViewport: ({ scale }) => ({ width: 600 * scale, height: 800 * scale }),
          render: () => ({ promise: Promise.resolve(), cancel() {} })
        })
      }) }; }
    };
  }, seed);
  try {
    await page.goto('http://axiom.test/#subjects');
    await page.locator('#ws-resource-picker').waitFor({ state: 'visible' });
    await page.locator('#ws-btn-start-pause').click();
    await page.evaluate(() => localStorage.setItem('axiom_pdf_bookmarks', '{"saved.pdf":[3]}'));
    const before = await page.evaluate(() => {
      const data = JSON.parse(localStorage.getItem('axiom_studia_database_v16'));
      return { tasks: data.tasks, focusSessions: data.focusSessions };
    });
    await page.locator('#ws-choose-pdf').click();
    await page.locator('#ws-resource-pdf-input').setInputFiles({ name: 'module.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF') });
    await page.locator('#ws-pdf-page-num').waitFor();
    await page.locator('#ws-pdf-next-btn').click();
    assert.equal(await page.locator('#ws-pdf-page-num').inputValue(), '2');
    await page.locator('#ws-change-resource').click();
    await page.locator('#ws-resource-cancel').click();
    assert.equal(await page.locator('#ws-pdf-page-num').inputValue(), '2');
    await page.locator('#ws-change-resource').click();
    await page.locator('#ws-choose-youtube').click();
    await page.locator('#ws-youtube-url').fill('https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ');
    await page.locator('#ws-youtube-form button[type="submit"]').click();
    await page.locator('#ws-youtube-url-error').waitFor({ state: 'visible' });
    for (const url of ['https://youtube.com/watch?v=dQw4w9WgXcQ', 'https://youtu.be/dQw4w9WgXcQ', 'https://youtube.com/shorts/dQw4w9WgXcQ']) {
      await page.locator('#ws-youtube-url').fill(url);
      await page.locator('#ws-youtube-form button[type="submit"]').click();
      await page.locator('#ws-youtube-player').waitFor();
      assert.equal(await page.evaluate(() => window.__videoOptions.videoId), 'dQw4w9WgXcQ');
      assert.equal(await page.evaluate(() => window._axiomTimer.timer.state), 'running');
      await page.locator('#ws-change-resource').click();
      await page.locator('#ws-choose-youtube').click();
    }
    await page.locator('#ws-resource-cancel').click();
    await page.evaluate(() => window.__videoOptions.events.onError({ data: 101 }));
    await page.locator('#ws-video-error').getByText('does not allow embedding', { exact: false }).waitFor();
    await page.locator('#ws-change-resource').click();
    await page.locator('#ws-resource-pdf-input').setInputFiles({ name: 'new-module.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF') });
    await page.locator('#ws-pdf-page-num').waitFor();
    const after = await page.evaluate(() => {
      const data = JSON.parse(localStorage.getItem('axiom_studia_database_v16'));
      return { tasks: data.tasks, focusSessions: data.focusSessions };
    });
    assert.deepEqual(after, before);
    assert.equal(await page.evaluate(() => localStorage.getItem('axiom_pdf_bookmarks')), '{"saved.pdf":[3]}');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('axiom_pdf_progress'))['module.pdf'].page), 2);
    await page.locator('#ws-pdf-close-btn').click();
    await page.locator('#ws-resource-picker').waitFor({ state: 'visible' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#ws-choose-youtube').click();
    assert.equal(await page.locator('body').evaluate(el => el.scrollWidth <= window.innerWidth), true);
    await page.locator('#ws-youtube-form button[type="submit"]').scrollIntoViewIfNeeded();
    await page.locator('#ws-youtube-url').fill('https://youtu.be/dQw4w9WgXcQ');
    await page.locator('#ws-youtube-form button[type="submit"]').click();
    await page.locator('#ws-youtube-player').waitFor();
    await page.locator('.ws-mobile-tab[data-tab="tasks"]').click();
    await page.locator('#ws-panel-tasks').getByText('Review chapter one', { exact: true }).waitFor();
    await page.locator('#ws-change-resource').click();
    await page.locator('#ws-choose-youtube').click();
    await page.locator('#ws-youtube-form button[type="submit"]').scrollIntoViewIfNeeded();
    if (process.env.AXIOM_SCREENSHOTS) await page.screenshot({ path: path.join(root, 'tests/resource-selection-mobile.png') });
    await page.setViewportSize({ width: 1365, height: 768 });
    if (process.env.AXIOM_SCREENSHOTS) await page.screenshot({ path: path.join(root, 'tests/resource-selection-desktop.png') });
    assert.deepEqual(errors, []);
    console.log('Resource selection passed: upload, PDF navigation/cancel, three YouTube URL formats, inline validation, embedding error, video to PDF, saved data and timer continuity, close, desktop/mobile.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
