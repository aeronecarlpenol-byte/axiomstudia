// All terms use the same scale; affine normalization preserves weighted averages.
export const GRADE_WEIGHTS = Object.freeze({ prelim: 30, midterm: 30, endterm: 40 });

export function gradeValue(value, scale) {
  if (value === null || value === undefined || String(value).trim() === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= scale.minimum && number <= scale.maximum ? number : null;
}

export function averageGrade(grades, scale, complete = false) {
  if (!(scale.maximum > scale.minimum)) return null;
  let points = 0, weight = 0;
  for (const [term, percent] of Object.entries(GRADE_WEIGHTS)) {
    const value = gradeValue(grades[term], scale);
    if (value === null) { if (complete) return null; continue; }
    points += value * percent;
    weight += percent;
  }
  return weight ? points / weight : null;
}

export function meetsGradeTarget(value, target, scale) {
  return Number.isFinite(value) && (scale.direction === 'lower' ? value <= target : value >= target);
}

// Round only hypothetical requirements, toward the better grade on this scale.
export function roundRequiredGrade(value, scale, wholeNumbers = false) {
  const factor = wholeNumbers ? 1 : 100;
  const scaled = value * factor;
  const nearest = Math.round(scaled);
  const stable = Math.abs(scaled - nearest) < 1e-10 ? nearest : scaled;
  return (scale.direction === 'lower' ? Math.floor(stable) : Math.ceil(stable)) / factor;
}

export function planGradeGoal(recorded = {}, target, scale, options = {}) {
  const terms = Object.keys(GRADE_WEIGHTS);
  const goal = gradeValue(target, scale);
  const actual = Object.fromEntries(terms.map(term => [term, gradeValue(recorded[term], scale)]));
  const malformed = terms.some(term => recorded[term] !== null && recorded[term] !== undefined && String(recorded[term]).trim() !== '' && actual[term] === null);
  if (goal === null || malformed || !Number.isFinite(scale.minimum) || !Number.isFinite(scale.maximum) || !(scale.maximum > scale.minimum)) {
    return { status: 'invalid', actual, plans: [], scenario: null, missing: [], goal };
  }
  const missing = terms.filter(term => actual[term] === null);
  const lower = scale.direction === 'lower';
  const whole = options.wholeNumbers === true;
  const step = whole ? 1 : 0.01;
  const minPlan = Math.ceil(scale.minimum / step) * step;
  const maxPlan = Math.floor(scale.maximum / step) * step;
  const planWorst = lower ? maxPlan : minPlan;
  const planBest = lower ? minPlan : maxPlan;
  const best = whole ? planBest : lower ? scale.minimum : scale.maximum;
  const worst = whole ? planWorst : lower ? scale.maximum : scale.minimum;
  const final = grades => averageGrade(grades, scale, true);
  const complete = fill => final(Object.fromEntries(terms.map(term => [term, actual[term] ?? fill])));
  const bestFinal = complete(best), worstFinal = complete(worst);
  const status = !missing.length ? (meetsGradeTarget(bestFinal, goal, scale) ? 'achieved' : 'below') :
    (whole && minPlan > maxPlan) || !meetsGradeTarget(bestFinal, goal, scale) ? 'unreachable' : meetsGradeTarget(worstFinal, goal, scale) ? 'secured' : 'achievable';

  function solve(fixed = {}, label = 'Balanced Plan') {
    const grades = { ...actual };
    const invalidFixed = missing.some(term => term in fixed && (gradeValue(fixed[term], scale) === null || (whole && !Number.isInteger(Number(fixed[term])))));
    if (invalidFixed || minPlan > maxPlan) return { label, feasible: false, predicted: null, grades, requirements: {}, reason: 'Enter valid planned grades on the selected scale.' };
    for (const term of missing) if (term in fixed) grades[term] = Number(fixed[term]);
    const free = missing.filter(term => grades[term] === null);
    const fixedPoints = terms.reduce((sum, term) => sum + (grades[term] ?? 0) * GRADE_WEIGHTS[term], 0);
    const remainingWeight = free.reduce((sum, term) => sum + GRADE_WEIGHTS[term], 0);
    const exact = remainingWeight ? (goal * 100 - fixedPoints) / remainingWeight : null;
    const requirements = Object.fromEntries(free.map(term => [term, exact]));
    const rounded = exact === null ? null : roundRequiredGrade(exact, scale, whole);
    for (const term of free) grades[term] = Math.min(maxPlan, Math.max(minPlan, rounded));
    let predicted = final(grades);
    // Guard against cancellation at a display boundary. Check the actual formula,
    // then move a free grade one representable step toward the target if needed.
    if (free.length && !meetsGradeTarget(predicted, goal, scale)) {
      const term = free.find(term => lower ? grades[term] > planBest : grades[term] < planBest);
      if (term) {
        grades[term] = Math.min(maxPlan, Math.max(minPlan, Number((grades[term] + (lower ? -step : step)).toFixed(2))));
        predicted = final(grades);
      }
    }
    const feasible = meetsGradeTarget(predicted, goal, scale);
    return { label, feasible, predicted, grades, requirements,
      reason: feasible ? '' : 'This particular plan cannot reach the target within the allowed grades.' };
  }

  const balanced = solve();
  const plans = [];
  const add = plan => { if (plan.feasible && !plans.some(item => terms.every(term => item.grades[term] === plan.grades[term]))) plans.push(plan); };
  if (missing.length) add(balanced);
  if (actual.prelim !== null && missing.includes('midterm') && missing.includes('endterm')) {
    const center = balanced.grades.midterm;
    const offset = (scale.maximum - scale.minimum) * 0.05;
    add(solve({ midterm: Math.min(maxPlan, Math.max(minPlan, roundRequiredGrade(center + (lower ? -offset : offset), scale, whole))) }, 'Midterm-Focused Plan'));
    add(solve({ endterm: Math.min(maxPlan, Math.max(minPlan, roundRequiredGrade(balanced.grades.endterm + (lower ? -offset : offset), scale, whole))) }, 'Endterm-Focused Plan'));
    // Useful comparison rows, derived from this scale rather than assuming percentages.
    for (const fraction of [0.85, 0.9, 0.95, 1]) {
      const midterm = roundRequiredGrade(worst + (best - worst) * fraction, scale, whole);
      add(solve({ midterm }, 'Comparison Plan'));
    }
  }
  const fixed = {};
  for (const term of missing) {
    if (options.locked?.includes(term) || options.driver === term) fixed[term] = options.planned?.[term];
  }
  const scenario = solve(fixed, 'Your Plan');
  return { status, actual, missing, goal, bestFinal, worstFinal, plans, scenario, wholeNumbers: whole,
    tradeoff: missing.includes('midterm') && missing.includes('endterm') ? GRADE_WEIGHTS.midterm / GRADE_WEIGHTS.endterm : null,
    planWorst };
}

export function requiredEndterm(prelim, midterm, target, scale) {
  const values = [prelim, midterm, target].map(value => gradeValue(value, scale));
  if (values.some(value => value === null) || !(scale.maximum > scale.minimum)) return { status: 'missing', value: null };
  const [p, m, goal] = values;
  const value = (goal * 100 - p * GRADE_WEIGHTS.prelim - m * GRADE_WEIGHTS.midterm) / GRADE_WEIGHTS.endterm;
  const lower = scale.direction === 'lower';
  const unreachable = lower ? value < scale.minimum - 1e-9 : value > scale.maximum + 1e-9;
  const secured = lower ? value >= scale.maximum - 1e-9 : value <= scale.minimum + 1e-9;
  return { value, status: unreachable ? 'unreachable' : secured ? 'secured' : 'required' };
}
