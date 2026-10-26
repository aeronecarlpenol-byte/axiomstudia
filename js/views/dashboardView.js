/**
 * Axiom Studia — Intelligent Daily Command Center
 * JJK × Alice in Borderland aesthetic engineering workspace.
 *
 * Structure:
 * 1. Compact Header & Live Telemetry (Greeting, date, clock)
 * 2. Summary Status Bar (Tasks completed/remaining, study time today, urgent deadlines)
 * 3. Primary Two-Column Tactical Grid:
 *    - Left: Continue Studying (Momentum recovery) & Today's Priorities (Overdue + Due Today + Next up)
 *    - Right: Upcoming Deadlines (Compact countdown tracker) & Quotes of the Day
 * 4. Weekly Class Schedule & Course Progress Overview
 */

import { db } from '../db.js';
import { getQuoteForDate } from '../dailyQuotes.js';
import { timer } from '../timer.js';
import { showCreateTaskModal, showEditTaskModal } from './tasksView.js';

export function renderDashboard(container) {
  let dbUnsubscribe = null;
  let clockInterval = null;

  function render() {
    const profile = db.getUserProfile() || {};
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
    const remainingToday = allTasks.filter(t => t.status !== 'completed' && t.deadline && db.isSameLocalDate(t.deadline, todayStr)).length;

    const todaySessions = focusSessions.filter(fs => fs.startTime && db.isSameLocalDate(fs.startTime, todayStr));
    const todayMins = todaySessions.reduce((acc, fs) => acc + (fs.durationMinutes || 0), 0);

    const formatMins = (m) => {
      if (m === 0) return '0m';
      if (m < 60) return `${m}m`;
      const hrs = Math.floor(m / 60);
      const rem = m % 60;
      return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
    };

    // ── Today's Priorities Sorting & Filtering ──
    // Order:
    // 1. Overdue incomplete tasks
    // 2. High-priority tasks due today (urgent, high)
    // 3. Other tasks due today
    // 4. Incomplete tasks from earlier days / next upcoming
    const priorityWeights = { urgent: 0, high: 1, medium: 2, low: 3 };

    const activeTasks = allTasks.filter(t => t.status !== 'completed');

    const categorizedTasks = activeTasks.map(t => {
      const deadlineStatus = db.getTaskDeadlineStatus(t);
      const subject = subjects.find(s => s.id === t.subjectId);
      return {
        ...t,
        deadlineStatus,
        subject,
        priorityRank: priorityWeights[t.priority] ?? 2
      };
    });

    categorizedTasks.sort((a, b) => {
      // 1. Overdue first
      if (a.deadlineStatus === 'overdue' && b.deadlineStatus !== 'overdue') return -1;
      if (b.deadlineStatus === 'overdue' && a.deadlineStatus !== 'overdue') return 1;

      // 2. Due today second
      if (a.deadlineStatus === 'due_today' && b.deadlineStatus !== 'due_today') return -1;
      if (b.deadlineStatus === 'due_today' && a.deadlineStatus !== 'due_today') return 1;

      // 3. Priority weight
      if (a.priorityRank !== b.priorityRank) return a.priorityRank - b.priorityRank;

      // 4. Earliest deadline
      if (a.deadline && b.deadline) return new Date(a.deadline) - new Date(b.deadline);
      if (a.deadline) return -1;
      if (b.deadline) return 1;
      return 0;
    });

    // Top priorities to display (up to 6)
    const priorityTasks = categorizedTasks.slice(0, 6);

    // ── Deadline Awareness Section ──
    // Tasks and exams with approaching deadlines
    const upcomingDeadlines = [];

    // Add active tasks with deadlines
    activeTasks.filter(t => t.deadline).forEach(t => {
      const status = db.getTaskDeadlineStatus(t);
      const subject = subjects.find(s => s.id === t.subjectId);
      upcomingDeadlines.push({
        id: t.id,
        title: t.title,
        type: 'task',
        taskType: t.taskType || 'assignment',
        subjectCode: subject?.code || 'ACAD',
        subjectColor: subject?.color || '#38bdf8',
        deadline: t.deadline,
        status,
        timestamp: new Date(t.deadline).getTime()
      });
    });

    // Add upcoming exams
    const exams = db.getExams() || [];
    exams.forEach(ex => {
      if (ex.date) {
        const d = new Date(ex.date);
        const subject = subjects.find(s => s.id === ex.subjectId);
        const now = Date.now();
        const diffHours = (d.getTime() - now) / 3600000;
        let status = 'upcoming';
        if (diffHours < 0 && diffHours > -24) status = 'due_today';
        else if (diffHours < 0) status = 'overdue';
        else if (diffHours < 24) status = 'due_today';
        else if (diffHours < 48) status = 'due_tomorrow';

        upcomingDeadlines.push({
          id: ex.id,
          title: ex.title || 'Exam',
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

    upcomingDeadlines.sort((a, b) => a.timestamp - b.timestamp);
    const topDeadlines = upcomingDeadlines.slice(0, 5);
    const urgentCount = upcomingDeadlines.filter(d => d.status === 'overdue' || d.status === 'due_today').length;

    // ── Continue Studying Resolution ──
    const continueTarget = db.getContinueStudyingDestination();

    // ── Daily Quote ──
    const dailyQuote = getQuoteForDate();

    // ── Progress by Subject ──
    const subjectProgressList = subjects.map(s => {
      const sTasks = allTasks.filter(t => t.subjectId === s.id);
      const doneTasks = sTasks.filter(t => t.status === 'completed');
      const pendingTasks = sTasks.filter(t => t.status !== 'completed');
      const pct = sTasks.length > 0 ? Math.round((doneTasks.length / sTasks.length) * 100) : 0;

      const sSessions = focusSessions.filter(fs => fs.subjectId === s.id);
      const totalMins = sSessions.reduce((acc, fs) => acc + (fs.durationMinutes || 0), 0);
      const subTodaySessions = sSessions.filter(fs => fs.startTime && db.isSameLocalDate(fs.startTime, todayStr));
      const subTodayMins = subTodaySessions.reduce((acc, fs) => acc + (fs.durationMinutes || 0), 0);

      return {
        subject: s,
        totalTasks: sTasks.length,
        doneTasks: doneTasks.length,
        pendingTasks: pendingTasks.length,
        pct,
        totalTimeFormatted: formatMins(totalMins),
        todayTimeFormatted: formatMins(subTodayMins),
      };
    });

    container.innerHTML = `
      <div class="dash-command-center">

        <!-- ── 1. GREETING & TELEMETRY HEADER ───────────────────────────── -->
        <header class="dash-header">
          <div class="dash-header-left">
            <div class="arena-eyebrow" aria-hidden="true"><span class="arena-game-pill">♠ STUDY ARENA</span><span class="arena-suit-row"><span>♥</span><span>♦</span><span>♣</span></span></div>
            <div class="greeting-time">${greeting}${profile.preferredName || profile.name ? `, ${profile.preferredName || profile.name}` : ''}</div>
            <h1 class="greeting-text">AXIOM STUDIA</h1>
            <div class="dash-identity-sub">
              <span>${[profile.studentId, profile.major, profile.semester].filter(Boolean).join(' • ') || 'Set up your profile in Settings to personalize this space.'}</span>
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

          <!-- ── Left Column: Continue Studying + Today's Priorities ──── -->
          <div class="dash-col-primary">

            <!-- ── CONTINUE STUDYING BANNER ────────────────────────────── -->
            <section class="dash-continue-card" aria-label="Continue Studying">
              <div class="dash-continue-header">
                <div class="dash-continue-badge">
                  <span class="dash-pulse-dot"></span>
                  CONTINUE STUDYING
                </div>
                ${continueTarget ? `<span class="dash-continue-reason">${continueTarget.reason}</span>` : ''}
              </div>

              <div class="dash-continue-body">
                ${continueTarget ? `
                  <div class="dash-continue-subject">
                    <span class="dash-continue-icon">${continueTarget.subject.icon || '📚'}</span>
                    <div style="min-width: 0;">
                      <div class="dash-continue-title">${continueTarget.subject.code} · ${continueTarget.subject.name}</div>
                      <div class="dash-continue-details">
                        ${continueTarget.pdfFilename ? `📄 Document: <b>${continueTarget.pdfFilename}</b> (p. ${continueTarget.page || 1})` : ''}
                        ${continueTarget.task ? `🎯 Mission: <b>${continueTarget.task.title}</b>` : ''}
                        ${!continueTarget.pdfFilename && !continueTarget.task ? `Academic Workspace: ${continueTarget.subject.instructor || 'Faculty'}` : ''}
                      </div>
                    </div>
                  </div>
                  <button class="btn btn-primary dash-btn-resume" id="btn-dash-continue-studying"
                    data-subject-id="${continueTarget.subject.id}"
                    data-resource-id="${continueTarget.resource?.id || ''}"
                    data-task-id="${continueTarget.taskId || ''}">
                    Resume Study ➔
                  </button>
                ` : `
                  <div class="dash-continue-empty">
                    <span>No study session recorded yet. Select any subject workspace to begin.</span>
                    <a href="#subjects" class="btn btn-primary btn-sm">Open Workspace →</a>
                  </div>
                `}
              </div>
            </section>

            <!-- ── TODAY'S PRIORITIES ─────────────────────────────────── -->
            <section class="card dash-panel-priorities" aria-label="Today's Priorities">
              <div class="card-header" style="flex-wrap: wrap; gap: var(--space-2);">
                <div>
                  <div class="card-title" style="display: flex; align-items: center; gap: 8px;">
                    🎯 Today's Priorities
                    <span class="dash-priority-count">${priorityTasks.length} pending</span>
                  </div>
                  <div class="card-subtitle">Overdue, due today, and critical missions in optimal study order</div>
                </div>
                <div style="display: flex; gap: var(--space-2); align-items: center;">
                  <button class="btn btn-primary btn-sm" id="btn-dash-add-task">+ New Task</button>
                  <a href="#tasks" class="btn btn-secondary btn-sm">All Tasks →</a>
                </div>
              </div>

              ${priorityTasks.length === 0 ? `
                <div class="dash-priorities-empty">
                  <div class="dash-empty-icon">✓</div>
                  <div class="dash-empty-title">All caught up for today!</div>
                  <p class="dash-empty-sub">No overdue items or pending tasks due today. Add a new study topic or review upcoming lectures.</p>
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
                    else if (isDueTomorrow) statusChip = '<span class="task-status-chip chip-due-tomorrow">🟡 TOMORROW</span>';
                    else statusChip = '<span class="task-status-chip chip-upcoming">UPCOMING</span>';

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
          </div>

          <!-- ── Right Column: Upcoming Deadlines + Quotes of the Day ─── -->
          <div class="dash-col-secondary">

            <!-- ── UPCOMING DEADLINES (Awareness Section) ─────────────── -->
            <section class="card dash-panel-deadlines" aria-label="Upcoming Deadlines">
              <div class="card-header">
                <div>
                  <div class="card-title">⏳ Approaching Deadlines</div>
                  <div class="card-subtitle">Assignments, labs, & exam timeline</div>
                </div>
                <a href="#calendar" class="btn btn-ghost btn-sm" style="font-size: 0.72rem;">Calendar →</a>
              </div>

              ${topDeadlines.length === 0 ? `
                <div class="dash-deadlines-empty">
                  <span>No upcoming deadlines scheduled in the next 7 days.</span>
                </div>
              ` : `
                <div class="dash-deadline-list">
                  ${topDeadlines.map(item => {
                    const isUrgent = item.status === 'overdue' || item.status === 'due_today';
                    let label = 'Upcoming';
                    if (item.status === 'overdue') label = 'OVERDUE';
                    else if (item.status === 'due_today') label = 'DUE TODAY';
                    else if (item.status === 'due_tomorrow') label = 'TOMORROW';

                    const d = new Date(item.deadline);
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

            <!-- ── QUOTES OF THE DAY ──────────────────────────────────── -->
            <section class="card dash-panel-quote" aria-label="Quote of the day">
              <div class="card-header">
                <div class="card-title">Quote of the day</div>
                <span class="badge badge-indigo">${dailyQuote.author}</span>
              </div>
              <div class="dash-quote-body">
                <div class="dash-quote-text">"${dailyQuote.quote}"</div>
                <div class="dash-quote-author">— ${dailyQuote.author}, ${dailyQuote.work}</div>
                ${dailyQuote.context ? `
                  <div class="dash-quote-context">
                    <b>Reading note:</b> ${dailyQuote.context}
                  </div>
                ` : ''}
              </div>
            </section>

          </div>
        </div>

        <!-- ── 4. WEEKLY CLASS SCHEDULE ─────────────────────────────────── -->
        <section class="card" style="margin-top: var(--space-6); margin-bottom: var(--space-6);">
          <div class="card-header">
            <div>
              <div class="card-title">🏫 Class Schedule</div>
              <div class="card-subtitle">Schedules from your subjects</div>
            </div>
            <a href="#subjects" class="btn btn-secondary btn-sm">Subjects Workspace →</a>
          </div>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: var(--space-3);">
            ${subjects.filter(subject => subject.schedule).length ? subjects.filter(subject => subject.schedule).map(subject => `
              <div class="dash-sched-card">
                <strong>${subject.code || subject.name}</strong>
                <div style="color: var(--text-secondary); margin-top: 4px;">${subject.schedule}</div>
              </div>
            `).join('') : '<p>No classes scheduled yet. Add a subject and its schedule to see it here.</p>'}
          </div>
        </section>

        <!-- ── 5. MY PROGRESS EACH SUBJECT ──────────────────────────────── -->
        <section class="card" style="margin-bottom: var(--space-6);">
          <div class="card-header">
            <div>
              <div class="card-title">📊 My Progress Each Subject</div>
            </div>
            <a href="#subjects" class="btn btn-primary btn-sm">All Workspaces →</a>
          </div>

          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(310px, 1fr)); gap: var(--space-4);">
            ${subjectProgressList.map(sp => {
              const s = sp.subject;
              return `
                <div class="card" style="margin: 0; background: var(--bg-surface); border: 1px solid var(--border-card); box-shadow: 0 0 12px rgba(18, 62, 120, 0.5);">
                  <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: var(--space-2); margin-bottom: var(--space-2);">
                    <div>
                      <span class="badge" style="background: ${s.color || '#38bdf8'}22; color: ${s.color || '#38bdf8'}; font-weight: 700;">${s.code}</span>
                      <div style="font-weight: 700; font-size: 0.95rem; color: var(--text-primary); margin-top: 4px;">${s.name}</div>
                      <div style="font-size: 0.74rem; color: var(--text-muted); margin-top: 2px;">
                        ${s.instructor ? `Instructor: ${s.instructor} · ` : ''}${s.units ? `${s.units} Units` : ''}
                      </div>
                    </div>
                    <button class="btn btn-secondary btn-sm" data-action="go-subject-workspace" data-subject-id="${s.id}" style="font-size: 0.72rem; padding: 3px 8px; flex-shrink: 0;">
                      Workspace ↗
                    </button>
                  </div>

                  <!-- Progress Bar -->
                  <div style="margin: var(--space-3) 0 var(--space-2);">
                    <div style="display: flex; justify-content: space-between; font-size: 0.74rem; margin-bottom: 4px;">
                      <span style="color: var(--text-muted);">Tasks Completed</span>
                      <span style="font-family: var(--font-mono); font-weight: 700; color: ${s.color || '#38bdf8'};">${sp.pct}% (${sp.doneTasks}/${sp.totalTasks})</span>
                    </div>
                    <div class="progress-bar" style="height: 6px; background: rgba(255,255,255,0.06);">
                      <div class="progress-fill" style="width: ${sp.pct}%; background: ${s.color || '#38bdf8'};"></div>
                    </div>
                  </div>

                  <!-- Study Time Stats Strip -->
                  <div style="display: flex; justify-content: space-between; background: rgba(0,0,0,0.25); padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm); font-size: 0.75rem; margin-top: var(--space-2);">
                    <div>
                      <span style="color: var(--text-muted);">Today: </span>
                      <b style="font-family: var(--font-mono); color: #ffffff;">${sp.todayTimeFormatted}</b>
                    </div>
                    <div style="padding-left: var(--space-3);">
                      <span style="color: var(--text-muted);">Total: </span>
                      <b style="font-family: var(--font-mono); color: #ffffff;">${sp.totalTimeFormatted}</b>
                    </div>
                    <div style="padding-left: var(--space-3);">
                      <span style="color: var(--text-muted);">Pending: </span>
                      <b style="font-family: var(--font-mono); color: ${sp.pendingTasks > 0 ? 'var(--accent-amber)' : 'var(--accent-emerald)'};">${sp.pendingTasks}</b>
                    </div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </section>

      </div>
    `;

    // ── EVENT LISTENERS ─────────────────────────────────────────────

    // Continue Studying Button
    container.querySelector('#btn-dash-continue-studying')?.addEventListener('click', (e) => {
      const subId = e.currentTarget.getAttribute('data-subject-id');
      const resId = e.currentTarget.getAttribute('data-resource-id');
      const taskId = e.currentTarget.getAttribute('data-task-id');
      if (subId) {
        sessionStorage.setItem('axiom_target_subject_id', subId);
        if (resId) sessionStorage.setItem('axiom_target_resource_id', resId);
        if (taskId) {
          timer.setContext(subId, null, taskId);
        }
        window.location.hash = '#subjects';
      }
    });

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

    // Subject Workspace ↗ buttons
    container.querySelectorAll('[data-action="go-subject-workspace"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const subId = e.currentTarget.getAttribute('data-subject-id');
        if (subId) {
          sessionStorage.setItem('axiom_target_subject_id', subId);
          window.location.hash = '#subjects';
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
