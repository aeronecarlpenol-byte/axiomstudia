import { subjectStudyTimeMarkup } from '../subjectStudyTime.js';
import { mountFocusHistory } from './focusHistory.js';
/**
 * Axiom Studia — Intelligent Daily Command Center
 * JJK × Alice in Borderland aesthetic engineering workspace.
 *
 */

import { db } from '../db.js';
import { taskScheduledDate } from '../taskSchedule.js';
import { formatStudyMinutes } from '../studyTime.js';
import { timer } from '../timer.js';
import { showCreateTaskModal, showEditTaskModal } from './tasksView.js';

export function renderDashboard(container) {
  let dbUnsubscribe = null;
  let clockInterval = null;
  let stopHistory = null;

  function render() {
    stopHistory?.();
    const profile = db.getUserProfile() || {};
    const displayName = String(profile.name || profile.preferredName || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
    const subjects = db.getSubjects() || [];
    const allTasks = db.getTasks() || [];
    const focusSessions = db.getFocusSessions() || [];
    const todayStr = db.getTodayDate();

    // ── Greeting Calculation ──
    const hour = new Date().getHours();
    let greeting = 'Good morning';
    if (hour >= 12 && hour < 17) greeting = 'Good afternoon';
    else if (hour >= 17) greeting = 'Good evening';

    // ── Metrics Calculation ──
    const completedToday = allTasks.filter(t => t.status === 'completed' && (!t.completedAt || db.isSameLocalDate(t.completedAt, todayStr))).length;
    const activeTasks = allTasks.filter(task => task.status !== 'completed');
    const todayTasks = activeTasks.filter(task => taskScheduledDate(task) === todayStr ||
      task.deadline === todayStr || db.isSameLocalDate(task.deadline, todayStr));
    const remainingToday = todayTasks.length;

    const todaySessions = focusSessions.filter(fs => fs.startTime && db.isSameLocalDate(fs.startTime, todayStr));
    const todayMins = todaySessions.reduce((acc, fs) => acc + (fs.durationMinutes || 0), 0);

    const formatMins = formatStudyMinutes;

    // ── Today's Priorities Sorting & Filtering ──
    const priorityWeights = { urgent: 0, high: 1, medium: 2, low: 3 };

    const priorityTasks = todayTasks.map(t => {
      const deadlineStatus = db.getTaskDeadlineStatus(t);
      const subject = subjects.find(s => s.id === t.subjectId);
      return {
        ...t,
        deadlineStatus,
        scheduledToday: taskScheduledDate(t) === todayStr,
        subject,
        priorityRank: priorityWeights[t.priority] ?? 2
      };
    });

    priorityTasks.sort((a, b) => {
      // 1. Overdue first
      if (a.deadlineStatus === 'overdue' && b.deadlineStatus !== 'overdue') return -1;
      if (b.deadlineStatus === 'overdue' && a.deadlineStatus !== 'overdue') return 1;

      // 2. Due today second
      if (a.deadlineStatus === 'due_today' && b.deadlineStatus !== 'due_today') return -1;
      if (b.deadlineStatus === 'due_today' && a.deadlineStatus !== 'due_today') return 1;

      if (a.scheduledToday && !b.scheduledToday) return -1;
      if (b.scheduledToday && !a.scheduledToday) return 1;

      // 3. Priority weight
      if (a.priorityRank !== b.priorityRank) return a.priorityRank - b.priorityRank;

      // 4. Earliest deadline
      if (a.deadline && b.deadline) return new Date(a.deadline) - new Date(b.deadline);
      if (a.deadline) return -1;
      if (b.deadline) return 1;
      return 0;
    });

    // ── Deadline Awareness Section ──
    // Tasks and exams with approaching deadlines
    const upcomingDeadlines = [];

    for (const t of activeTasks) {
      const plannedDate = taskScheduledDate(t);
      const deadline = t.deadline || (plannedDate >= todayStr ? plannedDate : null);
      if (!deadline) continue;
      const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(deadline);
      const timestamp = new Date(isDateOnly ? deadline + 'T00:00:00' : deadline).getTime();
      if (!Number.isFinite(timestamp)) continue;
      const status = t.deadline ? db.getTaskDeadlineStatus(t) : 'scheduled';
      const subject = subjects.find(s => s.id === t.subjectId);
      upcomingDeadlines.push({
        id: t.id,
        title: t.title,
        type: 'task',
        taskType: t.taskType || 'assignment',
        subjectCode: subject?.code || 'ACAD',
        subjectColor: subject?.color || '#38bdf8',
        deadline,
        status,
        timestamp
      });
    }

    // Add upcoming exams
    const exams = db.getExams() || [];
    exams.forEach(ex => {
      if (ex.date) {
        const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(ex.date) ? ex.date + 'T00:00:00' : ex.date);
        if (!Number.isFinite(d.getTime())) return;
        const subject = subjects.find(s => s.id === ex.subjectId);
        if (db.getTodayDate(d) < todayStr) return;
        const now = Date.now();
        const diffHours = (d.getTime() - now) / 3600000;
        let status = 'upcoming';
        if (diffHours < 0 && diffHours > -24) status = 'due_today';
        else if (diffHours < 0) status = 'overdue';
        else if (diffHours < 24) status = 'due_today';
        else if (diffHours < 48) status = 'due_tomorrow';

        upcomingDeadlines.push({
          id: ex.id,
          title: ex.title || 'Event',
          type: 'exam',
          taskType: 'exam',
          subjectCode: subject?.code || 'EXAM',
          subjectColor: subject?.color || '#ec4899',
          deadline: ex.date,
          status,
          timestamp: d.getTime()
        });
      }
    });

    upcomingDeadlines.sort((a, b) => Number(a.status === 'overdue') - Number(b.status === 'overdue') || a.timestamp - b.timestamp);
    const urgentCount = upcomingDeadlines.filter(d => d.status === 'overdue' || d.status === 'due_today').length;

    container.innerHTML = `
      <div class="dash-command-center">

        <!-- ── 1. GREETING & TELEMETRY HEADER ───────────────────────────── -->
        <header class="dash-header">
          <div class="dash-header-left">
            <div class="arena-eyebrow" aria-hidden="true"><span class="arena-game-pill">♠ STUDY ARENA</span><span class="arena-suit-row"><span>♥</span><span>♦</span><span>♣</span></span></div>
            <div class="greeting-time">${greeting}${displayName ? `, ${displayName}` : ''}</div>
            <h1 class="greeting-text">AXIOM STUDIA</h1>
            <div class="dash-identity-sub">
              <span>${[profile.section, profile.major, profile.semester].filter(Boolean).map(value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])).join(' • ') || 'Set up your profile in Settings to personalize this space.'}</span>
            </div>
          </div>

          <div class="dash-clock-card bracket-corners">
            <div id="dash-live-date" class="dash-clock-date">${new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' })}</div>
            <div id="dash-live-clock" class="dash-clock-time">${new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
            <div class="dash-clock-badge">SYSTEM ACTIVE</div>
          </div>
        </header>

        <!-- ── 2. SUMMARY METRIC STRIP ─────────────────────────────────── -->
        <section class="dash-stats-bar" aria-label="Daily Study Summary">
          <div class="dash-stat-box" title="Completed tasks today">
            <div class="dash-stat-label">COMPLETED TODAY</div>
            <div class="dash-stat-val" style="color: var(--accent-emerald);">${completedToday}</div>
            <div class="dash-stat-sub">tasks finished</div>
          </div>

          <div class="dash-stat-box" title="Pending tasks due today">
            <div class="dash-stat-label">DUE TODAY</div>
            <div class="dash-stat-val" style="color: ${remainingToday > 0 ? 'var(--accent-amber)' : 'var(--text-secondary)'};">${remainingToday}</div>
            <div class="dash-stat-sub">tasks remaining</div>
          </div>

          <div class="dash-stat-box" title="Urgent upcoming deadlines">
            <div class="dash-stat-label">URGENT DEADLINES</div>
            <div class="dash-stat-val" style="color: ${urgentCount > 0 ? 'var(--accent-danger)' : 'var(--accent-cyan)'};">${urgentCount}</div>
            <div class="dash-stat-sub">overdue or due today</div>
          </div>

          <div class="dash-stat-box" title="Study time today">
            <div class="dash-stat-label">STUDY TIME TODAY</div>
            <div class="dash-stat-val" style="color: var(--accent-primary);">${formatMins(todayMins)}</div>
            <div class="dash-stat-sub">tracked focus time</div>
          </div>
        </section>

        <!-- ── 3. MAIN COMMAND TWO-COLUMN GRID ─────────────────────────── -->
        <div class="dash-tactical-grid">
          <section class="card dash-panel-priorities" aria-label="Today's Priorities">
            <div class="card-header">
              <div>
                <div class="card-title" style="display: flex; align-items: center; gap: 8px;">
                  🎯 Today's Priorities
                  <span class="dash-priority-count">${priorityTasks.length} pending</span>
                </div>
              </div>
              <div class="dash-panel-actions">
                <button class="btn btn-primary btn-sm" id="btn-dash-add-task">+ New Task</button>
                <a href="#tasks" class="btn btn-secondary btn-sm">All Tasks →</a>
              </div>
            </div>

            ${priorityTasks.length === 0 ? `
              <div class="dash-priorities-empty">
                <div class="dash-empty-icon">✓</div>
                <div class="dash-empty-title">All caught up for today!</div>
                <p class="dash-empty-sub">No unfinished tasks are scheduled or due today.</p>
                <button class="btn btn-secondary btn-sm" id="btn-dash-add-task-empty" style="margin-top: var(--space-2);">+ Add Study Task</button>
              </div>
            ` : `
              <div class="dash-priority-list">
                ${priorityTasks.map(task => {
                  const dlStatus = task.deadlineStatus;
                  const isOverdue = dlStatus === 'overdue';
                  const isDueToday = dlStatus === 'due_today';
                  const isDueTomorrow = dlStatus === 'due_tomorrow';

                  let statusChip = '';
                  if (isOverdue) statusChip = '<span class="task-status-chip chip-overdue">🔴 OVERDUE</span>';
                  else if (isDueToday) statusChip = '<span class="task-status-chip chip-due-today">🟠 DUE TODAY</span>';
                  else if (task.scheduledToday) statusChip = '<span class="task-status-chip chip-due-today">📅 PLANNED TODAY</span>';
                  else if (isDueTomorrow) statusChip = '<span class="task-status-chip chip-due-tomorrow">🟡 TOMORROW</span>';
                  else statusChip = taskScheduledDate(task) ? '<span class="task-status-chip chip-upcoming">SCHEDULED</span>' : '<span class="task-status-chip chip-upcoming">SCHEDULED</span>';

                  return `
                    <div class="dash-priority-item ${isOverdue ? 'priority-overdue' : ''} ${isDueToday ? 'priority-today' : ''}" data-task-id="${task.id}">
                      <button class="dash-task-check-btn" data-action="dash-toggle-task" data-task-id="${task.id}" title="Mark completed" aria-label="Mark completed">
                        <span class="dash-check-mark">✓</span>
                      </button>

                      <div class="dash-task-main">
                        <div class="dash-task-title-row">
                          <span class="dash-task-title" title="${task.title}">${task.title}</span>
                        </div>
                        <div class="dash-task-meta-row">
                          ${task.subject ? `
                            <span class="badge" style="background: ${task.subject.color || '#38bdf8'}20; color: ${task.subject.color || '#38bdf8'}; font-weight: 700; font-size: 0.65rem; padding: 1px 6px;">
                              ${task.subject.code}
                            </span>
                          ` : ''}
                          ${statusChip}
                          ${taskScheduledDate(task) ? `<span class="dash-task-deadline-time">Plan: ${taskScheduledDate(task)}</span>` : ''}
                          <span class="badge badge-secondary" style="font-size: 0.62rem; padding: 1px 5px;">
                            ${(task.priority || 'medium').toUpperCase()}
                          </span>
                          ${task.deadline ? `
                            <span class="dash-task-deadline-time">
                              📅 ${new Date(task.deadline).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                              ${task.deadline.includes('T') ? new Date(task.deadline).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : ''}
                            </span>
                          ` : ''}
                          ${task.estimatedDurationMinutes ? `
                            <span class="dash-task-est">⏱ ~${task.estimatedDurationMinutes}m</span>
                          ` : ''}
                        </div>
                      </div>

                      <div class="dash-task-actions">
                        <button class="btn btn-secondary btn-sm dash-btn-task-action" data-action="dash-study-task" data-task-id="${task.id}" data-subject-id="${task.subjectId || ''}" title="Study this task in workspace">
                          ▶ Study
                        </button>
                        <button class="btn btn-ghost btn-sm dash-btn-task-action" data-action="dash-edit-task" data-task-id="${task.id}" title="Edit task details">
                          ✏
                        </button>
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            `}
          </section>

          <section class="card dash-panel-deadlines" aria-label="Upcoming Deadlines">
            <div class="card-header">
              <div>
                <div class="card-title">⏳ Upcoming Events & Deadlines</div>
              </div>
              <a href="#calendar" class="btn btn-secondary btn-sm">Calendar →</a>
            </div>

            ${upcomingDeadlines.length === 0 ? `
              <div class="dash-deadlines-empty">
                <span>No upcoming tasks or exams.</span>
              </div>
            ` : `
              <div class="dash-deadline-list">
                ${upcomingDeadlines.map(item => {
                  const isUrgent = item.status === 'overdue' || item.status === 'due_today';
                  let label = item.status === 'scheduled' ? 'Scheduled' : 'Upcoming';
                  if (item.status === 'overdue') label = 'OVERDUE';
                  else if (item.status === 'due_today') label = 'DUE TODAY';
                  else if (item.status === 'due_tomorrow') label = 'TOMORROW';

                  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(item.deadline) ? item.deadline + 'T00:00:00' : item.deadline);
                  const formattedDate = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                  const formattedTime = item.deadline.includes('T') ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '';

                  return `
                    <div class="dash-deadline-item ${isUrgent ? 'deadline-urgent' : ''}">
                      <div class="dash-deadline-badge-col">
                        <span class="badge" style="background: ${item.subjectColor}22; color: ${item.subjectColor}; font-weight: 800; font-size: 0.68rem;">
                          ${item.subjectCode}
                        </span>
                      </div>
                      <div class="dash-deadline-content">
                        <div class="dash-deadline-title" title="${item.title}">${item.title}</div>
                        <div class="dash-deadline-sub">
                          <span class="dash-deadline-tag ${item.status}">${label}</span>
                          <span class="dash-deadline-when">${formattedDate} ${formattedTime ? `· ${formattedTime}` : ''}</span>
                        </div>
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            `}
          </section>
        </div>

    <div class="analytics-charts">
      <div class="card focus-history">
        <div class="card-header">
          <div class="card-title">📊 7-Day Focus Distribution</div>
          <button type="button" class="btn btn-ghost btn-sm" data-focus-action="calendar" aria-label="Choose a focus history date" aria-expanded="false" aria-controls="focus-history-calendar">📅</button>
        </div>
        <div class="focus-history-modes" role="group" aria-label="Focus distribution view">
          <button type="button" class="btn btn-secondary btn-sm" data-focus-action="weekly">7-Day View</button>
          <button type="button" class="btn btn-secondary btn-sm" data-focus-action="daily">Daily View</button>
        </div>
        <div id="focus-history-calendar" class="focus-history-calendar" hidden></div>
        <div class="focus-history-chart" aria-live="polite"></div>
        <button type="button" class="btn btn-ghost btn-sm" data-focus-action="weekly" data-focus-back hidden>Back to Current 7 Days</button>
      </div>

      <div data-subject-study-time>${subjectStudyTimeMarkup(subjects, focusSessions, 'dash-progress-title')}</div>
    </div>



      </div>
    `;

    stopHistory = mountFocusHistory(container.querySelector('.focus-history'));

    // ── EVENT LISTENERS ─────────────────────────────────────────────

    // Add Task Buttons
    const openAddTask = () => showCreateTaskModal(render);
    container.querySelector('#btn-dash-add-task')?.addEventListener('click', openAddTask);
    container.querySelector('#btn-dash-add-task-empty')?.addEventListener('click', openAddTask);

    // Task Checkbox: Complete Task from Dashboard
    container.querySelectorAll('[data-action="dash-toggle-task"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const taskId = e.currentTarget.getAttribute('data-task-id');
        const task = db.getTaskById(taskId);
        if (task) {
          const next = task.status === 'completed' ? 'not_started' : 'completed';
          db.updateTask(taskId, {
            status: next,
            completedAt: next === 'completed' ? new Date().toISOString() : null
          });
          window.showToast?.(next === 'completed' ? '✓ Task completed!' : 'Task reopened.');
          // Auto-sync across views handled via db.subscribe, but render() triggers immediate UI update
          render();
        }
      });
    });

    // Study Task: Jump to Subject Workspace with task loaded in timer
    container.querySelectorAll('[data-action="dash-study-task"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const taskId = e.currentTarget.getAttribute('data-task-id');
        const subId = e.currentTarget.getAttribute('data-subject-id');
        if (subId) {
          sessionStorage.setItem('axiom_target_subject_id', subId);
          timer.setContext(subId, null, taskId);
          window.location.hash = '#subjects';
        }
      });
    });

    // Edit Task
    container.querySelectorAll('[data-action="dash-edit-task"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const taskId = e.currentTarget.getAttribute('data-task-id');
        const task = db.getTaskById(taskId);
        if (task) {
          showEditTaskModal(task, render);
        }
      });
    });

  }

  // Initial render
  render();

  // Reactive synchronization: listen to db updates so dashboard immediately updates
  dbUnsubscribe = db.subscribe(() => {
    if (container.isConnected) {
      render();
    }
  });

  // Real-time live clock ticker (lightweight, runs every second)
  let lastCheckedDay = new Date().getDate();
  clockInterval = setInterval(() => {
    if (!container.isConnected) {
      clearInterval(clockInterval);
      return;
    }
    const liveClock = container.querySelector('#dash-live-clock');
    const liveDate = container.querySelector('#dash-live-date');
    const cur = new Date();
    if (liveClock) {
      liveClock.textContent = cur.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
    if (liveDate) {
      liveDate.textContent = cur.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' });
    }

    if (cur.getDate() !== lastCheckedDay) {
      lastCheckedDay = cur.getDate();
      render();
    }
  }, 1000);

  // Router unmount cleanup
  return () => {
    stopHistory?.();
    if (dbUnsubscribe) {
      dbUnsubscribe();
      dbUnsubscribe = null;
    }
    if (clockInterval) {
      clearInterval(clockInterval);
      clockInterval = null;
    }
  };
}
