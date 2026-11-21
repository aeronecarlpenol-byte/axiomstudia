import { formatStudyMinutes } from './studyTime.js';

export function subjectStudyTimeMarkup(subjects, focusSessions, headingId) {
  const minutesBySubject = new Map();
  let totalFocusMinutes = 0;
  for (const session of focusSessions) {
    const minutes = session.durationSeconds == null ? Number(session.durationMinutes) : Number(session.durationSeconds) / 60;
    if (!Number.isFinite(minutes) || minutes <= 0) continue;
    totalFocusMinutes += minutes;
    minutesBySubject.set(session.subjectId, (minutesBySubject.get(session.subjectId) || 0) + minutes);
  }
  const subjectTime = subjects.map(subject => ({ subject, minutes: minutesBySubject.get(subject.id) || 0 }))
    .sort((a, b) => b.minutes - a.minutes);
  return `<section class="card dash-panel-progress" aria-labelledby="${headingId}">
          <div class="card-header">
            <h2 class="card-title" id="${headingId}">📊 Study Time by Subject</h2>
          </div>
          ${!subjectTime.length ? '<p>Add a subject to see its study time.</p>' : ''}
          <div style="display: grid; gap: var(--space-3);">
            ${subjectTime.map(({ subject, minutes }) => {
              const percent = totalFocusMinutes > 0 ? minutes / totalFocusMinutes * 100 : 0;
              const label = Math.round(percent * 10) / 10;
              const name = String(subject.name || subject.code || 'Subject').replace(/[&<>"]/g, char =>
                ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);
              const color = /^#[0-9a-f]{6}$/i.test(subject.color) ? subject.color : 'var(--accent-primary)';
              return `
                <div>
                  <div style="display:flex; flex-wrap:wrap; justify-content:space-between; gap:var(--space-2);">
                    <span>${name}</span><span>${formatStudyMinutes(minutes)} (${label}%)</span>
                  </div>
                  <div class="progress-bar" role="meter" aria-label="Share of study time for ${name}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${label}">
                    <div class="progress-fill" style="width:${percent}%; background:${color};"></div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </section>`;
}
