import { GRADE_WEIGHTS, gradeValue, planGradeGoal } from '../grading.js';

const plannerEscape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const plannerNumber = value => Number.isFinite(value) ? value.toFixed(2) : '—';
const plannerLabels = { prelim: 'Prelim', midterm: 'Midterm', endterm: 'Endterm' };
const plannerStatuses = { invalid: 'Check Inputs', achievable: 'Goal Achievable', secured: 'Goal Secured', unreachable: 'Goal Unreachable', achieved: 'Target Achieved', below: 'Below Target' };

function plannerResults(subject, scale, result) {
  const id = plannerEscape(subject.id);
  if (result.status === 'invalid') return `<p class="goal-status" data-goal-status>Check Inputs</p><p data-proj-note="${id}">Enter valid recorded grades and a target within your scale.</p><span data-proj-exact="${id}"></span>`;
  const scenario = result.scenario;
  const direction = scale.direction === 'lower' ? '≤' : '≥';
  const requirements = Object.entries(scenario.requirements);
  const actual = Object.entries(result.actual).map(([term, value]) => `${plannerLabels[term]}: ${value === null ? 'pending' : plannerNumber(value)}`).join(' · ');
  const requirementText = requirements.length ? requirements.map(([term]) => `Required ${plannerLabels[term]}: ${direction} ${plannerNumber(scenario.grades[term])}`).join(' · ') : result.missing.length ? 'All pending grades are fixed in this scenario.' : 'All grading periods recorded.';
  const recommendation = result.missing.length && scenario.feasible ? `Planned ${result.missing.map(term => `${plannerLabels[term]} ${plannerNumber(scenario.grades[term])}`).join(', ')} gives a final grade of ${plannerNumber(scenario.predicted)}, meeting your target of ${plannerNumber(result.goal)}.` : '';
  const note = !scenario.feasible && result.missing.length ? (result.status === 'unreachable' ? 'Even the best allowed remaining grades cannot reach this target.' : 'Scenario Unreachable: this particular plan cannot reach the target. Adjust a planned grade or release a lock.') : requirementText;
  return `<div class="goal-status goal-status-${result.status}" data-goal-status>${plannerStatuses[result.status]}</div>
    <p class="goal-recorded" data-goal-recorded>Recorded · ${actual}</p>
    <div class="goal-metrics"><div><small>${scale.direction === 'lower' ? 'Maximum allowed requirement' : 'Minimum required grade'}</small><strong data-proj-note="${id}">${note}</strong></div>
      <div><small>${result.missing.length ? 'Predicted final · hypothetical' : 'Recorded final'}</small><strong data-goal-predicted>${plannerNumber(scenario.predicted)}</strong><small>Target ${plannerNumber(result.goal)} · ${scenario.feasible ? 'Verified against the target' : 'Below the selected target'}</small></div></div>
    ${recommendation ? `<p class="goal-recommendation">${recommendation}</p>` : ''}
    ${result.status === 'secured' ? `<p>The goal holds even with ${plannerNumber(result.planWorst)} in every pending period.</p>` : ''}
    ${requirements.length ? `<details><summary>Exact requirements before safe rounding</summary><span data-proj-exact="${id}">${requirements.map(([term,value]) => `${plannerLabels[term]}: ${Number(value.toPrecision(15))}`).join(' · ')}</span></details>` : `<span data-proj-exact="${id}"></span>`}
    ${result.plans.length ? `<details class="goal-alternatives"><summary>Balanced and alternative plans (${result.plans.length})</summary><div class="goal-table-wrap"><table><thead><tr><th>Plan</th>${Object.keys(GRADE_WEIGHTS).map(term=>`<th>${plannerLabels[term]}</th>`).join('')}<th>Final</th></tr></thead><tbody>${result.plans.map(plan=>`<tr><td>${plan.label}</td>${Object.keys(GRADE_WEIGHTS).map(term=>`<td>${plannerNumber(plan.grades[term])}${result.actual[term] === null ? '*' : ''}</td>`).join('')}<td>${plannerNumber(plan.predicted)}</td></tr>`).join('')}</tbody></table></div><small>* Hypothetical grade. Every row is independently verified; recorded grades stay fixed.</small></details>` : ''}
    ${result.tradeoff ? `<p class="goal-insight">Every additional 1 point in Midterm reduces the required Endterm by ${result.tradeoff.toFixed(2)} points.${scale.direction === 'lower' ? ' Lower grades are better on your scale; a lower Midterm permits a higher Endterm.' : ''}</p>` : ''}`;
}

