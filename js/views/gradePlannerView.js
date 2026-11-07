import { db } from '../db.js';
import { gradePlannerMarkup, bindGradePlanner } from './gradePlanner.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);

export function renderGradePlanner(container) {
  const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
  const subjectId = params.get('subject');
  const subject = db.getSubjectById(subjectId);
  const back = '<a class="btn btn-secondary grade-planner-back" href="#grades">← Back to Grades</a>';
  if (!subject) {
    container.innerHTML = `<div class="grade-planner-page">${back}<h1>Subject not found</h1><p>This subject is no longer available. Choose a subject from Grades to open its planner.</p></div>`;
    return;
  }
  const scale = db.getGradingSystem();
  container.innerHTML = `<div class="grade-planner-page">
    ${back}
    <header><h1>Smart Grade Goal Planner</h1><p class="card-subtitle">${escape(subject.code || subject.name)}${subject.code && subject.name ? ` · ${escape(subject.name)}` : ''}</p></header>
    <section class="smart-goal-section" aria-label="Subject grade goal planner">
      <p class="card-subtitle">Prelim 30% · Midterm 30% · Endterm 40% · Scale ${scale.minimum}–${scale.maximum} · ${scale.direction === 'lower' ? 'Lower' : 'Higher'} is better</p>
      ${gradePlannerMarkup(subject, scale)}
    </section>
  </div>`;
  bindGradePlanner(container.querySelector('[data-goal-subject]'), scale,
    () => db.getSubjectById(subjectId) || subject,
    updates => db.updateSubject(subjectId, updates));
}
