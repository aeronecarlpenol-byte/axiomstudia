const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const seed = {
  version: 16, userProfile: { name: 'Test Student', section: 'A', major: 'Science', theme: 'dark' },
  subjects: [{ id: 'math', code: 'MATH', name: 'Mathematics', color: '#8855ff' }],
  topics: [], tasks: [{ id: 'task-1', subjectId: 'math', title: 'Review chapter', status: 'not_started' }],
  focusSessions: [], exams: [], examWeekSchedule: [], holidays: [], examWeeks: [],
  gradeDeadlines: [], academicEvents: [],
  resources: [{ id: 'web-1', type: 'website', title: 'Gizmo', subjectId: 'math', url: 'https://app.gizmo.ai/chat' }]
};

(async () => {
  const browser = await chromium.launch({ executablePath: edge, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'axiom.test') return route.abort();
    const filename = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
    if (!filename.startsWith(root) || !fs.existsSync(filename)) return route.fulfill({ status: 404, body: '' });
    const contentType = filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : filename.endsWith('.html') ? 'text/html' : 'application/octet-stream';
    return route.fulfill({ status: 200, contentType, body: fs.readFileSync(filename) });
  });
  await page.addInitScript(data => {
    localStorage.setItem('axiom_studia_database_v16', JSON.stringify(data));
    localStorage.setItem('axiom_studia_fresh_start_v1', 'done');
  }, seed);
  try {
    await page.goto('http://axiom.test/#subjects');
    await page.locator('#ws-subject-dropdown').waitFor();
    const call = (action, extra = {}) => page.evaluate(({ action, extra }) => new Promise((resolve, reject) => {
      const requestId = `${Date.now()}-${Math.random()}`;
      const timeout = setTimeout(() => reject(new Error('Bridge timed out')), 3000);
      function onResponse(event) {
        if (event.data?.channel !== 'axiom-studia-companion-v1' || event.data?.kind !== 'response' || event.data.requestId !== requestId) return;
        clearTimeout(timeout);
        window.removeEventListener('message', onResponse);
        resolve(event.data);
      }
      window.addEventListener('message', onResponse);
      window.postMessage({ channel: 'axiom-studia-companion-v1', kind: 'request', requestId, action, ...extra }, location.origin);
    }), { action, extra });
    let response = await call('snapshot');
    assert.equal(response.data.selectedSubjectId, 'math');
    assert.equal(response.data.resources[0].url, 'https://app.gizmo.ai/chat');
    response = await call('select-task', { taskId: 'task-1' });
    assert.equal(response.data.timer.taskId, 'task-1');
    response = await call('timer-start');
    assert.equal(response.data.timer.state, 'running');
    response = await call('toggle-task', { taskId: 'task-1' });
    assert.equal(response.data.tasks[0].status, 'completed');
    response = await call('timer-pause');
    assert.equal(response.data.timer.state, 'paused');
    response = await call('timer-reset');
    assert.equal(response.data.timer.state, 'idle');
    assert.deepEqual(errors, []);
    console.log('Companion bridge subject, resource, task, and live timer checks passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
