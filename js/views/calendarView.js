/**
 * Calendar and workload view. All entries come from the user's workspace.
 */
import { db } from '../db.js';

export function renderCalendar(container) {
  let currentDate = new Date();
  currentDate.setDate(1);
  let selectedDateKey = db.getTodayDate();
  let examSearch = '';
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
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const monthLabel = currentDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const firstDay = currentDate.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const entries = new Map();
    const add = (key, type, title, minutes = 0, examId = null) => {
      if (!key) return;
      const day = key.slice(0, 10);
      if (!entries.has(day)) entries.set(day, []);
      entries.get(day).push({ type, title, minutes, examId });
    };

    db.getTasks().forEach(task => {
      if (task.status !== 'completed') add(task.deadline, 'Task', task.title, task.estimatedMinutes || task.estimatedDurationMinutes || 0);
    });
    db.getExams().forEach(exam => add(exam.date, 'Exam', exam.title || 'Exam', 0, exam.id));
    db.getTopics().forEach(topic => add(topic.reviewDate, 'Review', topic.name));
    db.getHolidays().forEach(item => add(item.date, 'Holiday', item.name));
    db.getGradeDeadlines().forEach(item => add(item.date, 'Grade deadline', item.name));
    db.getAcademicEventDays().forEach(item => add(item.date, 'Academic event', item.name));
    db.getExamWeekDays().forEach(item => add(item.date, 'Exam period', item.name));

    const selected = entries.get(selectedDateKey) || [];
    const monthEntries = [...entries.entries()]
      .filter(([key]) => key.startsWith(`${year}-${String(month + 1).padStart(2, '0')}-`))
      .sort(([a], [b]) => a.localeCompare(b));

    container.innerHTML = `
      <div class="calendar-header">
        <div>
          <h2>Calendar & Deadlines</h2>
          <p>Your tasks, exams, reviews, and dates in one place.</p>
        </div>
        <div class="calendar-controls">
          <button type="button" class="btn btn-primary btn-sm" id="calendar-add-exam">Add exam</button>
          <button type="button" class="btn btn-secondary btn-sm" id="calendar-today">Today</button>
          <button type="button" class="btn btn-secondary btn-sm" id="calendar-prev" aria-label="Previous month">◀</button>
          <strong aria-live="polite">${monthLabel}</strong>
          <button type="button" class="btn btn-secondary btn-sm" id="calendar-next" aria-label="Next month">▶</button>
        </div>
      </div>
      <div class="calendar-layout">
        <div class="calendar-month-wrap">
          <div class="calendar-grid" role="group" aria-label="${monthLabel}">
            ${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(day => `<div class="calendar-day-header">${day}</div>`).join('')}
            ${Array.from({ length: firstDay }, () => '<div class="calendar-day-cell other-month" aria-hidden="true"></div>').join('')}
            ${Array.from({ length: daysInMonth }, (_, index) => {
              const key = keyForDay(index + 1);
              const items = entries.get(key) || [];
              return `<button type="button" class="calendar-day-cell ${key === db.getTodayDate() ? 'today' : ''}" data-date-key="${key}" aria-label="${formatDate(key)}: ${items.length} item${items.length === 1 ? '' : 's'}">
                <span class="day-number">${index + 1}</span>
                ${items.slice(0, 2).map(item => `<span class="calendar-event-pill">${escapeHtml(item.title)}</span>`).join('')}
                ${items.length > 2 ? `<span class="day-workload-badge">+${items.length - 2} more</span>` : ''}
              </button>`;
            }).join('')}
          </div>
        </div>
        <section class="mobile-calendar-agenda" aria-label="${monthLabel} agenda">
          <h3>${monthLabel} agenda</h3>
          <div class="mobile-calendar-agenda-list">
            ${monthEntries.length ? monthEntries.flatMap(([key, items]) => items.map(item => `<button type="button" class="mobile-calendar-agenda-item" data-date-key="${key}">
              <span class="mobile-calendar-agenda-date">${formatDate(key)}</span>
              <span><span class="mobile-calendar-agenda-title">${escapeHtml(item.title)}</span><span class="mobile-calendar-agenda-meta">${item.type}</span></span>
            </button>`)).join('') : '<p class="card">Nothing scheduled this month. Add a task or exam to get started.</p>'}
          </div>
        </section>
        <section class="card calendar-selected-day" aria-live="polite">
          <div class="card-header">
            <h3>${formatDate(selectedDateKey)}</h3>
            <a href="#tasks" class="btn btn-secondary btn-sm">Manage tasks</a>
          </div>
          ${selected.length ? selected.map(item => `<div class="calendar-detail">
            <span class="badge">${item.type}</span>
            <span>${escapeHtml(item.title)}</span>
            ${item.minutes ? `<small>${item.minutes} min</small>` : ''}
            ${item.examId ? `<button type="button" class="btn btn-secondary btn-sm" data-edit-exam="${escapeHtml(item.examId)}">Edit exam</button>` : ''}
          </div>`).join('') : '<p>No items scheduled for this day.</p>'}
        </section>
      </div>
      <section class="card calendar-exams" id="calendar-exams" aria-labelledby="calendar-exams-heading">
        <div class="card-header"><h3 id="calendar-exams-heading">Exams</h3></div>
        <label class="form-label" for="calendar-exam-search">Find an exam</label>
        <input id="calendar-exam-search" type="search" placeholder="Search title or subject" value="${escapeHtml(examSearch)}" aria-controls="calendar-exam-list" />
        <p class="calendar-exam-hint">All dates, including past exams. Choose a date to view it in Calendar.</p>
        <div id="calendar-exam-list" aria-live="polite"></div>
      </section>`;

    const renderExamList = () => {
      const exams = db.getExams().filter(exam => {
        const subject = db.getSubjectById(exam.subjectId);
        return `${exam.title || 'Exam'} ${subject?.name || ''} ${subject?.code || ''}`.toLowerCase().includes(examSearch.toLowerCase());
      });
      container.querySelector('#calendar-exam-list').innerHTML = exams.length ? exams.map(exam => {
        const subject = db.getSubjectById(exam.subjectId);
        return `<div class="calendar-exam-row">
          <div><strong>${escapeHtml(exam.title || 'Exam')}</strong>
            <span class="calendar-exam-meta">${escapeHtml(subject?.code || subject?.name || 'General')}${exam.date ? ` · <a href="#calendar?date=${encodeURIComponent(exam.date.slice(0, 10))}&exam=${encodeURIComponent(exam.id)}">${escapeHtml(exam.date.replace('T', ' '))}</a>` : ' · No date set'}</span>
          </div>
          <button type="button" class="btn btn-secondary btn-sm" data-edit-exam="${escapeHtml(exam.id)}">Edit exam</button>
        </div>`;
      }).join('') : '<p>No exams found. Use Add exam to schedule one.</p>';
      bindEditButtons(container.querySelector('#calendar-exam-list'));
    };
    const bindEditButtons = root => root.querySelectorAll('[data-edit-exam]').forEach(button => {
      button.addEventListener('click', () => openExamForm(db.getExamById(button.dataset.editExam)));
    });
    bindEditButtons(container.querySelector('.calendar-selected-day'));
    renderExamList();
    container.querySelector('#calendar-add-exam').addEventListener('click', () => openExamForm());
    container.querySelector('#calendar-exam-search').addEventListener('input', event => {
      examSearch = event.target.value;
      renderExamList();
    });

    const chooseDate = event => {
      selectedDateKey = event.currentTarget.dataset.dateKey;
      render();
    };
    container.querySelectorAll('[data-date-key]').forEach(button => button.addEventListener('click', chooseDate));
    container.querySelector('#calendar-prev').addEventListener('click', () => { currentDate.setMonth(currentDate.getMonth() - 1); render(); });
    container.querySelector('#calendar-next').addEventListener('click', () => { currentDate.setMonth(currentDate.getMonth() + 1); render(); });
    container.querySelector('#calendar-today').addEventListener('click', () => {
      currentDate = new Date();
      currentDate.setDate(1);
      selectedDateKey = db.getTodayDate();
      render();
    });
  }

  function openExamForm(exam = null) {
    const dialog = document.createElement('dialog');
    dialog.className = 'modal';
    dialog.id = 'calendar-exam-dialog';
    dialog.setAttribute('aria-labelledby', 'calendar-exam-dialog-title');
    dialog.innerHTML = `
      <div class="modal-header"><h3 id="calendar-exam-dialog-title">${exam ? 'Edit exam' : 'Add exam'}</h3>
        <button type="button" class="btn btn-ghost" data-close aria-label="Close exam form">✕</button></div>
      <form class="modal-body" id="calendar-exam-form">
        <div class="form-group"><label class="form-label" for="exam-title">Exam title</label><input id="exam-title" name="title" required maxlength="200" /></div>
        <div class="form-group"><label class="form-label" for="exam-subject">Subject</label>
          <select id="exam-subject" name="subjectId"><option value="">General</option>
            ${db.getSubjects().map(subject => `<option value="${escapeHtml(subject.id)}">${escapeHtml(subject.code || subject.name)}</option>`).join('')}
            ${exam?.subjectId && !db.getSubjectById(exam.subjectId) ? `<option value="${escapeHtml(exam.subjectId)}">Unavailable subject (kept)</option>` : ''}
          </select></div>
        <div class="form-group"><label class="form-label" for="exam-date">Date</label><input id="exam-date" name="date" type="date" required /></div>
        <div class="form-group"><label class="form-label" for="exam-time">Time (optional)</label><input id="exam-time" name="time" type="time" /></div>
        <div class="form-group"><label class="form-label" for="exam-notes">Notes</label><textarea id="exam-notes" name="notes" rows="3"></textarea></div>
        <p role="alert" id="exam-form-error"></p>
        <div class="calendar-exam-actions">
          ${exam ? '<button type="button" class="btn btn-ghost" id="calendar-delete-exam">Delete exam</button>' : ''}
          <button type="button" class="btn btn-secondary" data-close>Cancel</button>
          <button type="submit" class="btn btn-primary">Save exam</button>
        </div>
      </form>`;
    const initialDate = exam?.date?.slice(0, 10) || selectedDateKey;
    const initialTime = exam?.date?.includes('T') ? exam.date.split('T')[1].slice(0, 5) : '';
    const form = dialog.querySelector('form');
    form.elements.title.value = exam?.title || '';
    form.elements.subjectId.value = exam?.subjectId || '';
    form.elements.date.value = initialDate;
    form.elements.time.value = initialTime;
    form.elements.notes.value = exam?.notes || '';
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
        dialog.querySelector('#exam-form-error').textContent = 'Enter an exam title.';
        form.elements.title.focus();
        return;
      }
      const day = form.elements.date.value;
      const time = form.elements.time.value;
      // Retain the exact stored timestamp, reminders and other metadata when editing unrelated fields.
      const date = exam?.date && day === initialDate && time === initialTime ? exam.date : `${day}${time ? `T${time}` : ''}`;
      const values = { title, date, subjectId: form.elements.subjectId.value || null, notes: form.elements.notes.value };
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
  if (params.get('view') === 'exams') container.querySelector('#calendar-exams').scrollIntoView({ block: 'start' });
}
