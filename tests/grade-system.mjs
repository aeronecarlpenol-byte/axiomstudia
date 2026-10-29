import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const databaseSource = fs.readFileSync(new URL('../js/db.js', import.meta.url), 'utf8')
  .replace("import { GRADE_WEIGHTS } from './grading.js';", '')
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
vm.runInContext(fs.readFileSync(new URL('../js/grading.js', import.meta.url), 'utf8').replaceAll('export ', ''), context);
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
  .replace(/^import .*;$/gm, '')
  .replace('export function renderGrades', 'globalThis.renderGrades = function renderGrades');
vm.runInContext(fs.readFileSync(new URL('../js/views/gradePlanner.js', import.meta.url), 'utf8').replace(/^import .*;$/gm, '').replaceAll('export ', ''), context);
vm.runInContext(viewSource, context);
const container = {
  innerHTML: '', querySelector: () => null, querySelectorAll: () => []
};
context.db.addSubject({ code: 'MATH', units: 3, grades: { prelim: 6, midterm: 4, endterm: null } });
context.renderGrades(container);
assert.match(container.innerHTML, /Required Endterm: ≥ 5\.00/);

context.db.updateGradingSystem({
  minimum: 1, maximum: 5, passing: 3, direction: 'lower',
  weights: { prelim: 30, midterm: 30, endterm: 40 }
});
context.db.updateSubject(context.db.getSubjects()[0].id, { grades: { prelim: 2, midterm: 4, endterm: null } });
context.renderGrades(container);
assert.match(container.innerHTML, /Required Endterm: ≤ 3\.00/);
assert.match(container.innerHTML, /Lower is better/);
const before = context.db.getSubjects()[0].grades.prelim;
context.db.updateSubject(context.db.getSubjects()[0].id, { gradePlanner: { planned: { midterm: 2 }, locked: ['midterm'], driver: null } });
context.db.updateGradingSystem({ minimum: 0, maximum: 100, passing: 50, direction: 'higher', weights: { prelim: 90, midterm: 10, endterm: 0 } });
assert.equal(context.db.getSubjects()[0].grades.prelim, (1 - (before - 1) / 4) * 100);
assert.equal(context.db.getGradingSystem().weights.endterm, 40);
assert.equal(context.db.getSubjects()[0].grades.endterm, null);
assert.equal(context.db.getSubjects()[0].gradePlanner.planned.midterm, 75);
assert.equal(context.db.getSubjects()[0].gradePlanner.locked[0], 'midterm');
console.log('Grade calculations and removed-data migration passed.');
