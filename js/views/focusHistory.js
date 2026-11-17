import { db } from '../db.js';
import { formatStudyMinutes } from '../studyTime.js';

const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dateLabel = new Intl.DateTimeFormat(undefined, { dateStyle: 'long' });
const monthLabel = new Intl.DateTimeFormat(undefined, { month: 'long' });
const dateFromKey = key => new Date(key + 'T12:00:00');
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

export function focusSessionsByDate(sessions) {
  const dates = new Map();
  const seen = new Set();
  for (const session of sessions) {
    if (!session.startTime) continue;
    const start = new Date(session.startTime);
    if (!Number.isFinite(start.getTime())) continue;
    const minutes = Number(session.durationSeconds != null ? session.durationSeconds / 60 : session.durationMinutes);
    if (!Number.isFinite(minutes) || minutes <= 0) continue;
    const identity = JSON.stringify([start.getTime(), session.subjectId ?? null, session.topicId ?? null, session.taskId ?? null]);
    if (seen.has(identity)) continue;
    seen.add(identity);
    const day = db.getTodayDate(start);
    if (!dates.has(day)) dates.set(day, new Map());
    const subjects = dates.get(day);
    const subjectId = session.subjectId || null;
    subjects.set(subjectId, (subjects.get(subjectId) || 0) + minutes);
  }
  return dates;
}

const totalMinutes = (subjects = new Map()) => [...subjects.values()].reduce((sum, minutes) => sum + minutes, 0);

function weeklyChart(dates, today) {
  const past7Days = Array.from({ length: 7 }, (_, index) => {
    const day = dateFromKey(today);
    day.setDate(day.getDate() + index - 6);
    return { label: weekdays[day.getDay()], minutes: totalMinutes(dates.get(db.getTodayDate(day))) };
  });
  const maxDayMinutes = Math.max(...past7Days.map(day => day.minutes), 120);
  return `
          <svg role="img" aria-label="Focus time over the last seven days" viewBox="0 0 400 160" width="100%" height="160" style="overflow: visible;">
            <!-- Grid lines -->
            <line x1="30" y1="20" x2="390" y2="20" stroke="var(--border-subtle)" stroke-dasharray="3,3" />
            <line x1="30" y1="70" x2="390" y2="70" stroke="var(--border-subtle)" stroke-dasharray="3,3" />
            <line x1="30" y1="120" x2="390" y2="120" stroke="var(--border-subtle)" />

            <!-- Bars -->
            ${past7Days.map((d, i) => {
              const x = 45 + i * 50;
              const barHeight = (d.minutes / maxDayMinutes) * 100;
              const y = 120 - barHeight;

              return `
                <g>
                  <rect x="${x}" y="${y}" width="28" height="${Math.max(4, barHeight)}" rx="4" fill="var(--accent-primary)" opacity="${d.minutes > 0 ? '0.9' : '0.2'}" />
                  <text x="${x + 14}" y="140" fill="var(--text-muted)" font-size="11" text-anchor="middle" font-family="var(--font-mono)">${d.label}</text>
                  ${d.minutes > 0 ? `<text x="${x + 14}" y="${y - 6}" fill="var(--text-primary)" font-size="10" text-anchor="middle" font-family="var(--font-mono)">${formatStudyMinutes(d.minutes)}</text>` : ''}
                </g>
              `;
            }).join('')}
          </svg>
  `;
}

function dailyChart(date, subjects) {
  const heading = `<h3>${escapeHtml(dateLabel.format(dateFromKey(date)))}</h3>`;
  const total = totalMinutes(subjects);
  if (!total) return heading + '<p>No study sessions recorded on this day.</p>';
  const rows = [...subjects].sort((a, b) => b[1] - a[1]).map(([id, minutes]) => {
    const subject = db.getSubjectById(id);
    const color = subject?.color || 'var(--accent-primary)';
    return { name: subject?.name || subject?.code || (id ? 'Removed subject' : 'General focus'), color, minutes, percent: minutes / total * 100 };
  });
  return heading + `<p>Total Focus Time <strong>${formatStudyMinutes(total)}</strong></p>
    <div class="focus-history-subjects">${rows.map(({ name, color, minutes, percent }) => `
      <div>
        <div class="focus-history-subject"><span>${escapeHtml(name)}</span><span>${formatStudyMinutes(minutes)} (${Number(percent.toFixed(1))}%)</span></div>
        <svg viewBox="0 0 100 4" preserveAspectRatio="none" width="100%" height="8" aria-hidden="true">
          <rect width="100" height="4" rx="1" fill="var(--border-subtle)" />
          <rect width="${percent}" height="4" rx="1" fill="${escapeHtml(color)}" opacity="0.9" />
        </svg>
      </div>`).join('')}</div>`;
}

