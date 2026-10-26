/**
 * Calendar and workload view. All entries come from the user's workspace.
 */
import { db } from '../db.js';

export function renderCalendar(container) {
  let currentDate = new Date();
  currentDate.setDate(1);
  let selectedDateKey = db.getTodayDate();

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
    const add = (key, type, title, minutes = 0) => {
      if (!key) return;
      const day = key.slice(0, 10);
      if (!entries.has(day)) entries.set(day, []);
      entries.get(day).push({ type, title, minutes });
    };

    db.getTasks().forEach(task => {
      if (task.status !== 'completed') add(task.deadline, 'Task', task.title, task.estimatedMinutes || task.estimatedDurationMinutes || 0);
    });
    db.getExams().forEach(exam => add(exam.date, 'Exam', exam.title));
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
          </div>`).join('') : '<p>No items scheduled for this day.</p>'}
        </section>
      </div>`;

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
  render();
}
