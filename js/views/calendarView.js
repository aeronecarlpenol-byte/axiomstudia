import { CALENDAR_TYPES, quizIsDone } from '../calendarClassification.js';
/**
 * Calendar and workload view. All entries come from the user's workspace.
 */
import { db } from '../db.js';
import { showCreateTaskModal, showEditTaskModal } from './tasksView.js';
import { taskScheduledDate, validDateKey } from '../taskSchedule.js';

export function renderCalendar(container) {
  let currentDate = new Date();
  currentDate.setDate(1);
  let selectedDateKey = db.getTodayDate();
  let taskSubject = 'all';
  let taskPriority = 'all';
  let taskStatus = 'all';
  let unscheduledOpen = true;
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const linkedExam = db.getExamById(params.get('exam'));
  const linkedDate = linkedExam?.date?.slice(0, 10) || params.get('date');
  if (/^\d{4}-\d{2}-\d{2}$/.test(linkedDate || '') && !Number.isNaN(new Date(`${linkedDate}T00:00:00`).getTime())) {
    selectedDateKey = linkedDate;
    currentDate = new Date(`${linkedDate.slice(0, 7)}-01T00:00:00`);
  }

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
  const formatDate = key => {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };
  const keyForDay = day => `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  function render() {
    const matchesTask = task =>
      (taskSubject === 'all' || task.subjectId === taskSubject) &&
      (taskPriority === 'all' || task.priority === taskPriority) &&
      (taskStatus === 'all' || (taskStatus === 'completed' ? task.status === 'completed' :
        taskStatus === 'active' ? task.status !== 'completed' :
        taskStatus === 'scheduled' ? task.status !== 'completed' && !!taskScheduledDate(task) :
        task.status !== 'completed' && !taskScheduledDate(task)));
    const tasks = db.getTasks().filter(matchesTask);
    const unscheduled = tasks.filter(task => task.status !== 'completed' && !taskScheduledDate(task));
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const monthLabel = currentDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const firstDay = currentDate.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const entries = new Map();
    const add = (key, item) => {
      if (!key || !validDateKey(key.slice(0, 10))) return;
      const day = key.slice(0, 10);
      if (!entries.has(day)) entries.set(day, []);
      entries.get(day).push(item);
    };

    tasks.forEach(task => add(taskScheduledDate(task), { type: task.taskType === 'project' ? 'Project Deadline' : 'Task', title: task.title, task }));
    db.getExams().forEach(exam => add(exam.date, { type: (CALENDAR_TYPES[exam.eventType] || 'Exam') + (quizIsDone(exam) ? ' · Done' : ''), title: exam.title || 'Exam', done: quizIsDone(exam), examId: exam.id }));
    db.getTopics().forEach(topic => add(topic.reviewDate, { type: 'Review', title: topic.name }));
    db.getHolidays().forEach(item => add(item.date, { type: 'Holiday', title: item.name }));
    db.getGradeDeadlines().forEach(item => add(item.date, { type: 'Grade deadline', title: item.name }));
    db.getAcademicEventDays().forEach(item => add(item.date, { type: 'Academic event', title: item.name }));
    db.getExamWeekDays().forEach(item => add(item.date, { type: 'Exam period', title: item.name }));

    const selected = entries.get(selectedDateKey) || [];
    const monthEntries = [...entries.entries()]
      .filter(([key]) => key.startsWith(`${year}-${String(month + 1).padStart(2, '0')}-`))
      .sort(([a], [b]) => a.localeCompare(b));

    container.innerHTML = `
      <div class="calendar-header">
        <div>
          <h2>Calendar & Tasks</h2>

        </div>
        <div class="calendar-controls">
          <button type="button" class="btn btn-secondary btn-sm" id="calendar-today">Today</button>
          <button type="button" class="btn btn-secondary btn-sm" id="calendar-prev" aria-label="Previous month">◀</button>
          <strong aria-live="polite">${monthLabel}</strong>
          <button type="button" class="btn btn-secondary btn-sm" id="calendar-next" aria-label="Next month">▶</button>
        </div>
      </div>
      <div class="calendar-task-filters" aria-label="Filter calendar tasks">
        <select id="calendar-filter-subject" aria-label="Filter by subject"><option value="all">All subjects</option>${db.getSubjects().map(subject => `<option value="${escapeHtml(subject.id)}" ${taskSubject === subject.id ? 'selected' : ''}>${escapeHtml(subject.code || subject.name)}</option>`).join('')}</select>
        <select id="calendar-filter-priority" aria-label="Filter by priority"><option value="all">All priorities</option>${['urgent', 'high', 'medium', 'low'].map(priority => `<option value="${priority}" ${taskPriority === priority ? 'selected' : ''}>${priority[0].toUpperCase() + priority.slice(1)}</option>`).join('')}</select>
        <select id="calendar-filter-status" aria-label="Filter by status"><option value="all">All tasks</option>${[['unscheduled','Unscheduled'],['scheduled','Scheduled'],['active','Active'],['completed','Completed']].map(([value,label]) => `<option value="${value}" ${taskStatus === value ? 'selected' : ''}>${label}</option>`).join('')}</select>
      </div>
      <div class="calendar-layout">
        <div class="calendar-month-wrap">
          <div class="calendar-grid" role="group" aria-label="${monthLabel}">
            ${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(day => `<div class="calendar-day-header">${day}</div>`).join('')}
            ${Array.from({ length: firstDay }, () => '<div class="calendar-day-cell other-month" aria-hidden="true"></div>').join('')}
            ${Array.from({ length: daysInMonth }, (_, index) => {
              const key = keyForDay(index + 1);
              const items = entries.get(key) || [];
              return `<div class="calendar-day-cell ${key === db.getTodayDate() ? 'today' : ''} ${key === selectedDateKey ? 'selected' : ''}" data-date-key="${key}" role="button" tabindex="0" aria-label="${formatDate(key)}: ${items.length} item${items.length === 1 ? '' : 's'}">
                <span class="day-number">${index + 1}</span>
                ${items.slice(0, 2).map(item => item.task
                  ? `<button type="button" class="calendar-event-pill calendar-task-pill ${item.task.status === 'completed' ? 'is-completed' : ''}" data-task-id="${escapeHtml(item.task.id)}" draggable="true" title="${escapeHtml(item.task.title)}"><span class="calendar-subject-dot" style="--task-color:${escapeHtml(db.getSubjectById(item.task.subjectId)?.color || '#38bdf8')}"></span>${item.task.status === 'completed' ? '✓ ' : ''}${escapeHtml(item.title)}<span class="calendar-priority-dot priority-${escapeHtml(item.task.priority || 'medium')}"></span></button>`
                  : `<span class="calendar-event-pill ${item.done ? 'calendar-agenda-done' : ''}">${item.done ? '✓ ' : ''}<span class="calendar-agenda-title">${escapeHtml(item.title)}</span></span>`).join('')}
                ${items.length > 2 ? `<span class="day-workload-badge">+${items.length - 2} more</span>` : ''}
              </div>`;
            }).join('')}
          </div>
        </div>
        <section class="mobile-calendar-agenda" aria-label="${monthLabel} agenda">
          <h3>${monthLabel} agenda</h3>
          <div class="mobile-calendar-agenda-list">
            ${monthEntries.length ? monthEntries.flatMap(([key, items]) => items.map(item => `<button type="button" class="mobile-calendar-agenda-item" ${item.task ? `data-task-id="${escapeHtml(item.task.id)}"` : `data-date-key="${key}"`}>
              <span class="mobile-calendar-agenda-date">${formatDate(key)}</span>
              <span><span class="mobile-calendar-agenda-title ${item.done ? 'calendar-agenda-done calendar-agenda-title' : ''}">${item.task?.status === 'completed' ? '✓ ' : ''}${escapeHtml(item.title)}</span><span class="mobile-calendar-agenda-meta">${item.type}${item.task ? ` · ${escapeHtml(db.getSubjectById(item.task.subjectId)?.code || 'General')}` : ''}</span></span>
            </button>`)).join('') : '<p class="card">Nothing scheduled this month. Add a task or exam to get started.</p>'}
          </div>
        </section>
        <div class="calendar-side"><section class="card calendar-selected-day" aria-live="polite">
          <div class="card-header">
            <h3>${formatDate(selectedDateKey)}</h3>
            <input type="date" id="calendar-selected-date" aria-label="Select planning date" value="${selectedDateKey}" />
          </div>
          <div class="calendar-day-actions"><button type="button" class="btn btn-primary btn-sm" id="calendar-add-existing">Add Existing Task</button><button type="button" class="btn btn-secondary btn-sm" id="calendar-new-task">New Task</button></div>
          ${selected.length ? selected.map(item => `<div class="calendar-detail">
            <span class="badge ${item.done ? 'badge-emerald' : ''}">${item.done ? '✓ ' : ''}${item.type}</span>
            ${item.task ? `<button type="button" class="calendar-detail-task ${item.task.status === 'completed' ? 'is-completed' : ''}" data-task-id="${escapeHtml(item.task.id)}" draggable="true"><span class="calendar-subject-dot" style="--task-color:${escapeHtml(db.getSubjectById(item.task.subjectId)?.color || '#38bdf8')}"></span>${item.task.status === 'completed' ? '✓ ' : ''}${escapeHtml(item.title)} <span class="calendar-priority-dot priority-${escapeHtml(item.task.priority || 'medium')}"></span></button>` : `<span class="${item.done ? 'calendar-agenda-done calendar-agenda-title' : ''}">${escapeHtml(item.title)}</span>`}
            ${item.examId ? `<button type="button" class="btn btn-secondary btn-sm" data-edit-exam="${escapeHtml(item.examId)}">Edit event</button>` : ''}
          </div>`).join('') : '<p>No items scheduled for this day.</p>'}
        </section>
        <section class="card calendar-unscheduled" id="calendar-unscheduled" aria-label="Unscheduled tasks">
          <div class="card-header"><h3>Unscheduled Tasks <small>(${unscheduled.length})</small></h3><button type="button" class="btn btn-ghost btn-sm" id="calendar-toggle-unscheduled" aria-expanded="${unscheduledOpen}">${unscheduledOpen ? 'Collapse' : 'Expand'}</button></div>
          <div id="calendar-unscheduled-body" ${unscheduledOpen ? '' : 'hidden'}>
            <p class="calendar-task-hint">Drag onto a date, or tap Schedule.</p>
            ${unscheduled.length ? unscheduled.map(task => `<div class="calendar-unscheduled-task" data-task-id="${escapeHtml(task.id)}" draggable="true"><span class="calendar-subject-dot" style="--task-color:${escapeHtml(db.getSubjectById(task.subjectId)?.color || '#38bdf8')}"></span><button type="button" class="calendar-unscheduled-title" data-task-id="${escapeHtml(task.id)}">${escapeHtml(task.title)}</button><span class="calendar-priority-dot priority-${escapeHtml(task.priority || 'medium')}"></span><button type="button" class="btn btn-secondary btn-sm" data-schedule-task="${escapeHtml(task.id)}">Schedule</button></div>`).join('') : '<p class="calendar-task-hint">No unscheduled tasks match these filters.</p>'}
          </div>
        </section>
        <button type="button" class="btn btn-primary btn-sm" id="calendar-add-exam">Add event</button>
        </div>
      </div>
    `;

    const bindEditButtons = root => root.querySelectorAll('[data-edit-exam]').forEach(button => {
      button.addEventListener('click', () => openExamForm(db.getExamById(button.dataset.editExam)));
    });
    bindEditButtons(container.querySelector('.calendar-selected-day'));
    container.querySelector('#calendar-add-exam').addEventListener('click', () => openExamForm());
    container.querySelector('#calendar-filter-subject').addEventListener('change', event => { taskSubject = event.target.value; render(); });
    container.querySelector('#calendar-filter-priority').addEventListener('change', event => { taskPriority = event.target.value; render(); });
    container.querySelector('#calendar-filter-status').addEventListener('change', event => { taskStatus = event.target.value; render(); });
    container.querySelector('#calendar-selected-date').addEventListener('change', event => {
      if (!validDateKey(event.target.value)) return;
      selectedDateKey = event.target.value;
      currentDate = new Date(`${selectedDateKey.slice(0, 7)}-01T00:00:00`);
      render();
    });
    container.querySelector('#calendar-add-existing').addEventListener('click', openScheduleDialog);
    container.querySelector('#calendar-new-task').addEventListener('click', () => showCreateTaskModal(render, null, selectedDateKey));
    container.querySelector('#calendar-toggle-unscheduled').addEventListener('click', () => { unscheduledOpen = !unscheduledOpen; render(); });
    container.querySelectorAll('[data-schedule-task]').forEach(button => button.addEventListener('click', () => scheduleTask(button.dataset.scheduleTask, selectedDateKey)));
    container.querySelectorAll('[data-task-id]:not([draggable="true"]):not(.calendar-unscheduled-task)').forEach(button => {
      if (button.matches('[data-schedule-task]')) return;
      button.addEventListener('click', event => { event.stopPropagation(); openTaskDetails(button.dataset.taskId); });
    });
    container.querySelectorAll('.calendar-task-pill, .calendar-detail-task').forEach(button => button.addEventListener('click', event => {
      event.stopPropagation();
      openTaskDetails(button.dataset.taskId);
    }));

    container.querySelectorAll('[draggable="true"][data-task-id]').forEach(source => {
      source.addEventListener('dragstart', event => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', source.dataset.taskId);
        source.classList.add('is-dragging');
      });
      source.addEventListener('dragend', () => {
        source.classList.remove('is-dragging');
        container.querySelectorAll('.is-drop-target').forEach(target => target.classList.remove('is-drop-target'));
      });
    });
    const bindDrop = (target, date) => {
      target.addEventListener('dragover', event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; target.classList.add('is-drop-target'); });
      target.addEventListener('dragleave', event => { if (!target.contains(event.relatedTarget)) target.classList.remove('is-drop-target'); });
      target.addEventListener('drop', event => {
        event.preventDefault();
        event.stopPropagation();
        target.classList.remove('is-drop-target');
        const taskId = event.dataTransfer.getData('text/plain');
        if (date) selectedDateKey = date;
        scheduleTask(taskId, date);
      });
    };
    container.querySelectorAll('.calendar-day-cell[data-date-key]').forEach(day => bindDrop(day, day.dataset.dateKey));
    bindDrop(container.querySelector('#calendar-unscheduled'), null);

    const chooseDate = event => {
      selectedDateKey = event.currentTarget.dataset.dateKey;
      render();
    };
    container.querySelectorAll('[data-date-key]').forEach(button => button.addEventListener('click', chooseDate));
    container.querySelectorAll('.calendar-day-cell[data-date-key]').forEach(day => day.addEventListener('keydown', event => {
      if (event.target !== day || !['Enter', ' '].includes(event.key)) return;
      event.preventDefault();
      selectedDateKey = day.dataset.dateKey;
      render();
    }));
    container.querySelector('#calendar-prev').addEventListener('click', () => { currentDate.setMonth(currentDate.getMonth() - 1); render(); });
    container.querySelector('#calendar-next').addEventListener('click', () => { currentDate.setMonth(currentDate.getMonth() + 1); render(); });
    container.querySelector('#calendar-today').addEventListener('click', () => {
      currentDate = new Date();
      currentDate.setDate(1);
      selectedDateKey = db.getTodayDate();
      render();
    });
  }

  function scheduleTask(taskId, date) {
    const task = db.getTaskById(taskId);
    if (!task || (date !== null && !validDateKey(date))) return;
    db.updateTask(task.id, { scheduledDate: date });
    window.showToast?.(date ? 'Task scheduled.' : 'Task moved to Unscheduled Tasks.');
    render();
  }

  function openScheduleDialog() {
    const tasks = db.getTasks().filter(task => task.status !== 'completed' && !taskScheduledDate(task));
    const dialog = document.createElement('dialog');
    dialog.className = 'modal';
    dialog.id = 'calendar-schedule-dialog';
    dialog.innerHTML = `<div class="modal-header"><h3>Schedule for ${formatDate(selectedDateKey)}</h3><button type="button" class="btn btn-ghost" data-close aria-label="Close">✕</button></div>
      <form class="modal-body"><label class="form-label" for="calendar-existing-task">Unscheduled task</label>
        <select id="calendar-existing-task" name="taskId" ${tasks.length ? '' : 'disabled'}>${tasks.map(task => `<option value="${escapeHtml(task.id)}">${escapeHtml(task.title)} · ${escapeHtml(db.getSubjectById(task.subjectId)?.code || 'General')}</option>`).join('')}</select>
        ${tasks.length ? '' : '<p>No unscheduled active tasks. Create a new task first.</p>'}
        <div class="calendar-day-actions"><button type="button" class="btn btn-secondary" data-close>Cancel</button><button type="submit" class="btn btn-primary" ${tasks.length ? '' : 'disabled'}>Schedule Task</button></div></form>`;
    const close = () => { dialog.close(); dialog.remove(); };
    dialog.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', close));
    dialog.addEventListener('close', () => dialog.remove());
    dialog.querySelector('form').addEventListener('submit', event => {
      event.preventDefault();
      const taskId = dialog.querySelector('select').value;
      close();
      scheduleTask(taskId, selectedDateKey);
    });
    document.body.append(dialog);
    dialog.showModal();
  }

  function openTaskDetails(taskId) {
    const task = db.getTaskById(taskId);
    if (!task) return;
    const subject = db.getSubjectById(task.subjectId);
    const scheduled = taskScheduledDate(task);
    const dialog = document.createElement('dialog');
    dialog.className = 'modal';
    dialog.id = 'calendar-task-dialog';
    dialog.innerHTML = `<div class="modal-header"><h3>${escapeHtml(task.title)}</h3><button type="button" class="btn btn-ghost" data-close aria-label="Close">✕</button></div>
      <div class="modal-body"><p>${escapeHtml(task.description || 'No description')}</p>
        <p class="calendar-task-hint">${escapeHtml(subject?.name || 'General')} · ${escapeHtml(task.priority || 'medium')} priority · ${task.status === 'completed' ? 'Completed' : 'Active'}</p>
        ${task.deadline ? `<p class="calendar-task-hint">Strict deadline: ${escapeHtml(task.deadline.replace('T', ' '))}</p>` : ''}
        <label class="form-label" for="calendar-task-date">Scheduled date</label><input type="date" id="calendar-task-date" value="${scheduled || selectedDateKey}" />
        <div class="calendar-day-actions"><button type="button" class="btn btn-secondary btn-sm" id="calendar-save-task-date">Save Date</button><button type="button" class="btn btn-ghost btn-sm" id="calendar-unschedule-task">Move to Unscheduled</button></div>
        <div class="calendar-day-actions"><button type="button" class="btn btn-secondary btn-sm" id="calendar-complete-task">${task.status === 'completed' ? 'Mark Active' : 'Complete'}</button><button type="button" class="btn btn-secondary btn-sm" id="calendar-edit-task">Edit</button><button type="button" class="btn btn-ghost btn-sm" id="calendar-delete-task">Delete</button></div>
      </div>`;
    const close = () => { dialog.close(); dialog.remove(); };
    dialog.querySelector('[data-close]').addEventListener('click', close);
    dialog.addEventListener('close', () => dialog.remove());
    dialog.querySelector('#calendar-save-task-date').addEventListener('click', () => {
      const date = dialog.querySelector('#calendar-task-date').value;
      if (!validDateKey(date)) { dialog.querySelector('#calendar-task-date').reportValidity(); return; }
      selectedDateKey = date;
      currentDate = new Date(`${date.slice(0, 7)}-01T00:00:00`);
      close();
      scheduleTask(task.id, date);
    });
    dialog.querySelector('#calendar-unschedule-task').addEventListener('click', () => { close(); scheduleTask(task.id, null); });
    dialog.querySelector('#calendar-complete-task').addEventListener('click', () => {
      const next = task.status === 'completed' ? 'not_started' : 'completed';
      db.updateTask(task.id, { status: next, completedAt: next === 'completed' ? new Date().toISOString() : null });
      close();
      render();
    });
    dialog.querySelector('#calendar-edit-task').addEventListener('click', () => { close(); showEditTaskModal(task, render); });
    dialog.querySelector('#calendar-delete-task').addEventListener('click', () => {
      if (!window.confirm(`Delete task "${task.title}"?`)) return;
      db.deleteTask(task.id);
      close();
      render();
    });
    document.body.append(dialog);
    dialog.showModal();
  }

  function openExamForm(exam = null, eventType = 'exam') {
    const dialog = document.createElement('dialog');
    dialog.className = 'modal';
    dialog.id = 'calendar-exam-dialog';
    dialog.setAttribute('aria-labelledby', 'calendar-exam-dialog-title');
    dialog.innerHTML = `
      <div class="modal-header"><h3 id="calendar-exam-dialog-title">${exam ? 'Edit event' : 'Add event'}</h3>
        <button type="button" class="btn btn-ghost" data-close aria-label="Close exam form">✕</button></div>
      <form class="modal-body" id="calendar-exam-form">
        <label class="form-group">Event type<select name="eventType">${Object.entries(CALENDAR_TYPES).map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></label>
        <div class="form-group"><label class="form-label" for="exam-title">Title</label><input id="exam-title" name="title" required maxlength="200" /></div>
        <div class="form-group"><label class="form-label" for="exam-subject">Subject</label>
          <select id="exam-subject" name="subjectId"><option value="">General</option>
            ${db.getSubjects().map(subject => `<option value="${escapeHtml(subject.id)}">${escapeHtml(subject.code || subject.name)}</option>`).join('')}
            ${exam?.subjectId && !db.getSubjectById(exam.subjectId) ? `<option value="${escapeHtml(exam.subjectId)}">Unavailable subject (kept)</option>` : ''}
          </select></div>
        <div class="form-group"><label class="form-label" for="exam-date">Date</label><input id="exam-date" name="date" type="date" required /></div>
        <p role="alert" id="exam-form-error"></p>
        <div class="calendar-exam-actions">
          ${exam ? '<button type="button" class="btn btn-ghost" id="calendar-delete-exam">Delete event</button>' : ''}
          <button type="button" class="btn btn-secondary" data-close>Cancel</button>
          <button type="submit" class="btn btn-primary">Save event</button>
        </div>
      </form>`;
    const initialDate = exam?.date?.slice(0, 10) || selectedDateKey;
    const form = dialog.querySelector('form');
    form.elements.eventType.value = exam?.eventType || eventType;
    form.elements.title.value = exam?.title || '';
    form.elements.subjectId.value = exam?.subjectId || '';
    form.elements.date.value = initialDate;
    const subjectField = form.elements.subjectId.closest('.form-group');
    const updateSubjectVisibility = () => {
      const isExam = form.elements.eventType.value === 'exam';
      subjectField.style.display = isExam ? 'none' : '';
      form.elements.subjectId.disabled = isExam;
    };
    form.elements.eventType.addEventListener('change', updateSubjectVisibility);
    updateSubjectVisibility();
    const close = () => { dialog.close(); dialog.remove(); };
    dialog.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', close));
    dialog.addEventListener('close', () => dialog.remove());
    dialog.querySelector('#calendar-delete-exam')?.addEventListener('click', () => {
      if (!window.confirm(`Delete exam "${exam.title || 'Exam'}"?`)) return;
      db.deleteExam(exam.id);
      close();
      render();
    });
    form.addEventListener('submit', event => {
      event.preventDefault();
      const title = form.elements.title.value.trim();
      if (!title) {
        dialog.querySelector('#exam-form-error').textContent = 'Enter an event title.';
        form.elements.title.focus();
        return;
      }
      const day = form.elements.date.value;

      // Retain the exact stored timestamp, reminders and other metadata when editing unrelated fields.
      const date = exam?.date && day === initialDate ? exam.date : day + (exam?.date?.includes('T') ? exam.date.slice(10) : '');
      const values = { title, date, eventType: form.elements.eventType.value, subjectId: form.elements.eventType.value === 'exam' ? exam?.subjectId || null : form.elements.subjectId.value || null };
      if (exam) db.updateExam(exam.id, values);
      else db.addExam(values);
      selectedDateKey = day;
      currentDate = new Date(`${day.slice(0, 7)}-01T00:00:00`);
      close();
      render();
    });
    container.append(dialog);
    dialog.showModal();
  }
  render();
  let lastDay = db.getTodayDate();
  const refreshDay = () => {
    const today = db.getTodayDate();
    if (today === lastDay) return;
    lastDay = today;
    render();
  };
  const dayInterval = setInterval(refreshDay, 60000);
  document.addEventListener('visibilitychange', refreshDay);
  if (params.get('view') === 'exams') container.querySelector('.calendar-selected-day').scrollIntoView({ block: 'start' });
  return () => { clearInterval(dayInterval); document.removeEventListener('visibilitychange', refreshDay); };
}
