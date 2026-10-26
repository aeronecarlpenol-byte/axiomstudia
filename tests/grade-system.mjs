import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const databaseSource = fs.readFileSync(new URL('../js/db.js', import.meta.url), 'utf8')
  .replace('export const db = new Database();', 'globalThis.db = new Database();');
const storage = new Map([
  ['axiom_studia_fresh_start_v1', 'done'],
  ['axiom_studia_database_v16', JSON.stringify({
    subjects: [{ id: 'math', code: 'MATH', units: 3, grades: { prelim: 6, midterm: 4, endterm: null } }],
    tasks: [], userProfile: {}, formulas: [{ name: 'old' }], textbooks: [{ title: 'old' }],
    habits: [{ name: 'old' }], inboxItems: [{ content: 'old' }],
    stoicQuotes: [{ quote: 'old' }], motivationReminders: [{ message: 'old' }]
  })]
]);
const context = vm.createContext({
  console,
  localStorage: {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: key => storage.delete(key),
    key: index => [...storage.keys()][index],
    get length() { return storage.size; }
  }
});
vm.runInContext(databaseSource, context);
for (const key of ['formulas', 'textbooks', 'habits', 'inboxItems', 'stoicQuotes', 'motivationReminders']) {
  assert.equal(key in JSON.parse(storage.get('axiom_studia_database_v16')), false);
  assert.equal(key in JSON.parse(context.db.exportJSON()), false);
}
assert.equal(context.db.getGradingSystem().passing, 5);
context.db.importJSON(JSON.stringify({ subjects: [], tasks: [], formulas: [{ name: 'old' }] }));
assert.equal('formulas' in JSON.parse(context.db.exportJSON()), false);

const viewSource = fs.readFileSync(new URL('../js/views/gradesView.js', import.meta.url), 'utf8')
  .replace("import { db } from '../db.js';", 'const db = globalThis.db;')
  .replace('export function renderGrades', 'globalThis.renderGrades = function renderGrades');
vm.runInContext(viewSource, context);
const container = {
  innerHTML: '', querySelector: () => null, querySelectorAll: () => []
};
context.db.addSubject({ code: 'MATH', units: 3, grades: { prelim: 6, midterm: 4, endterm: null } });
context.renderGrades(container);
assert.match(container.innerHTML, /Need ≥ 5\.00 average in remaining/);

context.db.updateGradingSystem({
  minimum: 1, maximum: 5, passing: 3, direction: 'lower',
  weights: { prelim: 30, midterm: 30, endterm: 40 }
});
context.db.updateSubject(context.db.getSubjects()[0].id, { grades: { prelim: 2, midterm: 4, endterm: null } });
context.renderGrades(container);
assert.match(container.innerHTML, /Need ≤ 3\.00 average in remaining/);
assert.match(container.innerHTML, /Lower is better/);
console.log('Grade calculations and removed-data migration passed.');
