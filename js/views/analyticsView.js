/**
 * FOCUS//ECE — Academic Analytics & Study Reports
 * Clean SVG charts for daily/weekly focus time, subject breakdown, study streaks, and completion consistency.
 */

import { db } from '../db.js';
import { formatStudyMinutes } from '../studyTime.js';
import { mountFocusHistory } from './focusHistory.js';

export function renderAnalytics(container) {
  const sessions = db.getFocusSessions();
  const preference = 'axiom_study_session_logs_collapsed';
  let collapsed = false;
  try { collapsed = localStorage.getItem(preference) === '1'; } catch { /* Default to expanded. */ }
  let logRows = studyLogRows(sessions);
  const tasks = db.getTasks();

  const totalFocusMinutes = sessions.reduce((sum, s) => sum + (s.durationMinutes || 0), 0);
  const avgSessionLength = sessions.length ? Math.round(totalFocusMinutes / sessions.length) : 0;

  // Streak & consistency
  const studyDates = new Set(sessions.map(s => s.startTime ? s.startTime.split('T')[0] : null).filter(Boolean));
  const streak = studyDates.size; // Active study days

  const completedCount = tasks.filter(t => t.status === 'completed').length;
  const overdueCount = tasks.filter(t => {
    if (t.status === 'completed' || !t.deadline) return false;
    return new Date(t.deadline).getTime() < Date.now();
  }).length;

  container.innerHTML = `
    <div class="tasks-toolbar">
      <div>
        <h2>Analytics</h2>
      </div>
    </div>

    <!-- Top Key Metrics Cards -->
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--space-4); margin-bottom: var(--space-6);">
      <div class="card" style="text-align: center;">
        <div style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase;">Total Focus Time</div>
        <div style="font-size: 1.8rem; font-weight: 700; font-family: var(--font-mono); color: var(--accent-primary); margin-top: 4px;">
          ${formatStudyMinutes(totalFocusMinutes)}
        </div>
      </div>

      <div class="card" style="text-align: center;">
        <div style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase;">Completed Sessions</div>
        <div style="font-size: 1.8rem; font-weight: 700; font-family: var(--font-mono); color: var(--accent-indigo); margin-top: 4px;">
          ${sessions.length}
        </div>
      </div>

      <div class="card" style="text-align: center;">
        <div style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase;">Avg Session Length</div>
        <div style="font-size: 1.8rem; font-weight: 700; font-family: var(--font-mono); color: var(--accent-emerald); margin-top: 4px;">
          ${avgSessionLength}m
        </div>
      </div>

      <div class="card" style="text-align: center;">
        <div style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase;">Active Days Streak</div>
        <div style="font-size: 1.8rem; font-weight: 700; font-family: var(--font-mono); color: var(--accent-amber); margin-top: 4px;">
          ${streak} days
        </div>
      </div>
    </div>

    <!-- Charts Row -->
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

    </div>

    <section class="card study-logs" aria-labelledby="study-logs-toggle">
      <h3 class="study-logs-heading">
        <button type="button" id="study-logs-toggle" aria-expanded="${!collapsed}" aria-controls="study-logs-content">
          <span class="card-title">⏱ Study Session Logs</span>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true">
            <path d="m4 6 4 4 4-4"/>
          </svg>
        </button>
      </h3>
      <div class="study-logs-body" id="study-logs-content" aria-hidden="${collapsed}" ${collapsed ? 'inert' : ''}>
        <div class="study-logs-inner">
          <div class="card-subtitle" data-study-log-count>${sessions.length} completed sessions</div>
          <div class="study-logs-table">
            <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem; text-align: left;">
              <thead>
                <tr style="border-bottom: 1px solid var(--border-card); color: var(--text-muted); font-size: 0.78rem; text-transform: uppercase;">
                  <th style="padding: var(--space-2) var(--space-3);">Subject & Topic</th>
                  <th style="padding: var(--space-2) var(--space-3);">Duration</th>
                  <th style="padding: var(--space-2) var(--space-3);">Goal Outcome</th>
                  <th style="padding: var(--space-2) var(--space-3);">Difficulty / Confidence</th>
                  <th style="padding: var(--space-2) var(--space-3);">Key Takeaways</th>
                </tr>
              </thead>
              <tbody>
                ${logRows}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  `;
  const stopHistory = mountFocusHistory(container.querySelector('.focus-history'));
  const toggle = container.querySelector('#study-logs-toggle');
  const body = container.querySelector('#study-logs-content');
  const count = body.querySelector('[data-study-log-count]');
  const tableBody = body.querySelector('tbody');
  toggle.addEventListener('click', () => {
    collapsed = !collapsed;
    toggle.setAttribute('aria-expanded', String(!collapsed));
    body.inert = collapsed;
    body.setAttribute('aria-hidden', String(collapsed));
    try { localStorage.setItem(preference, collapsed ? '1' : '0'); } catch { /* The toggle still works. */ }
  });
  const stopLogs = db.subscribe(() => {
    const currentSessions = db.getFocusSessions();
    const updated = studyLogRows(currentSessions);
    if (updated === logRows) return;
    logRows = updated;
    count.textContent = currentSessions.length + ' completed sessions';
    tableBody.innerHTML = logRows;
  });
  return () => { stopHistory(); stopLogs(); };
}

function studyLogRows(sessions) {
  return sessions.map(sess => {
    const sub = db.getSubjectById(sess.subjectId);
    const top = db.getTopicById(sess.topicId);
    return `
      <tr style="border-bottom: 1px solid var(--border-subtle);">
        <td style="padding: var(--space-3);">
          <div style="font-weight: 600;">${sub ? sub.code : 'Study'}</div>
          <div style="font-size: 0.75rem; color: var(--text-muted);">${top ? top.name : 'General focus'}</div>
        </td>
        <td style="padding: var(--space-3); font-family: var(--font-mono); font-weight: 600; color: var(--accent-primary);">
          ${formatStudyMinutes(sess.durationMinutes)}
        </td>
        <td style="padding: var(--space-3);">
          <span class="badge ${sess.completedGoal === 'finished' ? 'badge-emerald' : 'badge-amber'}">
            ${sess.completedGoal || 'Finished'}
          </span>
        </td>
        <td style="padding: var(--space-3); font-family: var(--font-mono); font-size: 0.8rem;">
          Diff: ${sess.difficulty || 3}/5 · Conf: ${sess.confidence || 4}/5
        </td>
        <td style="padding: var(--space-3); color: var(--text-secondary); max-width: 280px;">
          ${sess.whatLearned ? `<div><b>Learned:</b> ${sess.whatLearned}</div>` : ''}
          ${sess.whatToReview ? `<div style="color: var(--accent-amber); font-size: 0.78rem; margin-top: 2px;"><b>Review:</b> ${sess.whatToReview}</div>` : ''}
        </td>
      </tr>
    `;
  }).join('');
}
