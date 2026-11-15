/**
 * Axiom Studia — Grades View
 * Grades matrix
 * Uses the student's saved grade scale, passing mark, and term weights.
 */

import { db } from '../db.js';
import { GRADE_WEIGHTS, termWeights, gradeValue, averageGrade, calculateGWA } from '../grading.js';

const escapeAcademic = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
const DEFAULT_SECTION = '—';

function unitOptions(current) {
  const selected = String(current ?? '');
  const values = ['', '1', '2', '3', '4', '5'];
  if (selected && !values.includes(selected)) values.push(selected);
  return values.map(value => `<option value="${escapeAcademic(value)}" ${value === selected ? 'selected' : ''}>${escapeAcademic(value || '—')}</option>`).join('');
}

function trimesterPicker(current, label = 'Trimester', includeUnassigned = false) {
  // Keep the period keys used by existing subjects.
  const ordinals = ['1st', '2nd', '3rd'];
  const choices = ordinals.map(ordinal => [ordinal + ' Semester', ordinal + ' Trimester']);
  if (includeUnassigned) choices.push(['', 'Unassigned']);
  const selected = current || (includeUnassigned ? '' : choices[0][0]);
  if (!choices.some(([value]) => value === selected)) choices.push([selected, selected]);
  return `<fieldset class="grade-trimester-picker form-group">
    <legend class="form-label">${label}</legend>
    <div class="grade-trimester-options">
      ${choices.map(([value, text]) => `<label class="btn btn-secondary btn-sm">
        <input type="radio" name="semester" value="${escapeAcademic(value)}" ${value === selected ? 'checked' : ''} required>
        ${escapeAcademic(text)}
      </label>`).join('')}
    </div>
  </fieldset>`;
}

function showSubjectForm(subject, onComplete) {
  document.getElementById('grade-subject-modal')?.remove();
  const period = subject ? db.getSubjectPeriod(subject) : db.getAcademicPeriod();
  const field = (name, label, value, attributes = '') => `<label class="form-group"><span class="form-label">${label}</span><input name="${name}" value="${escapeAcademic(value)}" ${attributes}></label>`;
  document.body.insertAdjacentHTML('beforeend', `
    <dialog class="modal" id="grade-subject-modal">
      <form id="grade-subject-form">
        <div class="modal-header"><h3>${subject ? 'Edit Subject' : 'Add Subject'}</h3></div>
        <div class="modal-body">
          ${field('name', 'Subject name', subject?.name || '', 'required')}
          ${field('code', 'Course code (optional)', subject?.code || '')}
          ${subject ? field('instructor', 'Instructor', subject.instructor || '') : ''}
          <label class="form-group"><span class="form-label">Academic units</span><select name="units">${unitOptions(subject?.units)}</select></label>
          ${trimesterPicker(period.semester)}
          ${field('schoolYear', 'School year', period.schoolYear, 'required placeholder="2026–2027"')}
          <label><input type="checkbox" name="included" ${subject?.excludeFromGWA !== true ? 'checked' : ''}> Include in GWA</label>
          <p>Grades and Subject Workspace share this subject. Materials, tasks, and study progress stay linked.</p>
        </div>
        <div class="modal-footer"><button type="button" class="btn btn-secondary" id="cancel-grade-subject">Cancel</button><button type="submit" class="btn btn-primary">${subject ? 'Save Changes' : 'Add Subject'}</button></div>
      </form>
    </dialog>`);
  const dialog = document.getElementById('grade-subject-modal');
  const close = () => { dialog.close(); dialog.remove(); };
  dialog.querySelector('#cancel-grade-subject').addEventListener('click', close);
  dialog.addEventListener('cancel', () => dialog.remove());
  dialog.querySelector('form').addEventListener('submit', event => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = data.get('name').trim();
    const academicPeriod = db.getAcademicPeriod({ semester: data.get('semester').trim(), schoolYear: data.get('schoolYear').trim() });
    if (!name || !academicPeriod.semester || !academicPeriod.schoolYear) return;
    const updates = {
      name, code: data.get('code').trim(), units: data.get('units') === '' ? null : Number(data.get('units')),
      academicPeriod, excludeFromGWA: !data.has('included')
    };
    if (subject) {
      updates.instructor = data.get('instructor').trim();
      db.updateSubject(subject.id, updates);
    } else {
      // Reuse an exact existing enrollment rather than creating a second copy.
      const match = db.getSubjects().find(existing => {
        const own = db.getSubjectPeriod(existing);
        return (existing.name || '').trim().toLowerCase() === name.toLowerCase() &&
          own.semester === academicPeriod.semester && own.schoolYear === academicPeriod.schoolYear;
      });
      if (!match) db.addSubject({ ...updates, color: '#38bdf8', icon: '📚', grades: {} });
      db.updateUserProfile(academicPeriod);
    }
    close();
    onComplete();
  });
  dialog.showModal();
}

