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
    points += (value - scale.minimum) / (scale.maximum - scale.minimum) * percent;
    weight += percent;
  }
  return weight ? scale.minimum + points / weight * (scale.maximum - scale.minimum) : null;
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
