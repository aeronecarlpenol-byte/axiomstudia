/**
 * FOCUS//ECE — Academic Analytics & Study Reports
 * Clean SVG charts for daily/weekly focus time, subject breakdown, study streaks, and completion consistency.
 */

import { db } from '../db.js';

export function renderAnalytics(container) {
  const sessions = db.getFocusSessions();
  const subjects = db.getSubjects();
  const tasks = db.getTasks();

  const totalFocusMinutes = sessions.reduce((sum, s) => sum + (s.durationMinutes || 0), 0);
  const totalHours = Math.floor(totalFocusMinutes / 60);
  const totalMins = totalFocusMinutes % 60;
  const avgSessionLength = sessions.length ? Math.round(totalFocusMinutes / sessions.length) : 0;

  // Streak & consistency
  const studyDates = new Set(sessions.map(s => s.startTime ? s.startTime.split('T')[0] : null).filter(Boolean));
  const streak = studyDates.size; // Active study days

  // Subject Breakdown
  const subjectTimeMap = {};
  subjects.forEach(s => { subjectTimeMap[s.id] = 0; });
  sessions.forEach(sess => {
    if (sess.subjectId && subjectTimeMap[sess.subjectId] !== undefined) {
      subjectTimeMap[sess.subjectId] += (sess.durationMinutes || 0);
    }
  });

  const subjectData = subjects.map(s => ({
    name: s.name,
    code: s.code,
    color: s.color,
    minutes: subjectTimeMap[s.id] || 0
  })).sort((a, b) => b.minutes - a.minutes);

  const completedCount = tasks.filter(t => t.status === 'completed').length;
  const overdueCount = tasks.filter(t => {
    if (t.status === 'completed' || !t.deadline) return false;
    return new Date(t.deadline).getTime() < Date.now();
  }).length;

  // Daily focus bars for past 7 days
  const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const past7Days = [];
  const now = new Date(); // Real-time current date from user's device

  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateKey = db.getTodayDate ? db.getTodayDate(d) : `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const daySessions = sessions.filter(s => s.startTime && (db.isSameLocalDate ? db.isSameLocalDate(s.startTime, dateKey) : s.startTime.startsWith(dateKey)));
    const dayMins = daySessions.reduce((sum, s) => sum + (s.durationMinutes || 0), 0);
    past7Days.push({
      label: daysOfWeek[d.getDay()],
      date: dateKey,
      minutes: dayMins
    });
  }

  const maxDayMinutes = Math.max(...past7Days.map(d => d.minutes), 120);

  const formatHoursMins = (m) => {
    const hours = Math.floor(m / 60);
    const mins = m % 60;
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  };

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
          ${totalHours}h ${totalMins}m
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
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-6); margin-bottom: var(--space-6);">
      <!-- Past 7 Days Focus SVG Bar Chart -->
      <div class="card">
        <div class="card-header">
          <div class="card-title">📊 7-Day Focus Distribution</div>
        </div>

        <div style="margin-top: var(--space-4);">
          <svg viewBox="0 0 400 160" width="100%" height="160" style="overflow: visible;">
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
                  ${d.minutes > 0 ? `<text x="${x + 14}" y="${y - 6}" fill="var(--text-primary)" font-size="10" text-anchor="middle" font-family="var(--font-mono)">${d.minutes}m</text>` : ''}
                </g>
              `;
            }).join('')}
          </svg>
        </div>
      </div>

      <!-- Subject Focus Breakdown -->
      <div class="card">
        <div class="card-header">
          <div class="card-title">📚 Subject Time Allocation</div>
        </div>

        <div style="display: flex; flex-direction: column; gap: var(--space-3); margin-top: var(--space-3);">
          ${subjectData.map(s => {
            const pct = totalFocusMinutes > 0 ? Math.round((s.minutes / totalFocusMinutes) * 100) : 0;
            return `
              <div>
                <div style="display: flex; justify-content: space-between; font-size: 0.85rem; margin-bottom: 4px;">
                  <span style="font-weight: 500;">
                    <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${s.color}; margin-right: 6px;"></span>
                    ${s.code} · ${s.name}
                  </span>
                  <span style="font-family: var(--font-mono); color: var(--text-muted);">${formatHoursMins(s.minutes)} (${pct}%)</span>
                </div>
                <div class="progress-bar" style="height: 6px;">
                  <div class="progress-fill" style="width: ${pct}%; background: ${s.color};"></div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    </div>

    <!-- Recent Study Sessions Table -->
    <div class="card">
      <div class="card-header">
        <div class="card-title">⏱ Study Session Logs</div>
        <div class="card-subtitle">${sessions.length} completed sessions</div>
      </div>

      <div style="overflow-x: auto;">
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
            ${sessions.map(sess => {
              const sub = db.getSubjectById(sess.subjectId);
              const top = db.getTopicById(sess.topicId);
              return `
                <tr style="border-bottom: 1px solid var(--border-subtle);">
                  <td style="padding: var(--space-3);">
                    <div style="font-weight: 600;">${sub ? sub.code : 'Study'}</div>
                    <div style="font-size: 0.75rem; color: var(--text-muted);">${top ? top.name : 'General focus'}</div>
                  </td>
                  <td style="padding: var(--space-3); font-family: var(--font-mono); font-weight: 600; color: var(--accent-primary);">
                    ${sess.durationMinutes}m
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
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}
