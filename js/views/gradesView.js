/**
 * Axiom Studia — Grades View
 * Grades matrix
 * Uses the student's saved grade scale, passing mark, and term weights.
 */

import { db } from '../db.js';
import { GRADE_WEIGHTS, gradeValue, averageGrade } from '../grading.js';
import { gradePlannerMarkup, bindGradePlanner } from './gradePlanner.js';

const DEFAULT_SECTION = '—';
export function renderGrades(container) {
  const settings = db.getGradingSystem();
  const PASS = Number(settings.passing);
  const MAX = Number(settings.maximum);
  const MIN = Number(settings.minimum);
  const higherIsBetter = settings.direction !== 'lower';
  const drafts = new Map();
  const plannerControllers = new Map();
  const effectiveSubject = subject => ({ ...subject, grades: { ...subject.grades, ...drafts.get(subject.id) } });
  const W_P = Number(GRADE_WEIGHTS.prelim) / 100;
  const W_M = Number(GRADE_WEIGHTS.midterm) / 100;
  const W_E = Number(GRADE_WEIGHTS.endterm) / 100;
  const passes = grade => higherIsBetter ? grade >= PASS : grade <= PASS;

  function gradingForm() {
    return `<form id="grading-system-form" class="card grading-system-card">
      <div class="card-header"><div><div class="card-title">Grading system</div>
      <div class="card-subtitle">Set your school's scale and passing grade. Term weights are fixed at 30% / 30% / 40%.</div></div></div>
      <div class="grading-system-grid">
        <label class="form-group"><span class="form-label">Lowest scale value</span><input name="minimum" type="number" step="any" required value="${MIN}"></label>
        <label class="form-group"><span class="form-label">Highest scale value</span><input name="maximum" type="number" step="any" required value="${MAX}"></label>
        <label class="form-group"><span class="form-label">Passing grade</span><input name="passing" type="number" step="any" required value="${PASS}"></label>
        <label class="form-group"><span class="form-label">Better grade is</span><select name="direction"><option value="higher" ${higherIsBetter ? 'selected' : ''}>Higher</option><option value="lower" ${higherIsBetter ? '' : 'selected'}>Lower</option></select></label>
        <label class="form-group"><span class="form-label">Prelim weight (%)</span><input name="prelim" readonly type="number" min="0" max="100" step="any" required value="${GRADE_WEIGHTS.prelim}"></label>
        <label class="form-group"><span class="form-label">Midterm weight (%)</span><input name="midterm" readonly type="number" min="0" max="100" step="any" required value="${GRADE_WEIGHTS.midterm}"></label>
        <label class="form-group"><span class="form-label">Endterm weight (%)</span><input name="endterm" readonly type="number" min="0" max="100" step="any" required value="${GRADE_WEIGHTS.endterm}"></label>
      </div>
      <p class="grading-system-hint">Prelim 30% · Midterm 30% · Endterm 40%. Changing scales converts saved grades and targets to the equivalent values.</p>
      <p id="grading-system-error" class="grading-system-error" role="alert" hidden></p>
      <button class="btn btn-primary" type="submit">Save grading system</button>
    </form>`;
  }

  function attachGradingForm() {
    container.querySelector('#grading-system-form')?.addEventListener('submit', event => {
      event.preventDefault();
      const form = event.currentTarget;
      const data = new FormData(form);
      const minimum = Number(data.get('minimum'));
      const maximum = Number(data.get('maximum'));
      const passing = Number(data.get('passing'));
      const weights = { prelim: Number(data.get('prelim')), midterm: Number(data.get('midterm')), endterm: Number(data.get('endterm')) };
      const error = container.querySelector('#grading-system-error');
      const values = [minimum, maximum, passing, ...Object.values(weights)];
      let message = '';
      if (values.some(value => !Number.isFinite(value))) message = 'Enter a valid number in every field.';
      else if (minimum >= maximum) message = 'The lowest scale value must be below the highest.';
      else if (passing < minimum || passing > maximum) message = 'The passing grade must be within your scale.';
      else if (Object.values(weights).some(value => value < 0 || value > 100) || Math.abs(Object.values(weights).reduce((sum, value) => sum + value, 0) - 100) > 0.001) message = 'Term weights must be between 0% and 100% and total 100%.';
      if (message) { error.textContent = message; error.hidden = false; return; }
      db.updateGradingSystem({ minimum, maximum, passing, direction: data.get('direction'), weights });
      renderGrades(container);
    });
  }
  function calculateGPA(subjects) {
    let totalPoints = 0;
    let totalWeight = 0;

    subjects.forEach(s => {
      const g = effectiveSubject(s).grades;
      const p = gradeValue(g.prelim, settings);
      const m = gradeValue(g.midterm, settings);
      const e = gradeValue(g.endterm, settings);

      const entered = [p, m, e].filter(v => v !== null);
      if (entered.length > 0) {
        let subPoints = 0;
        let subWeight = 0;
        if (p !== null) { subPoints += p * W_P; subWeight += W_P; }
        if (m !== null) { subPoints += m * W_M; subWeight += W_M; }
        if (e !== null) { subPoints += e * W_E; subWeight += W_E; }

        if (subWeight === 0) return;
        const currentSubAvg = subPoints / subWeight;
        const units = s.units || 3;
        totalPoints += currentSubAvg * units;
        totalWeight += units;
      }
    });

    return totalWeight > 0 ? (totalPoints / totalWeight).toFixed(2) : '—';
  }

  function getSubjectAverageAndStatus(subject) {
    const g = effectiveSubject(subject).grades;
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
      avgStr: currentSubAvg.toFixed(2),
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
    const subjects = db.getSubjects();
    if (!subjects.length) {
      container.innerHTML = `<div class="grades-container" style="max-width:1300px; margin:0 auto; display:flex; flex-direction:column; gap:var(--space-4); padding-bottom:var(--space-8);">${gradingForm()}<div class="card" style="max-width: 650px; margin: var(--space-6) auto; text-align: center;">
        <h2>Grades</h2>
        <p style="margin: var(--space-4) 0;">No subjects yet. Add your first subject to start tracking grades.</p>
        <a class="btn btn-primary" href="#subjects">Add a subject</a>
      </div></div>`;
      attachGradingForm();
      return;
    }
    const gpa = calculateGPA(subjects);
    const totalUnits = subjects.reduce((acc, s) => acc + (s.units || 3), 0);

    container.innerHTML = `
      <div class="grades-container" style="max-width:1300px; margin:0 auto; display:flex; flex-direction:column; gap:var(--space-4); padding-bottom:var(--space-8);">
        ${gradingForm()}
        
        <!-- Welcome Header Bar -->
        <div style="display:flex; align-items:center; flex-wrap:wrap; gap:var(--space-2); padding: 6px 12px; background:rgba(15, 12, 28, 0.7); border:1px solid rgba(139, 92, 246, 0.2); border-radius:2px;">
          <div style="font-family:var(--font-mono); font-size:0.86rem; font-weight:700; color:var(--text-primary); letter-spacing:0.04em;">
            Welcome, <span style="color:#ffffff;">${profile.name || 'Student'}${profile.studentId ? ` (${profile.studentId})` : ''}</span>
          </div>
        </div>


        <!-- Curriculum / Evaluation Information Box -->
        <div style="background: var(--bg-card); border:1px solid rgba(56, 189, 248, 0.4); border-radius:3px; overflow:hidden; box-shadow:0 4px 20px rgba(0,0,0,0.5);">


          <!-- Box Body Grid -->
          <div style="padding:12px 18px; display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:10px 24px; font-size:0.83rem;">
            <!-- Row 1 -->
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px dashed rgba(56, 189, 248, 0.2); padding-bottom:5px;">
              <span style="font-weight:700; color:#ffffff; font-family:var(--font-mono); text-transform:uppercase; font-size:0.75rem; letter-spacing:0.04em;">SCHOOL YEAR</span>
              <span style="font-family:var(--font-mono); font-weight:700; color:#38bdf8; text-decoration:underline;">${profile.schoolYear || '—'}</span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px dashed rgba(56, 189, 248, 0.2); padding-bottom:5px;">
              <span style="font-weight:700; color:#ffffff; font-family:var(--font-mono); text-transform:uppercase; font-size:0.75rem; letter-spacing:0.04em;">Term</span>
              <span style="font-family:var(--font-mono); font-weight:700; color:#38bdf8; text-decoration:underline;">${profile.term || '—'}</span>
            </div>

            <!-- Row 2 (Admission Status - Note: Scholastic Status intentionally omitted per request) -->
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px dashed rgba(56, 189, 248, 0.2); padding-bottom:5px;">
              <span style="font-weight:700; color:#ffffff; font-family:var(--font-mono); text-transform:uppercase; font-size:0.75rem; letter-spacing:0.04em;">Admission Status</span>
              <span style="font-family:var(--font-mono); font-weight:700; color:#38bdf8; text-decoration:underline;">—</span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px dashed rgba(56, 189, 248, 0.2); padding-bottom:5px;">
              <span style="font-weight:700; color:#ffffff; font-family:var(--font-mono); text-transform:uppercase; font-size:0.75rem; letter-spacing:0.04em;">Total Enrolled Units</span>
              <span style="font-family:var(--font-mono); font-weight:700; color:#38bdf8; text-decoration:underline;" id="tup-total-units">${totalUnits} Units</span>
            </div>

            <!-- Row 3 -->
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px dashed rgba(56, 189, 248, 0.2); padding-bottom:5px;">
              <span style="font-weight:700; color:#ffffff; font-family:var(--font-mono); text-transform:uppercase; font-size:0.75rem; letter-spacing:0.04em;">Course Code</span>
              <span style="font-family:var(--font-mono); font-weight:700; color:#38bdf8; text-decoration:underline;">—</span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px dashed rgba(56, 189, 248, 0.2); padding-bottom:5px;">
              <span style="font-weight:700; color:#ffffff; font-family:var(--font-mono); text-transform:uppercase; font-size:0.75rem; letter-spacing:0.04em;">Course Description</span>
              <span style="font-weight:600; color:#ffffff; text-decoration:underline; font-size:0.78rem;">${profile.major || '—'}</span>
            </div>

            <!-- Row 4 (GPA) -->
            <div style="grid-column: 1 / -1; display:flex; justify-content:space-between; align-items:center; padding-top:4px;">
              <span style="font-weight:700; color:#ffffff; font-family:var(--font-mono); text-transform:uppercase; font-size:0.75rem; letter-spacing:0.04em;">
                GPA for subjects with entered grades
              </span>
              <span style="font-family:var(--font-mono); font-weight:800; font-size:1.15rem; color:#38bdf8; text-decoration:underline;" id="tup-overall-gpa">
                ${gpa}
              </span>
            </div>
          </div>
        </div>

        <!-- Academic Grades Table -->
        <div style="border:1px solid rgba(139, 92, 246, 0.25); border-radius:3px; overflow-x:auto; box-shadow:0 6px 25px rgba(0,0,0,0.6); background:rgba(8, 7, 16, 0.95);">
          <table style="width:100%; border-collapse:collapse; min-width:940px; font-size:0.8rem; text-align:left;">
            <thead>
              <tr style="background: var(--bg-card); color:#ffffff; font-family:var(--font-mono); font-size:0.74rem; letter-spacing:0.05em; text-transform:uppercase;">
                <th style="padding:10px 8px; text-align:center; width:36px; border-right:1px solid rgba(255,255,255,0.15);">#</th>
                <th style="padding:10px 8px; width:125px; border-right:1px solid rgba(255,255,255,0.15);">Subject Code</th>
                <th style="padding:10px 8px; min-width:180px; border-right:1px solid rgba(255,255,255,0.15);">Description</th>
                <th style="padding:10px 8px; width:170px; border-right:1px solid rgba(255,255,255,0.15);">Faculty Name</th>
                <th style="padding:10px 6px; text-align:center; width:58px; border-right:1px solid rgba(255,255,255,0.15);">Units</th>
                <th style="padding:10px 8px; text-align:center; width:95px; border-right:1px solid rgba(255,255,255,0.15);">Section</th>
                <th style="padding:10px 8px; text-align:center; width:75px; border-right:1px solid rgba(255,255,255,0.15);">PRELIM</th>
                <th style="padding:10px 8px; text-align:center; width:75px; border-right:1px solid rgba(255,255,255,0.15);">MIDTERM</th>
                <th style="padding:10px 8px; text-align:center; width:75px; border-right:1px solid rgba(255,255,255,0.15);">ENDTERM</th>
                <th style="padding:10px 8px; text-align:center; width:85px; border-right:1px solid rgba(255,255,255,0.15);">AVERAGE</th>
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
                const rowBg = isEven ? 'rgba(15, 14, 28, 0.75)' : 'rgba(8, 7, 16, 0.9)';

                return `
                  <tr style="background:${rowBg}; border-bottom:1px solid rgba(139, 92, 246, 0.12); transition:background 0.15s;" data-row-sub="${s.id}" class="tup-grade-row">
                    <!-- # -->
                    <td style="padding:6px 6px; text-align:center; font-family:var(--font-mono); color:var(--text-muted); font-size:0.75rem; border-right:1px solid rgba(139, 92, 246, 0.1);">
                      ${idx + 1}
                    </td>

                    <!-- Subject Code (Editable) -->
                    <td style="padding:4px 6px; border-right:1px solid rgba(139, 92, 246, 0.1);">
                      <input type="text"
                        class="tup-edit-input tup-input-code"
                        aria-label="${s.code || 'Subject'} course code"
                        data-sub-id="${s.id}"
                        data-field="code"
                        value="${s.code || ''}"
                        placeholder="Code"
                        style="font-family:var(--font-mono); font-weight:700; color:var(--accent-primary);"
                        title="Click to edit subject code"
                      />
                    </td>

                    <!-- Description (Editable) -->
                    <td style="padding:4px 6px; border-right:1px solid rgba(139, 92, 246, 0.1);">
                      <input type="text"
                        class="tup-edit-input tup-input-name"
                        aria-label="${s.code || 'Subject'} course description"
                        data-sub-id="${s.id}"
                        data-field="name"
                        value="${s.name || ''}"
                        placeholder="Subject Description"
                        style="font-weight:600; color:var(--text-primary);"
                        title="Click to edit description"
                      />
                    </td>

                    <!-- Faculty Name (Editable) -->
                    <td style="padding:4px 6px; border-right:1px solid rgba(139, 92, 246, 0.1);">
                      <input type="text"
                        class="tup-edit-input tup-input-instructor"
                        aria-label="${s.code || 'Subject'} faculty name"
                        data-sub-id="${s.id}"
                        data-field="instructor"
                        value="${faculty}"
                        placeholder="Faculty Name"
                        style="font-size:0.78rem; color:var(--text-secondary);"
                        title="Click to edit faculty name"
                      />
                    </td>

                    <!-- Units (Editable) -->
                    <td style="padding:4px 6px; text-align:center; border-right:1px solid rgba(139, 92, 246, 0.1);">
                      <input type="number" min="0" max="15" step="1"
                        class="tup-edit-input tup-input-units"
                        aria-label="${s.code || 'Subject'} enrolled units"
                        data-sub-id="${s.id}"
                        data-field="units"
                        value="${s.units !== undefined && s.units !== null ? s.units : 3}"
                        placeholder="3"
                        style="text-align:center; font-family:var(--font-mono); font-weight:700; color:var(--text-primary); width:46px; margin:0 auto; display:block;"
                        title="Click to edit units"
                      />
                    </td>

                    <!-- Section -->
                    <td style="padding:6px 6px; text-align:center; font-family:var(--font-mono); font-size:0.72rem; color:var(--text-muted); border-right:1px solid rgba(139, 92, 246, 0.1);">
                      ${DEFAULT_SECTION}
                    </td>

                    <!-- PRELIM Input -->
                    <td style="padding:5px 6px; text-align:center; border-right:1px solid rgba(139, 92, 246, 0.1);">
                      <input type="text" inputmode="decimal"
                        class="tup-term-input"
                        aria-label="${s.code || 'Subject'} prelim grade"
                        data-sub-id="${s.id}"
                        data-term="prelim"
                        value="${pVal}"
                        placeholder="—"
                        style="width:58px; padding:4px; font-family:var(--font-mono); font-size:0.8rem; font-weight:700; text-align:center; background:rgba(5, 4, 10, 0.95); border:1px solid rgba(139, 92, 246, 0.35); border-radius:2px; color:#ffffff;"
                      />
                    </td>

                    <!-- MIDTERM Input -->
                    <td style="padding:5px 6px; text-align:center; border-right:1px solid rgba(139, 92, 246, 0.1);">
                      <input type="text" inputmode="decimal"
                        class="tup-term-input"
                        aria-label="${s.code || 'Subject'} midterm grade"
                        data-sub-id="${s.id}"
                        data-term="midterm"
                        value="${mVal}"
                        placeholder="—"
                        style="width:58px; padding:4px; font-family:var(--font-mono); font-size:0.8rem; font-weight:700; text-align:center; background:rgba(5, 4, 10, 0.95); border:1px solid rgba(139, 92, 246, 0.35); border-radius:2px; color:#ffffff;"
                      />
                    </td>

                    <!-- ENDTERM Input -->
                    <td style="padding:5px 6px; text-align:center; border-right:1px solid rgba(139, 92, 246, 0.1);">
                      <input type="text" inputmode="decimal"
                        class="tup-term-input"
                        aria-label="${s.code || 'Subject'} endterm grade"
                        data-sub-id="${s.id}"
                        data-term="endterm"
                        value="${eVal}"
                        placeholder="—"
                        style="width:58px; padding:4px; font-family:var(--font-mono); font-size:0.8rem; font-weight:700; text-align:center; background:rgba(5, 4, 10, 0.95); border:1px solid rgba(139, 92, 246, 0.35); border-radius:2px; color:#ffffff;"
                      />
                    </td>

                    <!-- AVERAGE -->
                    <td style="padding:6px 6px; text-align:center; font-family:var(--font-mono); font-weight:800; font-size:0.88rem; color:${info.statusColor}; border-right:1px solid rgba(139, 92, 246, 0.1);" data-avg-for="${s.id}">
                      ${info.avgStr}
                    </td>

                    <!-- Grade Status -->
                    <td style="padding:6px 6px; text-align:center; font-family:var(--font-mono); font-size:0.72rem; font-weight:700;" data-status-for="${s.id}">
                      <span style="color:${info.statusColor};">${info.statusStr}</span>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>

        <section class="smart-goal-section" aria-label="Smart Grade Goal Planner">
          <div class="card-header"><div><h2 class="card-title">Smart Grade Goal Planner</h2><p class="card-subtitle">Prelim 30% · Midterm 30% · Endterm 40% · Scale ${MIN}–${MAX} · ${higherIsBetter ? 'Higher' : 'Lower'} is better</p></div></div>
          <p class="goal-scale-note">Use your school's reported term grades on the selected scale. Raw scores and transmuted grades must be converted by your school's rules before entry.</p>
          <div class="goal-planners">${subjects.map(s => gradePlannerMarkup(effectiveSubject(s),settings)).join('')}</div>
        </section>

      </div>
    `;

    attachGradingForm();
    subjects.forEach(subject => {
      const element = container.querySelector(`[data-goal-subject="${subject.id}"]`);
      if (element) plannerControllers.set(subject.id, bindGradePlanner(element, settings,
        () => effectiveSubject(db.getSubjectById(subject.id)), updates => db.updateSubject(subject.id,updates)));
    });
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
          const unitsNum = parseInt(val, 10);
          const safeUnits = isNaN(unitsNum) || unitsNum < 0 ? 0 : unitsNum;
          db.updateSubject(subId, { units: safeUnits });

          // Update Total Enrolled Units in evaluation header
          const allSubs = db.getSubjects();
          const newTotalUnits = allSubs.reduce((acc, s) => acc + (s.units || 0), 0);
          const totalUnitsEl = container.querySelector('#tup-total-units');
          if (totalUnitsEl) totalUnitsEl.textContent = `${newTotalUnits} Units`;

          // Recalculate GPA with new units weight
          const gpaVal = calculateGPA(allSubs);
          const gpaEl = container.querySelector('#tup-overall-gpa');
          if (gpaEl) gpaEl.textContent = gpaVal;
        } else if (field === 'code') {
          db.updateSubject(subId, { code: val || '—' });
          const projCodeEl = container.querySelector(`[data-proj-code="${subId}"]`);
          if (projCodeEl) projCodeEl.textContent = val || '—';
        } else if (field === 'name') {
          db.updateSubject(subId, { name: val || '—' });
        } else if (field === 'instructor') {
          db.updateSubject(subId, { instructor: val || '' });
        }
      });
    });

    // Term Grade Inputs (Prelim, Midterm, Endterm)
    container.querySelectorAll('.tup-term-input').forEach(input => {
      input.addEventListener('input', (e) => {
        const raw = e.target.value.trim();
        const term = e.target.getAttribute('data-term');
        const subId = e.target.getAttribute('data-sub-id');
        const subject = db.getSubjectById(subId);
        if (!subject) return;

        const grades = { ...(subject.grades || {}) };
        const draft = { ...drafts.get(subId) };
        delete draft[term];
        let valid = true;
        if (raw === '') {
          grades[term] = null;
        } else {
          const val = Number(raw);
          if (Number.isFinite(val) && val >= MIN && val <= MAX && /^[-+]?\d*\.?\d+$/.test(raw)) {
            grades[term] = val;
          } else {
            draft[term] = raw;
            valid = false;
          }
        }

        drafts.set(subId, draft);
        e.target.setCustomValidity(valid ? '' : `Enter a grade from ${MIN} to ${MAX}.`);
        e.target.setAttribute('aria-invalid', String(!valid));
        if (valid) db.updateSubject(subId, { grades });

        // Update row Average and Status immediately in place
        const updatedSub = db.getSubjectById(subId);
        const info = getSubjectAverageAndStatus(updatedSub);
        plannerControllers.get(subId)?.refresh();
        const avgCell = container.querySelector(`[data-avg-for="${subId}"]`);
        const statusCell = container.querySelector(`[data-status-for="${subId}"]`);

        if (avgCell) {
          avgCell.textContent = info.avgStr;
          avgCell.style.color = info.statusColor;
        }
        if (statusCell) {
          statusCell.innerHTML = `<span style="color:${info.statusColor};">${info.statusStr}</span>`;
        }

        // Update Overall GPA display in place
        const allSubs = db.getSubjects();
        const gpaVal = calculateGPA(allSubs);
        const gpaEl = container.querySelector('#tup-overall-gpa');
        if (gpaEl) gpaEl.textContent = gpaVal;
      });
    });
  }

  render();
}
