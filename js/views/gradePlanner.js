import { GRADE_WEIGHTS, gradeValue, planGradeGoal } from '../grading.js';

const plannerEscape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const plannerNumber = value => Number.isFinite(value) ? value.toFixed(2) : '—';
const plannerLabels = { prelim: 'Prelim', midterm: 'Midterm', endterm: 'Endterm' };
const plannerStatuses = { invalid: 'Check Inputs', achievable: 'Goal Achievable', secured: 'Goal Secured', unreachable: 'Goal Unreachable', achieved: 'Target Achieved', below: 'Below Target' };
const preferredPlanTerm = result => ['midterm', 'endterm', 'prelim'].find(term => result.missing.includes(term));
const plannerRecorded = result => {
  const entries = Object.entries(result.actual).filter(([,value]) => value !== null);
  return entries.length ? `Recorded · ${entries.map(([term,value]) => `${plannerLabels[term]} ${plannerNumber(value)}`).join(' · ')}` : 'No grades recorded yet. All grades below are hypothetical.';
};

function plannerResults(subject, scale, result, plannedTerm) {
  const id = plannerEscape(subject.id);
  if (result.status === 'invalid') return `<p data-proj-note="${id}" class="goal-result">Enter valid recorded grades and a target within your scale.</p><p class="goal-status goal-status-invalid" data-goal-status>Check Inputs</p>`;
  const scenario = result.scenario;
  const lower = scale.direction === 'lower';
  const requirements = Object.keys(scenario.requirements);
  const dependent = requirements.find(term => term !== plannedTerm) || requirements[0];
  let note = dependent ? `Required ${plannerLabels[dependent]}: ${lower ? '≤' : '≥'} ${plannerNumber(scenario.grades[dependent])}` : result.missing.length ? 'Your remaining grades are fixed.' : 'All grading periods recorded.';
  let recommendation = '';
  if (!scenario.feasible && result.missing.length) {
    note = scenario.predicted === null ? 'Enter a valid planned grade.' : result.status === 'unreachable' ? 'The target cannot be reached.' : 'Scenario Unreachable';
    recommendation = result.status === 'unreachable' ? 'Even the best allowed remaining grades cannot reach this target.' : 'Adjust the planned grade or release a lock in Explore Plans.';
  } else if (result.status === 'secured') {
    recommendation = `Your goal holds even with ${plannerNumber(result.planWorst)} in every remaining period.`;
  } else if (result.missing.length) {
    const assumptions = result.missing.filter(term => term !== dependent).map(term => `${plannerLabels[term]} ${plannerNumber(scenario.grades[term])}`);
    recommendation = dependent ? `${assumptions.length ? `With ${assumptions.join(' and ')}, aim for` : 'Aim for'} ${plannerLabels[dependent]} ${plannerNumber(scenario.grades[dependent])} or ${lower ? 'lower' : 'higher'} to reach your target.` : 'This fixed plan meets your target.';
  }
  return `<strong class="goal-result" data-proj-note="${id}">${note}</strong>
    ${recommendation ? `<p class="goal-recommendation">${recommendation}</p>` : ''}
    <p class="goal-prediction">${result.missing.length ? 'Predicted final' : 'Final grade'} <strong data-goal-predicted>${plannerNumber(scenario.predicted)}</strong></p>
    <span class="goal-status goal-status-${result.status}" data-goal-status>${plannerStatuses[result.status]}</span>`;
}

function plannerExploration(subject, scale, result) {
  const id = plannerEscape(subject.id);
  if (result.status === 'invalid') return `<span data-proj-exact="${id}"></span>`;
  const scenario = result.scenario;
  const requirements = Object.entries(scenario.requirements);
  return `${result.plans.length ? `<div class="goal-alternatives"><h4>Balanced and alternative plans</h4><div class="goal-table-wrap"><table><thead><tr><th>Plan</th>${Object.keys(GRADE_WEIGHTS).map(term => `<th>${plannerLabels[term]}</th>`).join('')}<th>Final</th></tr></thead><tbody>${result.plans.map(plan => `<tr><td>${plan.label}</td>${Object.keys(GRADE_WEIGHTS).map(term => `<td>${plannerNumber(plan.grades[term])}${result.actual[term] === null ? '*' : ''}</td>`).join('')}<td>${plannerNumber(plan.predicted)}</td></tr>`).join('')}</tbody></table></div><small>* Planned grades. Recorded grades stay fixed.</small></div>` : ''}
    <div class="goal-breakdown"><h4>Calculation details</h4><p>Prelim ${GRADE_WEIGHTS.prelim}% + Midterm ${GRADE_WEIGHTS.midterm}% + Endterm ${GRADE_WEIGHTS.endterm}%</p>
      <p>${Object.keys(GRADE_WEIGHTS).map(term => `${plannerLabels[term]} ${plannerNumber(scenario.grades[term])} × ${GRADE_WEIGHTS[term] / 100}`).join(' + ')} = ${plannerNumber(scenario.predicted)}</p>
      <p data-proj-exact="${id}">${requirements.length ? `Before rounding: ${requirements.map(([term,value]) => `${plannerLabels[term]} ${Number(value.toPrecision(15))}`).join(' · ')}` : 'No dependent grades to solve.'}</p>
      <small>Required grades round toward your target. Scale ${scale.minimum}–${scale.maximum}; ${scale.direction === 'lower' ? 'lower' : 'higher'} is better. Use reported term grades; convert raw scores using your school's rules before entry.</small></div>
    ${result.tradeoff ? `<p class="goal-insight">Every additional 1 point in Midterm reduces the required Endterm by ${result.tradeoff.toFixed(2)} points.${scale.direction === 'lower' ? ' Lower grades are better on this scale.' : ''}</p>` : ''}`;
}

