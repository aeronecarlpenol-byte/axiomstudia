const $ = id => document.getElementById(id);
let current = null;
let busy = false;

function send(action, extra = {}) {
  return chrome.runtime.sendMessage({ action, ...extra }).then(response => {
    if (response?.error) throw new Error(response.error);
    return response;
  });
}

function itemButton(label, onClick) {
  const button = document.createElement('button');
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function render(data) {
  current = data;
  $('workspace').hidden = !data.ready;
  $('status').textContent = data.ready ? '' : 'Add a subject in Axiom Studia to begin.';
  if (!data.ready) return;
  const subjectSelect = $('subject');
  if (subjectSelect.options.length !== data.subjects.length ||
      data.subjects.some((subject, i) => subjectSelect.options[i]?.value !== subject.id || subjectSelect.options[i]?.textContent !== subject.name)) {
    subjectSelect.replaceChildren(...data.subjects.map(subject => {
      const option = document.createElement('option');
      option.value = subject.id;
      option.textContent = subject.code ? `${subject.code} · ${subject.name}` : subject.name;
      return option;
    }));
  }
  subjectSelect.value = data.selectedSubjectId;
  $('time').textContent = data.timer.time;
  $('timer-state').textContent = data.timer.state === 'running' && data.timer.subjectId !== data.selectedSubjectId
    ? 'Timer is running for another subject.' : data.timer.state === 'completed'
      ? 'Session complete. Return to Axiom to log your progress.' : data.timer.state;
  $('start').disabled = data.timer.state === 'running';
  $('pause').disabled = data.timer.state !== 'running';
  $('reset').disabled = data.timer.state === 'idle';
  const tasks = data.tasks.map(task => {
    const row = document.createElement('div');
    row.className = 'item';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = task.status === 'completed';
    checkbox.setAttribute('aria-label', `Complete ${task.title}`);
    checkbox.addEventListener('change', () => command('toggle-task', { taskId: task.id }));
    const title = document.createElement('span');
    title.textContent = task.title;
    row.append(checkbox, title, itemButton(data.timer.taskId === task.id ? 'Selected' : 'Focus', () => command('select-task', { taskId: task.id })));
    return row;
  });
  $('tasks').replaceChildren(...(tasks.length ? tasks : [empty('No tasks for this subject.') ]));
  const resources = data.resources.map(resource => {
    const row = document.createElement('div');
    row.className = 'item';
    const title = document.createElement('span');
    title.textContent = resource.title;
    row.append(title, itemButton(resource.url ? 'Open ↗' : 'Workspace ↗', () => {
      if (resource.url) command('open-url', { url: resource.url });
      else command('show-axiom');
    }));
    return row;
  });
  $('resources').replaceChildren(...(resources.length ? resources : [empty('No resources for this subject.') ]));
}

function empty(message) {
  const node = document.createElement('p');
  node.className = 'empty';
  node.textContent = message;
  return node;
}

async function command(action, extra = {}) {
  if (busy) return;
  busy = true;
  try {
    const result = await send(action, extra);
    if (action === 'open-url' || action === 'show-axiom') return;
    render(result);
  } catch (error) { $('status').textContent = error.message; }
  finally { busy = false; }
}

$('subject').addEventListener('change', event => command('select-subject', { subjectId: event.target.value }));
for (const action of ['start', 'pause', 'reset']) $(''+action).addEventListener('click', () => command(`timer-${action}`));
$('show-axiom').addEventListener('click', () => command('show-axiom'));
async function refresh() {
  if (busy || refresh.pending) return;
  refresh.pending = true;
  try { render(await send('snapshot')); }
  catch (error) { $('workspace').hidden = true; $('status').textContent = error.message; }
  finally { refresh.pending = false; }
}
refresh();
setInterval(refresh, 1000);
