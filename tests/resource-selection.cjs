const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const seed = {
  version: 16, userProfile: { name: 'Tester', section: 'A', major: 'Engineering', theme: 'dark' },
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
    if (window !== window.top) return;
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
    await page.goto('https://axiom.test/#subjects');
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
    await page.locator('#ws-choose-link').click();
    await page.locator('#ws-link-url').fill('https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ');
    await page.locator('#ws-link-form button[type="submit"]').click();
    await page.locator('#ws-web-frame').waitFor();
    assert.match(await page.locator('#ws-web-external').getAttribute('href'), /youtube\.com\.evil\.test/);
    await page.locator('#ws-change-resource').click();
    await page.locator('#ws-choose-link').click();
    for (const url of ['https://youtube.com/watch?v=dQw4w9WgXcQ', 'https://youtu.be/dQw4w9WgXcQ', 'https://youtube.com/shorts/dQw4w9WgXcQ', 'https://youtube.com/live/dQw4w9WgXcQ', 'https://youtube.com/embed/dQw4w9WgXcQ', 'youtu.be/dQw4w9WgXcQ']) {
      await page.locator('#ws-link-url').fill(url);
      await page.locator('#ws-link-form button[type="submit"]').click();
      await page.locator('#ws-youtube-player').waitFor();
      assert.equal(await page.evaluate(() => window.__videoOptions.videoId), 'dQw4w9WgXcQ');
      assert.equal(await page.evaluate(() => window._axiomTimer.timer.state), 'running');
      await page.locator('#ws-change-resource').click();
      await page.locator('#ws-choose-link').click();
    }
    await page.locator('#ws-resource-cancel').click();
    await page.evaluate(() => window.__videoOptions.events.onError({ data: 101 }));
    await page.locator('#ws-video-error').getByText('does not allow embedding', { exact: false }).waitFor();
    await page.locator('#ws-change-resource').click();
    await page.locator('#ws-resource-pdf-input').setInputFiles({ name: 'new-module.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.5\n%%EOF') });
    await page.locator('#ws-pdf-page-num').waitFor();
    const after = await page.evaluate(() => {
      const data = JSON.parse(localStorage.getItem('axiom_studia_database_v16'));
      return { tasks: data.tasks, focusSessions: data.focusSessions };
    });
    assert.deepEqual(after, before);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('axiom_studia_database_v16')).resources);
    assert.ok(saved.some(resource => resource.id === 'pdf-1'));
    assert.ok(saved.some(resource => resource.id === 'video-1'));
    assert.ok(saved.some(resource => resource.title === 'new-module.pdf' && resource.type === 'pdf' && resource.pdfStorageId));
    assert.ok(saved.some(resource => resource.type === 'website' && resource.url === 'https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ'));
    assert.equal(await page.evaluate(() => localStorage.getItem('axiom_pdf_bookmarks')), '{"saved.pdf":[3]}');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('axiom_studia_database_v16')).pdfProgress['module.pdf'].page), 2);
    await page.locator('#btn-add-resource').click();
    const picker = page.locator('#ws-resource-picker');
    const form = picker.locator('#ws-link-form');
    await picker.waitFor();
    assert.equal(await form.locator('[name="category"], [name="description"], [name="type"]').count(), 0);
    assert.equal(await form.locator('[name="title"]').isVisible(), false);
    await picker.locator('#ws-choose-pdf').click();
    await picker.locator('#ws-resource-pdf-input').setInputFiles({ name: 'module-from-picker.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\n%%EOF') });
    await page.locator('.ws-pdf-filename[title="module-from-picker.pdf"]').waitFor();
    await page.locator('#btn-add-resource').click();
    await picker.locator('#ws-choose-link').click();
    const playlist = 'https://www.youtube.com/playlist?list=PL1234567890_abc';
    await picker.locator('#ws-link-url').fill(playlist);
    await form.locator('[name="title"]').fill('Circuits lectures');
    assert.match(await picker.locator('#ws-link-type').innerText(), /YouTube Playlist/);
    await form.locator('button[type="submit"]').click();
    await page.locator('#ws-playlist-next').waitFor();
    const savedPlaylist = await page.evaluate(() => JSON.parse(localStorage.getItem('axiom_studia_database_v16')).resources.find(r => r.type === 'youtube_playlist'));
    assert.equal(savedPlaylist.url, playlist);
    assert.equal(savedPlaylist.title, 'Circuits lectures');
    await page.locator('#ws-change-resource').click();
    await page.locator('#ws-choose-link').click();
    await page.locator('#ws-link-url').fill('https://m.youtube.com/watch?v=aqz-KE-bpKQ');
    await page.locator('#ws-link-form button[type="submit"]').click();
    await page.locator('#ws-youtube-player').waitFor();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('axiom_studia_database_v16')).resources.find(r => r.videoId === 'aqz-KE-bpKQ').type), 'youtube_video');
    const originalPdf = page.locator('[data-resource-id="pdf-1"] [data-open-resource]');
    await originalPdf.click();
    await page.locator('.ws-pdf-filename[title="Saved module"]').waitFor();
    await page.locator('#ws-pdf-close-btn').click();
    await page.locator('#ws-resource-picker').waitFor({ state: 'visible' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#ws-choose-link').click();
    assert.equal(await page.locator('body').evaluate(el => el.scrollWidth <= window.innerWidth), true);
    await page.locator('#ws-link-form button[type="submit"]').scrollIntoViewIfNeeded();
    await page.locator('#ws-link-url').fill('https://youtu.be/dQw4w9WgXcQ');
    await page.locator('#ws-link-form button[type="submit"]').click();
    await page.locator('#ws-youtube-player').waitFor();
    await page.locator('.ws-mobile-tab[data-tab="tasks"]').click();
    await page.locator('#ws-panel-tasks').getByText('Review chapter one', { exact: true }).waitFor();
    await page.locator('#ws-change-resource').click();
    await page.locator('#ws-choose-link').click();
    await page.locator('#ws-link-form button[type="submit"]').scrollIntoViewIfNeeded();
    if (process.env.AXIOM_SCREENSHOTS) await page.screenshot({ path: path.join(root, 'tests/resource-selection-mobile.png') });
    await page.setViewportSize({ width: 1365, height: 768 });
    if (process.env.AXIOM_SCREENSHOTS) await page.screenshot({ path: path.join(root, 'tests/resource-selection-desktop.png') });
    await page.setViewportSize({ width: 1365, height: 768 });
    await page.locator('#ws-choose-image').click();
    const imageData = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 1; canvas.height = 1;
      canvas.getContext('2d').fillRect(0, 0, 1, 1);
      return canvas.toDataURL().split(',')[1];
    });
    await page.locator('#ws-image-input').setInputFiles({
      name: 'study-image.png', mimeType: 'image/png',
      buffer: Buffer.from(imageData, 'base64')
    });
    await page.locator('#ws-study-image').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#ws-study-image').evaluate(image => image.naturalWidth), 1);
    await page.reload();
    await page.locator('#ws-study-image').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#ws-study-image').getAttribute('alt'), 'study-image.png');
    assert.deepEqual(errors, []);
    console.log('Resource selection passed: upload, PDF navigation/cancel, all YouTube URL formats, inline validation, embedding error, video to PDF, saved data and timer continuity, close, desktop/mobile.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
