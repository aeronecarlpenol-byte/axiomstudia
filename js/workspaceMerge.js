/** Merge independent edits while preserving record IDs and explicit deletions. */
export function mergeWorkspaces(base, local, remote, prefer = 'local') {
  const missing = Symbol('missing');
  let conflicts = 0;
  const equal = (a, b) => {
    if (a === missing || b === missing) return a === b;
    const stable = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
    return stable(a) === stable(b);
  };
  const object = value => value !== missing && value !== null && typeof value === 'object' && !Array.isArray(value);
  const merge = (original, left, right) => {
    if (equal(left, right)) return left;
    if (equal(left, original)) return right;
    if (equal(right, original)) return left;
    if (object(left) && object(right) && (object(original) || original === missing)) {
      const result = {};
      for (const key of new Set([...Object.keys(left), ...Object.keys(right), ...Object.keys(original === missing ? {} : original)])) {
        const value = merge(original !== missing && Object.hasOwn(original, key) ? original[key] : missing,
          Object.hasOwn(left, key) ? left[key] : missing, Object.hasOwn(right, key) ? right[key] : missing);
        if (value !== missing) result[key] = value;
      }
      return result;
    }
    const records = value => Array.isArray(value) && value.every(item => object(item) && typeof item.id === 'string') && new Set(value.map(item => item.id)).size === value.length;
    if (records(left) && records(right) && (records(original) || original === missing)) {
      const before = new Map((original === missing ? [] : original).map(item => [item.id, item]));
      const a = new Map(left.map(item => [item.id, item]));
      const b = new Map(right.map(item => [item.id, item]));
      const result = [];
      for (const id of new Set([...a.keys(), ...b.keys(), ...before.keys()])) {
        const value = merge(before.has(id) ? before.get(id) : missing, a.has(id) ? a.get(id) : missing, b.has(id) ? b.get(id) : missing);
        if (value !== missing) result.push(value);
      }
      return result;
    }
    conflicts++;
    return prefer === 'remote' ? right : left;
  };
  return { value: merge(base, local, remote), conflicts };
}