export function renderGrades(container) {
  let cleanupAcademic = () => {};
  let renderedSelection = '';
  const settings = db.getGradingSystem();
  const PASS = Number(settings.passing);
  const MAX = Number(settings.maximum);
  const MIN = Number(settings.minimum);
  const higherIsBetter = settings.direction !== 'lower';
  const weights = termWeights(settings);
  const W_P = weights.prelim / 100;
  const W_M = weights.midterm / 100;
  const W_E = weights.endterm / 100;
  const passes = grade => higherIsBetter ? grade >= PASS : grade <= PASS;

  const firstWholeGrade = Math.ceil(MIN);
  const lastWholeGrade = Math.floor(MAX);
  const choiceCount = Math.max(0, lastWholeGrade - firstWholeGrade + 1);
  const wholeGradeChoices = Array.from({ length: Math.min(501, choiceCount) }, (_, index) => (
    firstWholeGrade + Math.round(index * (choiceCount - 1) / Math.max(1, Math.min(500, choiceCount - 1)))
  ));

  const wholeGradeOptions = wholeGradeChoices.map(grade => `<option value="${grade}">${grade}</option>`).join('');

  function gradingForm() {
    return `<section class="card grading-system-card">
      <div class="card-title">Grading system</div>
      <p class="card-subtitle">Scale ${MIN}–${MAX} · Passing grade ${PASS} (${higherIsBetter ? 'or higher' : 'or lower'})</p>
      <p class="grading-system-hint">Prelim ${weights.prelim}% · Midterm ${weights.midterm}% · Endterm ${weights.endterm}%</p>
      <details>
        <summary>Edit Settings</summary>
        <form id="grading-system-form">
          <div class="grading-system-grid">
            <label class="form-group"><span class="form-label">Lowest grade</span><input name="minimum" type="number" step="any" required value="${MIN}"></label>
            <label class="form-group"><span class="form-label">Highest grade</span><input name="maximum" type="number" step="any" required value="${MAX}"></label>
            <label class="form-group"><span class="form-label">Passing grade</span><input name="passing" type="number" step="any" required value="${PASS}"></label>
            <label class="form-group"><span class="form-label">Better grade is</span><select name="direction"><option value="higher" ${higherIsBetter ? 'selected' : ''}>Higher</option><option value="lower" ${higherIsBetter ? '' : 'selected'}>Lower</option></select></label>
          </div>
          <div class="grading-system-grid">${Object.keys(weights).map(term => `<label class="form-group"><span class="form-label">${term[0].toUpperCase() + term.slice(1)} weight (%)</span><input name="${term}" type="number" min="0" max="100" step="any" required value="${weights[term]}"></label>`).join('')}</div>
          <p class="grading-system-hint">Total <output id="grading-weight-total">100%</output></p>
          <p id="grading-system-error" class="grading-system-error" role="alert" hidden></p>
          <button class="btn btn-primary" type="submit">Save Changes</button>
          <button class="btn btn-secondary" type="reset">Cancel</button>
          <button class="btn btn-ghost" type="button" id="grading-reset-default">Reset to Default</button>
        </form>
      </details>
    </section>`;
  }

  function attachGradingForm() {
    const form = container.querySelector('#grading-system-form');
    form?.addEventListener('input', () => {
      const data = new FormData(form);
      const total = ['prelim', 'midterm', 'endterm'].reduce((sum, term) => sum + Number(data.get(term) || 0), 0);
      container.querySelector('#grading-weight-total').textContent = `${Number(total.toFixed(8))}%`;
    });
    form?.addEventListener('reset', () => setTimeout(() => form.dispatchEvent(new Event('input')), 0));
    container.querySelector('#grading-reset-default')?.addEventListener('click', () => {
      db.updateGradingSystem({ minimum: 0, maximum: 10, passing: 5, direction: 'higher', weights: GRADE_WEIGHTS });
      cleanupAcademic(); cleanupAcademic = renderGrades(container);
    });
    form?.addEventListener('submit', event => {
      event.preventDefault();
      const form = event.currentTarget;
      const data = new FormData(form);
      const minimum = Number(data.get('minimum'));
      const maximum = Number(data.get('maximum'));
      const passing = Number(data.get('passing'));
      const error = container.querySelector('#grading-system-error');
      const weights = Object.fromEntries(['prelim', 'midterm', 'endterm'].map(term => [term, Number(data.get(term))]));
      const values = [minimum, maximum, passing, ...Object.values(weights)];
      let message = '';
      if (values.some(value => !Number.isFinite(value))) message = 'Enter a valid number in every field.';
      else if (minimum >= maximum) message = 'The lowest scale value must be below the highest.';
      else if (passing < minimum || passing > maximum) message = 'The passing grade must be within your scale.';
      else if (Object.values(weights).some(value => value < 0 || value > 100) || Math.abs(Object.values(weights).reduce((sum, value) => sum + value, 0) - 100) > 1e-8) message = 'Term weights must total 100%.';
      if (message) { error.textContent = message; error.hidden = false; return; }
      db.updateGradingSystem({ minimum, maximum, passing, direction: data.get('direction'), weights });
      cleanupAcademic();
      cleanupAcademic = renderGrades(container);
    });
  }
  function selectedSubjects() {
    return db.getSubjectsForPeriod();
  }
  function summaryMarkup() {
    const result = calculateGWA(selectedSubjects(), settings, 'final');
    return `<div class="grade-gwa-value"><h3>Final GWA</h3><strong>${result.value === null ? 'N/A' : result.value.toFixed(2)}</strong></div>
      ${result.value === null ? '<p>No complete final grades available in this period.</p>' :
        result.partial ? '<p>Based on subjects with complete grades and academic units.</p>' : ''}`;
  }
  function refreshSummary() {
    const element = container.querySelector('#gwa-summary');
    if (element) element.innerHTML = summaryMarkup();
  }

  function getSubjectAverageAndStatus(subject) {
    const g = subject.grades || {};
    const p = gradeValue(g.prelim, settings);
    const m = gradeValue(g.midterm, settings);
    const e = gradeValue(g.endterm, settings);

    const allEntered = p !== null && m !== null && e !== null;
    const noneEntered = p === null && m === null && e === null;

    if (noneEntered) {
      return {
        avgStr: '—',
        statusStr: '—',
        statusColor: 'var(--text-muted)',
        statusClass: '',
        targetNote: 'Enter term grades'
      };
    }

    if (allEntered) {
      const finalGrade = averageGrade(g, settings, true);
      const isPass = passes(finalGrade);
      return {
        avgStr: finalGrade.toFixed(2),
        statusStr: isPass ? 'PASSED' : 'FAILED',
        statusColor: isPass ? 'var(--accent-emerald)' : '#f87171',
        statusClass: isPass ? 'badge-emerald' : 'badge-rose',
        targetNote: isPass ? 'Requirement satisfied' : `Passing grade: ${PASS}`
      };
    }

    // Partially entered
    let earnedPoints = 0;
    let earnedWeight = 0;
    let remWeight = 0;
    if (p !== null) { earnedPoints += p * W_P; earnedWeight += W_P; } else { remWeight += W_P; }
    if (m !== null) { earnedPoints += m * W_M; earnedWeight += W_M; } else { remWeight += W_M; }
    if (e !== null) { earnedPoints += e * W_E; earnedWeight += W_E; } else { remWeight += W_E; }

    if (earnedWeight === 0) return {
      avgStr: '—', statusStr: '—', statusColor: 'var(--text-muted)',
      statusClass: '', targetNote: 'Enter a weighted term grade'
    };
    const currentSubAvg = earnedPoints / earnedWeight;
    const minNeeded = remWeight > 0 ? (PASS - earnedPoints) / remWeight : currentSubAvg;
    const isProjectedPass = passes(currentSubAvg);

    let targetNote = '';
    if (remWeight === 0) {
      targetNote = passes(currentSubAvg) ? 'Pass guaranteed' : 'Cannot pass';
    } else if (higherIsBetter ? minNeeded <= MIN : minNeeded >= MAX) {
      targetNote = 'Pass guaranteed';
    } else if (higherIsBetter ? earnedPoints + MAX * remWeight < PASS : earnedPoints + MIN * remWeight > PASS) {
      targetNote = 'Cannot pass';
    } else {
      const target = higherIsBetter ? Math.ceil((minNeeded - 1e-9) * 100) / 100 : Math.floor((minNeeded + 1e-9) * 100) / 100;
      targetNote = `Need ${higherIsBetter ? '≥' : '≤'} ${target.toFixed(2)} average in remaining`;
    }

    return {
      avgStr: '—',
      statusStr: isProjectedPass ? 'ON TRACK' : 'NEEDS FOCUS',
      statusColor: isProjectedPass ? 'var(--accent-cyan)' : 'var(--accent-amber)',
      statusClass: isProjectedPass ? 'badge-cyan' : 'badge-amber',
      targetNote
    };
  }

  function getFacultyName(s) {
    if (s.instructor && !s.instructor.includes('Dept') && !s.instructor.includes('Instructor') && s.instructor !== 'Faculty') {
      return s.instructor;
    }
    return s.instructor || '—';
  }

  function render() {
    const profile = db.getUserProfile() || {};
    const subjects = selectedSubjects();
    renderedSelection = JSON.stringify([db.getAcademicPeriod(), subjects.map(subject => subject.id)]);
    const totalUnits = subjects.reduce((sum, subject) => sum + (Number(subject.units) > 0 ? Number(subject.units) : 0), 0);

    container.innerHTML = `
      <div class="grades-container" style="max-width:1300px; margin:0 auto; display:flex; flex-direction:column; gap:var(--space-4); padding-bottom:var(--space-8);">
        <div class="tasks-toolbar"><h2>Grades</h2><button class="btn btn-primary" id="grades-add-subject">Add Subject</button></div>
        <form id="grades-period-form" class="card"><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:12px">
          ${trimesterPicker(db.getAcademicPeriod().semester, 'Selected trimester', true)}
          <label class="form-group" style="min-width:0">Selected school year<input style="min-width:0;width:100%" name="schoolYear" placeholder="2026–2027" value="${escapeAcademic(db.getAcademicPeriod().schoolYear)}"></label>
        </div></form>
        ${!subjects.length ? '<p>No subjects in this academic period. Add a subject or select another period.</p>' : ''}
        ${gradingForm()}
        
        <!-- Welcome Header Bar -->
        <div style="display:flex; align-items:center; flex-wrap:wrap; gap:var(--space-2); padding: 6px 12px; background:var(--bg-surface); border:1px solid var(--border-card); border-radius:2px;">
          <div style="font-family:var(--font-mono); font-size:0.86rem; font-weight:700; color:var(--text-primary); letter-spacing:0.04em;">
            Welcome, <span style="color:var(--text-primary);">${escapeAcademic(profile.name || 'Student')}</span>
          </div>
        </div>


        <!-- Course details and GWA above the grades table -->
        <div style="background: var(--bg-card); border:1px solid var(--border-card); border-radius:3px; overflow:hidden; box-shadow:0 4px 20px rgba(0,0,0,0.5);">


          <!-- Box Body Grid -->
          <div style="padding:12px 18px; display:grid; grid-template-columns:repeat(auto-fit, minmax(min(100%, 280px), 1fr)); gap:10px 24px; font-size:0.83rem;">
            <!-- Row 1 -->
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px dashed var(--border-subtle); padding-bottom:5px;">
              <span style="font-weight:700; color:var(--text-primary); font-family:var(--font-mono); text-transform:uppercase; font-size:0.75rem; letter-spacing:0.04em;">SCHOOL YEAR</span>
              <span style="font-family:var(--font-mono); font-weight:700; color:var(--accent-cyan); text-decoration:underline;" data-academic-school-year>${escapeAcademic(db.getAcademicPeriod().schoolYear) || '—'}</span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px dashed var(--border-subtle); padding-bottom:5px;">
              <span style="font-weight:700; color:var(--text-primary); font-family:var(--font-mono); text-transform:uppercase; font-size:0.75rem; letter-spacing:0.04em;">Semester</span>
              <span style="font-family:var(--font-mono); font-weight:700; color:var(--accent-cyan); text-decoration:underline;" data-academic-semester>${escapeAcademic(db.getAcademicPeriod().semester) || '—'}</span>
            </div>

            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px dashed var(--border-subtle); padding-bottom:5px;">
              <span style="font-weight:700; color:var(--text-primary); font-family:var(--font-mono); text-transform:uppercase; font-size:0.75rem; letter-spacing:0.04em;">Total Enrolled Units</span>
              <span style="font-family:var(--font-mono); font-weight:700; color:var(--accent-cyan); text-decoration:underline;" id="tup-total-units">${totalUnits} Units</span>
            </div>

            <!-- Row 3 -->
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px dashed var(--border-subtle); padding-bottom:5px;">
              <span style="font-weight:700; color:var(--text-primary); font-family:var(--font-mono); text-transform:uppercase; font-size:0.75rem; letter-spacing:0.04em;">Course Code</span>
              <span style="font-family:var(--font-mono); font-weight:700; color:var(--accent-cyan); text-decoration:underline;">—</span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px dashed var(--border-subtle); padding-bottom:5px;">
              <span style="font-weight:700; color:var(--text-primary); font-family:var(--font-mono); text-transform:uppercase; font-size:0.75rem; letter-spacing:0.04em;">Course Description</span>
              <span style="font-weight:600; color:var(--text-primary); text-decoration:underline; font-size:0.78rem;">${escapeAcademic(profile.major || '—')}</span>
            </div>
            <div id="gwa-summary" aria-live="polite">${summaryMarkup()}</div>
          </div>
        </div>

        <!-- Academic Grades Table -->
        <div style="border:1px solid var(--border-card); border-radius:3px; overflow-x:auto; box-shadow:0 6px 25px rgba(0,0,0,0.6); background:var(--bg-card);">
          <table style="width:100%; border-collapse:collapse; min-width:940px; font-size:0.8rem; text-align:left;">
            <thead>
              <tr style="background: var(--bg-card); color:var(--text-primary); font-family:var(--font-mono); font-size:0.74rem; letter-spacing:0.05em; text-transform:uppercase;">
                <th style="padding:10px 8px; text-align:center; width:36px; border-right:1px solid var(--border-subtle);">#</th>
                <th style="padding:10px 8px; width:125px; border-right:1px solid var(--border-subtle);">Subject Code</th>
                <th style="padding:10px 8px; min-width:180px; border-right:1px solid var(--border-subtle);">Description</th>
                <th style="padding:10px 8px; width:170px; border-right:1px solid var(--border-subtle);">Faculty Name</th>
                <th style="padding:10px 6px; text-align:center; width:58px; border-right:1px solid var(--border-subtle);">Units</th>
                <th style="padding:10px 8px; text-align:center; width:95px; border-right:1px solid var(--border-subtle);">Section</th>
                <th style="padding:10px 8px; text-align:center; width:75px; border-right:1px solid var(--border-subtle);">PRELIM</th>
                <th style="padding:10px 8px; text-align:center; width:75px; border-right:1px solid var(--border-subtle);">MIDTERM</th>
                <th style="padding:10px 8px; text-align:center; width:75px; border-right:1px solid var(--border-subtle);">ENDTERM</th>
                <th style="padding:10px 8px; text-align:center; width:85px; border-right:1px solid var(--border-subtle);">Final grade</th>
                <th style="padding:10px 10px; text-align:center; width:110px;">Grade Status</th>
              </tr>
            </thead>
            <tbody id="tup-grades-tbody">
              ${subjects.map((s, idx) => {
                const g = s.grades || {};
                const pVal = (g.prelim !== undefined && g.prelim !== null) ? g.prelim : '';
                const mVal = (g.midterm !== undefined && g.midterm !== null) ? g.midterm : '';
                const eVal = (g.endterm !== undefined && g.endterm !== null) ? g.endterm : '';
                const faculty = getFacultyName(s);
                const info = getSubjectAverageAndStatus(s);
                const isEven = idx % 2 === 1;
                const rowBg = isEven ? 'var(--bg-surface)' : 'var(--bg-card)';

                return `
                  <tr style="background:${rowBg}; border-bottom:1px solid var(--border-subtle); transition:background 0.15s;" data-row-sub="${s.id}" class="tup-grade-row">
                    <!-- # -->
                    <td style="padding:6px 6px; text-align:center; font-family:var(--font-mono); color:var(--text-muted); font-size:0.75rem; border-right:1px solid var(--border-subtle);">
                      ${idx + 1}
                    </td>

                    <!-- Subject Code (Editable) -->
                    <td style="padding:4px 6px; border-right:1px solid var(--border-subtle);">
                      <input type="text"
                        class="tup-edit-input tup-input-code"
                        aria-label="${s.code || 'Subject'} course code"
                        data-sub-id="${s.id}"
                        data-field="code"
                        value="${escapeAcademic(s.code || '')}"
                        placeholder="Code"
                        style="font-family:var(--font-mono); font-weight:700; color:var(--accent-primary);"
                        title="Click to edit subject code"
                      />
                    </td>

                    <!-- Description (Editable) -->
                    <td style="padding:4px 6px; border-right:1px solid var(--border-subtle);">
                      <input type="text"
                        class="tup-edit-input tup-input-name"
                        aria-label="${s.code || 'Subject'} course description"
                        data-sub-id="${s.id}"
                        data-field="name"
                        value="${escapeAcademic(s.name || '')}"
                        placeholder="Subject Description"
                        style="font-weight:600; color:var(--text-primary);"
                        title="Click to edit description"
                      />
                      <div class="grade-subject-actions">
                        <button type="button" class="btn btn-ghost btn-sm" data-edit-subject="${s.id}" aria-label="Edit subject details for ${escapeAcademic(s.code || s.name || 'Subject')}">Edit details</button>
                        <button type="button" class="btn btn-ghost btn-sm" data-remove-subject="${s.id}" aria-label="Remove subject ${escapeAcademic(s.name || s.code || 'Subject')}">Remove Subject</button>
                        <label><input type="checkbox" data-include-subject="${s.id}" ${s.excludeFromGWA !== true ? 'checked' : ''}> Include in GWA</label>
                      </div>
                    </td>

                    <!-- Faculty Name (Editable) -->
                    <td style="padding:4px 6px; border-right:1px solid var(--border-subtle);">
                      <input type="text"
                        class="tup-edit-input tup-input-instructor"
                        aria-label="${s.code || 'Subject'} faculty name"
                        data-sub-id="${s.id}"
                        data-field="instructor"
                        value="${escapeAcademic(faculty)}"
                        placeholder="Faculty Name"
                        style="font-size:0.78rem; color:var(--text-secondary);"
                        title="Click to edit faculty name"
                      />
                    </td>

                    <!-- Units (Editable) -->
                    <td style="padding:4px 6px; text-align:center; border-right:1px solid var(--border-subtle);">
                      <select
                        class="tup-edit-input tup-input-units"
                        aria-label="${escapeAcademic(s.code || s.name || 'Subject')} enrolled units"
                        data-sub-id="${s.id}"
                        data-field="units"
                        style="text-align:center; font-family:var(--font-mono); font-weight:700; color:var(--text-primary); width:64px; margin:0 auto; display:block;">${unitOptions(s.units)}</select>
                    </td>

                    <!-- Section -->
                    <td style="padding:6px 6px; text-align:center; font-family:var(--font-mono); font-size:0.72rem; color:var(--text-muted); border-right:1px solid var(--border-subtle);">
                      ${escapeAcademic(profile.section || DEFAULT_SECTION)}
                    </td>

                    <!-- PRELIM Input -->
                    <td style="padding:5px 6px; text-align:center; border-right:1px solid var(--border-subtle);">
                      <div class="grade-entry">
                        <input type="text" inputmode="decimal" autocomplete="off"
                          class="tup-term-input"
                          aria-label="${s.code || 'Subject'} prelim grade"
                          data-sub-id="${s.id}"
                          data-term="prelim"
                          style="width:76px; padding:4px; font-family:var(--font-mono); font-size:0.8rem; font-weight:700; text-align:center; background:var(--bg-input); border:1px solid var(--border-card); border-radius:2px; color:var(--text-primary);"
                          value="${escapeAcademic(pVal)}" placeholder="—"
                        />
                        <select class="grade-whole-select" aria-label="Choose a whole-number prelim grade for ${escapeAcademic(s.name || s.code || 'Subject')}">
                          <option value="" selected hidden></option>${wholeGradeOptions}
                        </select>
                      </div>
                    </td>

                    <!-- MIDTERM Input -->
                    <td style="padding:5px 6px; text-align:center; border-right:1px solid var(--border-subtle);">
                      <div class="grade-entry">
                        <input type="text" inputmode="decimal" autocomplete="off"
                          class="tup-term-input"
                          aria-label="${s.code || 'Subject'} midterm grade"
                          data-sub-id="${s.id}"
                          data-term="midterm"
                          style="width:76px; padding:4px; font-family:var(--font-mono); font-size:0.8rem; font-weight:700; text-align:center; background:var(--bg-input); border:1px solid var(--border-card); border-radius:2px; color:var(--text-primary);"
                          value="${escapeAcademic(mVal)}" placeholder="—"
                        />
                        <select class="grade-whole-select" aria-label="Choose a whole-number midterm grade for ${escapeAcademic(s.name || s.code || 'Subject')}">
                          <option value="" selected hidden></option>${wholeGradeOptions}
                        </select>
                      </div>
                    </td>

                    <!-- ENDTERM Input -->
                    <td style="padding:5px 6px; text-align:center; border-right:1px solid var(--border-subtle);">
                      <div class="grade-entry">
                        <input type="text" inputmode="decimal" autocomplete="off"
                          class="tup-term-input"
                          aria-label="${s.code || 'Subject'} endterm grade"
                          data-sub-id="${s.id}"
                          data-term="endterm"
                          style="width:76px; padding:4px; font-family:var(--font-mono); font-size:0.8rem; font-weight:700; text-align:center; background:var(--bg-input); border:1px solid var(--border-card); border-radius:2px; color:var(--text-primary);"
                          value="${escapeAcademic(eVal)}" placeholder="—"
                        />
                        <select class="grade-whole-select" aria-label="Choose a whole-number endterm grade for ${escapeAcademic(s.name || s.code || 'Subject')}">
                          <option value="" selected hidden></option>${wholeGradeOptions}
                        </select>
                      </div>
                    </td>

                    <!-- AVERAGE -->
                    <td style="padding:6px 6px; text-align:center; font-family:var(--font-mono); font-weight:800; font-size:0.88rem; color:${info.statusColor}; border-right:1px solid var(--border-subtle);" data-avg-for="${s.id}">
                      ${info.avgStr}
                    </td>

                    <!-- Grade Status -->
                    <td style="padding:6px 6px; text-align:center; font-family:var(--font-mono); font-size:0.72rem; font-weight:700;">
                      <a class="grade-status-button" href="#grade-planner?subject=${encodeURIComponent(s.id)}" data-status-for="${s.id}" aria-label="Open grade goal planner for ${escapeAcademic(s.code || s.name || 'Subject')}" title="Open grade goal planner">
                        <span style="color:${info.statusColor};">${info.statusStr}</span>
                      </a>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>

      </div>
    `;

    container.querySelector('#grades-add-subject')?.addEventListener('click', () => showSubjectForm(null, render));
    const periodForm = container.querySelector('#grades-period-form');
    const applyPeriod = () => {
      const data = new FormData(periodForm);
      const semester = data.get('semester').trim();
      const schoolYear = data.get('schoolYear').trim();
      const current = db.getAcademicPeriod();
      if (semester !== current.semester || schoolYear !== current.schoolYear) {
        db.updateUserProfile({ semester, term: '', schoolYear });
      }
    };
    periodForm?.addEventListener('submit', event => {
      event.preventDefault();
      applyPeriod();
      container.querySelector('#grades-period-form [name="schoolYear"]')?.focus();
    });
    periodForm?.addEventListener('change', event => {
      applyPeriod();
      if (event.target.name === 'semester') {
        container.querySelector('#grades-period-form [name="semester"]:checked')?.focus();
      }
    });
    container.querySelectorAll('[data-edit-subject]').forEach(button => button.addEventListener('click', () => showSubjectForm(db.getSubjectById(button.dataset.editSubject), render)));
    container.querySelectorAll('[data-remove-subject]').forEach(button => button.addEventListener('click', () => {
      const subject = db.getSubjectById(button.dataset.removeSubject);
      if (!subject) return;
      const label = subject.name || subject.code || 'this subject';
      if (!window.confirm(`Remove ${label} from Grades and Workspace? Its grades, tasks, and topics will be deleted.`)) return;
      db.deleteSubject(subject.id);
      render();
    }));
    container.querySelectorAll('[data-include-subject]').forEach(input => input.addEventListener('change', () => {
      db.updateSubject(input.dataset.includeSubject, { excludeFromGWA: !input.checked });
      refreshSummary();
    }));
    attachGradingForm();
    attachInputHandlers();
  }

  function attachInputHandlers() {
    // Subject Metadata Inputs (Code, Description/Name, Faculty/Instructor, Units)
    container.querySelectorAll('.tup-edit-input').forEach(input => {
      input.addEventListener('input', (e) => {
        const field = e.target.getAttribute('data-field');
        const subId = e.target.getAttribute('data-sub-id');
        const val = e.target.value.trim();
        const subject = db.getSubjectById(subId);
        if (!subject) return;

        if (field === 'units') {
          const unitsNum = val === '' ? null : Number(val);
          const safeUnits = Number.isFinite(unitsNum) && unitsNum > 0 ? unitsNum : null;
          db.updateSubject(subId, { units: safeUnits });

          // Update Total Enrolled Units in evaluation header
          const allSubs = selectedSubjects();
          const newTotalUnits = allSubs.reduce((acc, s) => acc + (Number(s.units) > 0 ? Number(s.units) : 0), 0);
          const totalUnitsEl = container.querySelector('#tup-total-units');
          if (totalUnitsEl) totalUnitsEl.textContent = `${newTotalUnits} Units`;

          refreshSummary();
        } else if (field === 'code') {
          db.updateSubject(subId, { code: val || '—' });
        } else if (field === 'name') {
          db.updateSubject(subId, { name: val || '—' });
        } else if (field === 'instructor') {
          db.updateSubject(subId, { instructor: val || '' });
        }
        refreshSummary();
      });
    });

    // Term Grade Inputs (Prelim, Midterm, Endterm)
    container.querySelectorAll('.tup-term-input').forEach(input => {
      const chooser = input.parentElement.querySelector('.grade-whole-select');
      chooser.addEventListener('change', () => {
        input.value = chooser.value;
        chooser.selectedIndex = 0;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      });
      input.addEventListener('input', (e) => {
        const raw = e.target.value.trim();
        const term = e.target.getAttribute('data-term');
        const subId = e.target.getAttribute('data-sub-id');
        const subject = db.getSubjectById(subId);
        if (!subject) return;

        const grades = { ...(subject.grades || {}) };
        const grade = raw === '' ? null : Number(raw);
        const valid = grade === null || (/^[+-]?\d*\.?\d+$/.test(raw) && grade >= MIN && grade <= MAX);
        input.setCustomValidity(valid ? '' : `Enter a grade from ${MIN} to ${MAX}.`);
        input.setAttribute('aria-invalid', String(!valid));
        if (!valid) return;
        grades[term] = grade;
        db.updateSubject(subId, { grades });

        // Update row Average and Status immediately in place
        const updatedSub = db.getSubjectById(subId);
        const info = getSubjectAverageAndStatus(updatedSub);
        const avgCell = container.querySelector(`[data-avg-for="${subId}"]`);
        const statusCell = container.querySelector(`[data-status-for="${subId}"]`);

        if (avgCell) {
          avgCell.textContent = info.avgStr;
          avgCell.style.color = info.statusColor;
        }
        if (statusCell) {
          statusCell.innerHTML = `<span style="color:${info.statusColor};">${info.statusStr}</span>`;
        }

        refreshSummary();
      });
    });
  }

  render();
  cleanupAcademic = db.subscribe(() => {
    const period = db.getAcademicPeriod();
    const selection = JSON.stringify([period, selectedSubjects().map(subject => subject.id)]);
    if (selection !== renderedSelection) { render(); return; }
    refreshSummary();
    container.querySelectorAll('[data-academic-semester]').forEach(el => { el.textContent = period.semester || '—'; });
    container.querySelectorAll('[data-academic-school-year]').forEach(el => { el.textContent = period.schoolYear || '—'; });
  });
  return () => cleanupAcademic();
}