export function gradePlannerMarkup(subject, scale) {
  const state = subject.gradePlanner || {};
  const target = subject.targetGrade ?? scale.passing;
  const result = planGradeGoal(subject.grades, target, scale, state);
  const term = result.missing.includes(state.driver) ? state.driver : preferredPlanTerm(result);
  return `<article class="goal-planner" data-goal-subject="${plannerEscape(subject.id)}">
    <header><h3 data-proj-code="${plannerEscape(subject.id)}">${plannerEscape(subject.code || subject.name || 'Subject')}</h3><label class="goal-target">Target final grade <input class="tup-target-input" data-sub-id="${plannerEscape(subject.id)}" aria-label="${plannerEscape(subject.code || 'Subject')} target final grade" type="number" min="${scale.minimum}" max="${scale.maximum}" step="any" value="${gradeValue(target,scale) ?? ''}"></label></header>
    <p class="goal-recorded" data-goal-recorded>${plannerRecorded(result)}</p>
    <div class="goal-plan-entry" data-goal-plan-entry ${result.missing.length < 2 ? 'hidden' : ''}>
      <label>Planned <select data-goal-plan-term aria-label="Choose planned grading period">${result.missing.map(item => `<option value="${item}" ${item === term ? 'selected' : ''}>${plannerLabels[item]}</option>`).join('')}</select></label>
      <input type="number" data-goal-plan-input aria-label="Planned grade" min="${scale.minimum}" max="${scale.maximum}" step="0.01" value="${result.scenario?.grades[term] ?? ''}">
      <small data-goal-plan-hint hidden>Locked in Explore Plans.</small>
    </div>
    <div data-goal-results aria-live="polite" aria-atomic="true">${plannerResults(subject,scale,result,term)}</div>
    <details class="goal-explore" data-goal-explore><summary>Explore Plans</summary>
      <fieldset class="goal-controls"><legend>Adjust scenarios</legend>
        ${['midterm','endterm'].map(item => `<div class="goal-slider-row" data-goal-slider-row="${item}"><label>${plannerLabels[item]} plan <output data-goal-value="${item}">—</output><input type="range" data-goal-slider="${item}" aria-label="${plannerLabels[item]} planned grade" min="${scale.minimum}" max="${scale.maximum}" step="0.01"></label><label class="goal-lock"><input type="checkbox" data-goal-lock="${item}" ${state.locked?.includes(item) ? 'checked' : ''}> Lock ${plannerLabels[item]}</label></div>`).join('')}
        <div class="goal-options"><label><input type="checkbox" data-goal-whole ${state.wholeNumbers ? 'checked' : ''}> Whole-number plans</label><button type="button" class="btn btn-secondary btn-sm" data-goal-balanced>Use balanced plan</button></div>
      </fieldset>
      <div data-goal-exploration>${plannerExploration(subject,scale,result)}</div>
    </details></article>`;
}