export function gradePlannerMarkup(subject, scale) {
  const state = subject.gradePlanner || {};
  const target = subject.targetGrade ?? scale.passing;
  const result = planGradeGoal(subject.grades, target, scale, state);
  return `<article class="goal-planner" data-goal-subject="${plannerEscape(subject.id)}">
    <header><h3 data-proj-code="${plannerEscape(subject.id)}">${plannerEscape(subject.code || subject.name || 'Subject')}</h3><label class="goal-target">Target final grade <input class="tup-target-input" data-sub-id="${plannerEscape(subject.id)}" aria-label="${plannerEscape(subject.code || 'Subject')} target final grade" type="number" min="${scale.minimum}" max="${scale.maximum}" step="any" value="${gradeValue(target,scale) ?? ''}"></label></header>
    <div data-goal-results aria-live="polite" aria-atomic="true">${plannerResults(subject,scale,result)}</div>
    <fieldset class="goal-controls"><legend>Hypothetical plans · recorded grades stay fixed</legend>
      ${['midterm','endterm'].map(term=>`<div class="goal-slider-row"><label>${plannerLabels[term]} plan <output data-goal-value="${term}">—</output><input type="range" data-goal-slider="${term}" aria-label="${plannerLabels[term]} planned grade" min="${scale.minimum}" max="${scale.maximum}" step="0.01"></label><label class="goal-lock"><input type="checkbox" data-goal-lock="${term}" ${state.locked?.includes(term) ? 'checked' : ''}> Lock ${plannerLabels[term]}</label></div>`).join('')}
      <div class="goal-options"><label><input type="checkbox" data-goal-whole ${state.wholeNumbers ? 'checked' : ''}> Whole-number plans</label><button type="button" class="btn btn-secondary btn-sm" data-goal-balanced>Use balanced plan</button></div>
      <small>Move a slider to fix that planned grade and solve the remaining periods. Lock a grade to keep it fixed while exploring. Pending Prelim grades are planned too.</small>
    </fieldset></article>`;
}

export function bindGradePlanner(element, scale, getSubject, save) {
  let state = { planned: {}, locked: [], ...getSubject().gradePlanner };
  const targetInput = element.querySelector('.tup-target-input');
  let targetDraft;
  function refresh() {
    const subject = getSubject();
    const result = planGradeGoal(subject.grades, targetDraft ?? subject.targetGrade ?? scale.passing, scale, state);
    element.querySelector('[data-goal-results]').innerHTML = plannerResults(subject,scale,result);
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
      lock.disabled = recorded || result.status === 'invalid';
      lock.checked = !recorded && state.locked.includes(term);
      element.querySelector(`[data-goal-value="${term}"]`).textContent = `${plannerNumber(value)}${recorded ? ' · recorded' : ''}`;
    }
    return result;
  }
  targetInput.addEventListener('input',()=>{
    targetDraft = targetInput.value;
    const value = gradeValue(targetDraft,scale);
    targetInput.setCustomValidity(value === null ? 'Enter a target within your grading scale.' : '');
    targetInput.setAttribute('aria-invalid',String(value === null));
    if (value !== null || targetDraft === '') save({ targetGrade: value ?? '' });
    refresh();
  });
  for (const term of ['midterm','endterm']) {
    const slider = element.querySelector(`[data-goal-slider="${term}"]`);
    slider.addEventListener('input',()=>{
      state = { ...state, driver:term, planned:{...state.planned,[term]:Number(slider.value)} };
      save({gradePlanner:state}); refresh();
    });
    element.querySelector(`[data-goal-lock="${term}"]`).addEventListener('change',event=>{
      const value = Number(slider.value);
      state = {...state, driver:null, planned:{...state.planned,[term]:value}, locked:event.target.checked ? [...new Set([...state.locked,term])] : state.locked.filter(item=>item!==term)};
      save({gradePlanner:state}); refresh();
    });
  }
  element.querySelector('[data-goal-whole]').addEventListener('change',event=>{
    state={...state,wholeNumbers:event.target.checked,planned:Object.fromEntries(Object.entries(state.planned).map(([term,value])=>[term,event.target.checked ? Math.round(value) : value]))};
    save({gradePlanner:state}); refresh();
  });
  element.querySelector('[data-goal-balanced]').addEventListener('click',()=>{
    state={...state,driver:null,locked:[],planned:{}};
    save({gradePlanner:state}); refresh();
  });
  refresh();
  return {refresh};
}