export function mountFocusHistory(card) {
  const calendar = card.querySelector('#focus-history-calendar');
  const chart = card.querySelector('.focus-history-chart');
  const toggle = card.querySelector('[data-focus-action="calendar"]');
  let today = db.getTodayDate();
  let selected = today;
  let month = dateFromKey(today);
  month.setDate(1);
  let daily = false;
  let dates;

  function renderCalendar() {
    const year = month.getFullYear();
    const monthIndex = month.getMonth();
    const current = dateFromKey(today);
    const earliestYear = Math.min(year, current.getFullYear() - 100);
    const calendarDays = new Date(year, monthIndex + 1, 0).getDate();
    calendar.innerHTML = `<div class="focus-history-month">
      <button type="button" class="btn btn-ghost btn-sm" data-focus-action="prev" aria-label="Previous month" ${year <= 100 && monthIndex === 0 ? 'disabled' : ''}>‹</button>
      <select aria-label="Month" data-focus-month>${Array.from({ length: 12 }, (_, index) =>
        `<option value="${index}" ${index === monthIndex ? 'selected' : ''} ${year === current.getFullYear() && index > current.getMonth() ? 'disabled' : ''}>${monthLabel.format(new Date(2000, index, 1))}</option>`).join('')}</select>
      <select aria-label="Year" data-focus-year>${Array.from({ length: current.getFullYear() - earliestYear + 1 }, (_, index) => {
        const option = current.getFullYear() - index;
        return `<option ${option === year ? 'selected' : ''}>${option}</option>`;
      }).join('')}</select>
      <button type="button" class="btn btn-ghost btn-sm" data-focus-action="next" aria-label="Next month" ${year === current.getFullYear() && monthIndex === current.getMonth() ? 'disabled' : ''}>›</button>
    </div>
    <div class="focus-history-days">
      ${weekdays.map(day => `<span class="focus-history-weekday">${day}</span>`).join('')}
      ${'<span></span>'.repeat(month.getDay())}
      ${Array.from({ length: calendarDays }, (_, index) => {
        const day = new Date(year, monthIndex, index + 1);
        const key = db.getTodayDate(day);
        const active = dates.has(key);
        return `<button type="button" data-focus-date="${key}" aria-label="${escapeHtml(dateLabel.format(day))}${active ? ', study sessions recorded' : ''}" aria-pressed="${key === selected}" ${key === today ? 'aria-current="date"' : ''} ${key > today ? 'disabled' : ''}>${index + 1}${active ? '<span class="focus-history-dot" aria-hidden="true"></span>' : ''}</button>`;
      }).join('')}
    </div>`;
  }

  function refresh() {
    today = db.getTodayDate();
    dates = focusSessionsByDate(db.getFocusSessions());
    chart.innerHTML = daily ? dailyChart(selected, dates.get(selected)) : weeklyChart(dates, today);
    for (const button of card.querySelectorAll('.focus-history-modes button')) {
      button.setAttribute('aria-pressed', String((button.dataset.focusAction === 'daily') === daily));
    }
    card.querySelector('[data-focus-back]').hidden = !daily;
    if (!calendar.hidden) renderCalendar();
  }

  function showCalendar(open) {
    calendar.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (open) {
      month = dateFromKey(selected);
      month.setDate(1);
      renderCalendar();
      calendar.querySelector('[aria-pressed="true"]')?.focus();
    }
  }

  card.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    if (button.dataset.focusDate) {
      selected = button.dataset.focusDate;
      daily = true;
      showCalendar(false);
      toggle.focus();
      refresh();
      return;
    }
    const action = button.dataset.focusAction;
    if (action === 'calendar') showCalendar(calendar.hidden);
    if (action === 'weekly' || action === 'daily') {
      daily = action === 'daily';
      showCalendar(false);
      refresh();
      card.querySelector('.focus-history-modes [aria-pressed="true"]').focus();
    }
    if (action === 'prev' || action === 'next') {
      month.setMonth(month.getMonth() + (action === 'prev' ? -1 : 1));
      renderCalendar();
      (calendar.querySelector(`[data-focus-action="${action}"]:enabled`) || calendar.querySelector('[data-focus-month]')).focus();
    }
  });

  calendar.addEventListener('change', event => {
    const year = Number(calendar.querySelector('[data-focus-year]').value);
    const current = dateFromKey(today);
    const index = Number(calendar.querySelector('[data-focus-month]').value);
    const changedYear = event.target.hasAttribute('data-focus-year');
    month = new Date(year, year === current.getFullYear() ? Math.min(index, current.getMonth()) : index, 1);
    renderCalendar();
    calendar.querySelector(changedYear ? '[data-focus-year]' : '[data-focus-month]').focus();
  });
  card.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !calendar.hidden) {
      event.stopPropagation();
      showCalendar(false);
      toggle.focus();
    }
  });
  refresh();
  return db.subscribe(refresh);
}
