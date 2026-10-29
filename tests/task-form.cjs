const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const seed = {
  version: 16, userProfile: { theme: 'dark' },
  subjects: [{ id: 'math', code: 'MATH', name: 'Mathematics', color: '#8855ff' }],
  topics: [], tasks: [], focusSessions: [], exams: [], examWeekSchedule: [],
  holidays: [], examWeeks: [], gradeDeadlines: [], academicEvents: [],
  resources: []
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
  }, seed);
  try {
    await page.goto('http://axiom.test/#tasks');
    await page.evaluate(async () => {
      const { showCreateTaskModal } = await import('/js/views/tasksView.js');
      showCreateTaskModal(null, 'math');
    });
    const create = page.locator('#task-create-dialog');
    const expectedLabels = ['Task Title *', 'Subject', 'Deadline', 'Task Type'];
    assert.deepEqual(await create.locator('label').allTextContents(), expectedLabels);
    assert.equal(await create.locator('input, select, textarea').count(), 4);
    assert.equal(await create.locator('[placeholder]').count(), 0);
    assert.equal(await create.locator('[name="subjectId"]').inputValue(), 'math');
    await page.locator('#save-task-btn').click();
    assert.equal(await create.isVisible(), true);
    await create.locator('[name="title"]').fill('   ');
    await page.locator('#save-task-btn').click();
    assert.equal(await create.isVisible(), true);
    await create.locator('[name="title"]').fill('  Review circuits  ');
    await create.locator('[name="deadline"]').fill('2026-11-10T14:30');
    await create.locator('[name="taskType"]').selectOption('problem_set');
    await page.locator('#save-task-btn').click();
    assert.equal(await create.count(), 0);
    const created = await page.evaluate(async () => {
      const { db } = await import('/js/db.js');
      return db.getTasks().find(task => task.title === 'Review circuits');
    });
    assert.equal(created.subjectId, 'math');
    assert.equal(created.deadline, '2026-11-10T14:30');
    assert.equal(created.taskType, 'problem_set');
    assert.equal(created.priority, 'medium');
    assert.equal(created.estimatedMinutes, 45);
    const details = {
      description: 'Existing instructions', notes: 'Keep notes', topicId: 'topic-1',
      priority: 'high', estimatedMinutes: 90, status: 'completed', completedAt: '2026-10-28T08:00:00Z',
      subtasks: [{ id: 'st-1', text: 'Existing subtask', completed: true }],
      submissionChecklist: [{ id: 'sc-1', label: 'Submit', checked: true }],
      externalLinks: ['https://example.com'], attachedResources: ['resource-1']
    };
    await page.evaluate(async ({ id, details }) => {
      const { db } = await import('/js/db.js');
      const { showEditTaskModal } = await import('/js/views/tasksView.js');
      db.updateTask(id, details);
      showEditTaskModal(db.getTasks().find(task => task.id === id));
    }, { id: created.id, details });
    const edit = page.locator('#task-edit-dialog');
    assert.deepEqual(await edit.locator('label').allTextContents(), expectedLabels);
    assert.equal(await edit.locator('input, select, textarea').count(), 4);
    assert.equal(await edit.locator('[placeholder]').count(), 0);
    assert.equal(await edit.locator('[name="deadline"]').inputValue(), '2026-11-10T14:30');
    await edit.locator('[name="title"]').fill('Edited circuits');
    await edit.locator('[name="taskType"]').selectOption('review');
    await edit.locator('[name="deadline"]').fill('2026-11-12T09:15');
    await page.locator('#save-edit-task-btn').click();
    await page.reload();
    const saved = await page.evaluate(async id => {
      const { db } = await import('/js/db.js');
      return db.getTasks().find(task => task.id === id);
    }, created.id);
    assert.equal(saved.title, 'Edited circuits');
    assert.equal(saved.taskType, 'review');
    assert.equal(saved.deadline, '2026-11-12T09:15');
    for (const [key, value] of Object.entries(details)) assert.deepEqual(saved[key], value);

    for (const width of [1365, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate(async () => {
        const { showCreateTaskModal } = await import('/js/views/tasksView.js');
        showCreateTaskModal();
      });
      const bounds = await create.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
      assert.equal(await create.evaluate(el => el.scrollWidth <= el.clientWidth), true);
      await page.screenshot({ path: `tests/task-form-${width}.png` });
      await page.locator('#cancel-task-btn').click();
      await page.evaluate(async id => {
        const { db } = await import('/js/db.js');
        const { showEditTaskModal } = await import('/js/views/tasksView.js');
        showEditTaskModal(db.getTasks().find(task => task.id === id));
      }, created.id);
      assert.equal(await edit.evaluate(el => el.scrollWidth <= el.clientWidth), true);
      await page.locator('#cancel-edit-task-btn').click();
    }
    await page.evaluate(async id => {
      const { db } = await import('/js/db.js');
      const { showEditTaskModal } = await import('/js/views/tasksView.js');
      showEditTaskModal(db.getTasks().find(task => task.id === id));
    }, created.id);
    await edit.locator('[name="subjectId"]').selectOption('');
    await edit.locator('[name="deadline"]').fill('');
    await page.locator('#save-edit-task-btn').click();
    const cleared = await page.evaluate(async id => {
      const { db } = await import('/js/db.js');
      return db.getTasks().find(task => task.id === id);
    }, created.id);
    assert.equal(cleared.subjectId, null);
    assert.equal(cleared.deadline, null);
    assert.equal(cleared.topicId, null);
    assert.deepEqual(cleared.subtasks, details.subtasks);
    assert.deepEqual(errors, []);
    console.log('Task form passed: four fields, validation, creation, editing, persistence, existing data, and desktop/mobile layout.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
