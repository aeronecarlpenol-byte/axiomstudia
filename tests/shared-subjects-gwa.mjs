import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { calculateGWA } from '../js/grading.js';

const scale = { minimum: 0, maximum: 100 };
const subjects = [
  { id: 'a', name: 'Math', units: 3, grades: { prelim: 80, midterm: 85, endterm: 90 } },
  { id: 'b', name: 'Science', units: 2, grades: { prelim: 90, midterm: 95, endterm: 100 } }
];
for (const [term, expected] of Object.entries({ prelim: 84, midterm: 89, endterm: 94, final: 89.5 })) {
  const result = calculateGWA(subjects, scale, term);
  assert.equal(result.value, expected);
  assert.equal(result.partial, false);
}
for (const units of [null, undefined, '', ' ', false, 0, -1, 'invalid']) {
  const result = calculateGWA([...subjects, { name: 'Unknown units', units, grades: subjects[0].grades }], scale);
  assert.equal(result.value, 89.5);
  assert.equal(result.partial, true);
  assert.deepEqual(result.incomplete[0].missing, ['academic units']);
}
const partial = [...subjects, { name: 'History', units: 5, grades: { prelim: 0, midterm: null, endterm: 90 } }];
assert.equal(calculateGWA(partial, scale, 'prelim').value, 42, 'A real zero grade is valid');
assert.equal(calculateGWA(partial, scale, 'midterm').value, 89);
assert.deepEqual(calculateGWA(partial, scale).incomplete[0].missing, ['midterm']);
partial[2].excludeFromGWA = true;
assert.equal(calculateGWA(partial, scale).partial, false);
assert.equal(calculateGWA([], scale).value, null);
assert.equal(calculateGWA([{ units: 3, grades: {} }], scale).value, null);
assert.equal(calculateGWA([{ units: 1, grades: { prelim: 1 } }, { units: 2, grades: { prelim: 2 } }], scale, 'prelim').value, 5 / 3);

const legacy = { userProfile: { semester: '1st Semester', schoolYear: '2026–2027' }, subjects,
  tasks: [{ id: 'task', subjectId: 'a', status: 'completed' }],
  resources: [{ id: 'pdf', subjectId: 'a', pdfStorageId: 'blob', lastPage: 18 }],
  focusSessions: [{ subjectId: 'a', duration: 1500 }], topics: [{ subjectId: 'a', completed: true }],
  pdfProgress: { blob: { page: 18 } }, pdfBookmarks: { blob: [18] } };
const key = 'axiom_studia_database_v16';
const storage = new Map([[key, JSON.stringify(legacy)]]);
const context = vm.createContext({ console, localStorage: {
  getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value),
  key: index => [...storage.keys()][index], get length() { return storage.size; }
} });
vm.runInContext(fs.readFileSync(new URL('../js/grading.js', import.meta.url), 'utf8').replaceAll('export ', ''), context);
vm.runInContext(fs.readFileSync(new URL('../js/db.js', import.meta.url), 'utf8').replace(/^import .*;$/gm, '').replace('export const db = new Database();', 'globalThis.db = new Database();'), context);
let migrated = JSON.parse(storage.get(key));
assert.equal(migrated.subjects.length, 2);
for (const field of ['tasks', 'resources', 'focusSessions', 'topics', 'pdfProgress', 'pdfBookmarks']) assert.deepEqual(migrated[field], legacy[field]);
assert.deepEqual(migrated.subjects[0].grades, subjects[0].grades);
assert.deepEqual(migrated.subjects[0].academicPeriod, { semester: '1st Semester', schoolYear: '2026–2027' });
context.db.data = context.db.load();
assert.equal(storage.get(key), JSON.stringify(migrated), 'Migration is idempotent');
context.db.updateUserProfile({ semester: '2nd Semester' });
assert.equal(context.db.getSubjectPeriod(context.db.getSubjectById('a')).semester, '1st Semester');
context.db.updateSubject('a', { name: 'Renamed Math', academicPeriod: { semester: '2nd Semester', schoolYear: '2026–2027' } });
assert.equal(context.db.getSubjects()[0].name, 'Renamed Math');
assert.equal(context.db.getResources()[0].subjectId, 'a');
const first = context.db.addSubject({ name: 'New subject' });
const second = context.db.addSubject({ name: 'Another subject' });
assert.notEqual(first.id, second.id);
console.log('Shared subjects, period migration, linked-data preservation, complete/partial/excluded GWA, zero grades, missing units, and precision passed.');