export function bindGradePlanner(element, scale, getSubject, save) {
  let state = { planned: {}, locked: [], ...getSubject().gradePlanner };
  const targetInput = element.querySelector('.tup-target-input');
  const planInput = element.querySelector('[data-goal-plan-input]');
  const termInput = element.querySelector('[data-goal-plan-term]');
  let targetDraft;
  let planDraft = null;
  let selectedTerm = state.driver;
  function refresh() {
    const subject = getSubject();
    const options = planDraft ? { ...state, driver:planDraft.term, planned:{...state.planned,[planDraft.term]:planDraft.value} } : state;
    const result = planGradeGoal(subject.grades, targetDraft ?? subject.targetGrade ?? scale.passing, scale, options);
    if (!result.missing.includes(selectedTerm)) selectedTerm = preferredPlanTerm(result);
    element.querySelector('[data-goal-results]').innerHTML = plannerResults(subject,scale,result,selectedTerm);
    element.querySelector('[data-goal-exploration]').innerHTML = plannerExploration(subject,scale,result);
    element.querySelector('[data-goal-recorded]').textContent = plannerRecorded(result);
    element.querySelector('[data-goal-plan-entry]').hidden = result.missing.length < 2;
    const termOptions = result.missing.map(term => `<option value="${term}" ${term === selectedTerm ? 'selected' : ''}>${plannerLabels[term]}</option>`).join('');
    if (termInput.innerHTML !== termOptions) termInput.innerHTML = termOptions;
    termInput.value = selectedTerm || '';
    const locked = state.locked.includes(selectedTerm);
    planInput.disabled = locked || result.status === 'invalid';
    planInput.step = state.wholeNumbers ? '1' : '0.01';
    planInput.min = state.wholeNumbers ? Math.ceil(scale.minimum) : scale.minimum;
    planInput.max = state.wholeNumbers ? Math.floor(scale.maximum) : scale.maximum;
    planInput.setAttribute('aria-label',`${plannerLabels[selectedTerm] || ''} planned grade`);
    if (!planDraft) {
      planInput.value = result.scenario?.grades[selectedTerm] ?? '';
      planInput.setCustomValidity('');
      planInput.setAttribute('aria-invalid','false');
    }
    element.querySelector('[data-goal-plan-hint]').hidden = !locked;
    for (const term of ['midterm','endterm']) {
      const slider = element.querySelector(`[data-goal-slider="${term}"]`);
      const lock = element.querySelector(`[data-goal-lock="${term}"]`);
      const recorded = result.actual[term] !== null;
      const value = recorded ? result.actual[term] : result.scenario?.grades[term] ?? gradeValue(state.planned[term],scale) ?? scale.minimum;
      slider.step = state.wholeNumbers ? '1' : '0.01';
      slider.min = state.wholeNumbers ? Math.ceil(scale.minimum) : scale.minimum;
      slider.max = state.wholeNumbers ? Math.floor(scale.maximum) : scale.maximum;
      slider.value = value;
      slider.disabled = recorded || state.locked.includes(term) || result.status === 'invalid';
      element.querySelector(`[data-goal-slider-row="${term}"]`).hidden = recorded;
      lock.disabled = recorded || result.status === 'invalid';
      lock.checked = !recorded && state.locked.includes(term);
      element.querySelector(`[data-goal-value="${term}"]`).textContent = plannerNumber(value);
    }
    return result;
  }
  function updatePlan(term,value) {
    planDraft = null;
    selectedTerm = term;
    state = { ...state, driver:term, planned:{...state.planned,[term]:value} };
    save({gradePlanner:state}); refresh();
  }
  targetInput.addEventListener('input',()=>{
    targetDraft = targetInput.value;
    const value = gradeValue(targetDraft,scale);
    targetInput.setCustomValidity(value === null ? 'Enter a target within your grading scale.' : '');
    targetInput.setAttribute('aria-invalid',String(value === null));
    if (value !== null || targetDraft === '') save({ targetGrade: value ?? '' });
    refresh();
  });
  planInput.addEventListener('input',()=>{
    const value = gradeValue(planInput.value,scale);
    const valid = value !== null && (!state.wholeNumbers || Number.isInteger(value));
    planInput.setCustomValidity(valid ? '' : 'Enter a valid planned grade on your scale.');
    planInput.setAttribute('aria-invalid',String(!valid));
    if (valid) updatePlan(selectedTerm,value);
    else { planDraft = { term:selectedTerm, value:planInput.value }; refresh(); }
  });
  termInput.addEventListener('change',()=>{
    const term = termInput.value;
    const result = refresh();
    const value = result.scenario?.grades[term];
    if (Number.isFinite(value)) updatePlan(term,value);
  });
  for (const term of ['midterm','endterm']) {
    const slider = element.querySelector(`[data-goal-slider="${term}"]`);
    slider.addEventListener('input',()=>updatePlan(term,Number(slider.value)));
    element.querySelector(`[data-goal-lock="${term}"]`).addEventListener('change',event=>{
      planDraft = null;
      const value = Number(slider.value);
      state = {...state, driver:null, planned:{...state.planned,[term]:value}, locked:event.target.checked ? [...new Set([...state.locked,term])] : state.locked.filter(item=>item!==term)};
      save({gradePlanner:state}); refresh();
    });
  }
  element.querySelector('[data-goal-whole]').addEventListener('change',event=>{
    planDraft = null;
    state={...state,wholeNumbers:event.target.checked,planned:Object.fromEntries(Object.entries(state.planned).map(([term,value])=>[term,event.target.checked ? Math.round(value) : value]))};
    save({gradePlanner:state}); refresh();
  });
  element.querySelector('[data-goal-balanced]').addEventListener('click',()=>{
    planDraft = null;
    state={...state,driver:null,locked:[],planned:{}};
    save({gradePlanner:state}); refresh();
  });
  refresh();
  return {refresh};
}
