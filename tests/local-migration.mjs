import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const key = 'axiom_studia_database_v16';
const legacy = { userProfile: { name: 'Existing visitor' },
  subjects: [{ id: 'kept-subject', grades: { prelim: 8.25 } }],
  tasks: [{ id: 'kept-task' }], resources: [{ id: 'kept-pdf', type: 'pdf', pdfStorageId: 'existing-blob' }] };
const storage = new Map([
  ['axiom_studia_database_v15', JSON.stringify(legacy)],
  ['axiom_pdf_progress', '{"notes.pdf":{"page":18}}'],
  ['axiom_pdf_bookmarks', '{"notes.pdf":[2,18]}'],
  ['axiom_study_activity', '{"type":"pdf_read","resourceId":"kept-pdf"}']
]);
const context = vm.createContext({ console, localStorage: {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  key: index => [...storage.keys()][index],
  get length() { return storage.size; }
} });
vm.runInContext(fs.readFileSync(new URL('../js/grading.js', import.meta.url), 'utf8').replaceAll('export ', ''), context);
const source = fs.readFileSync(new URL('../js/db.js', import.meta.url), 'utf8')
  .replace(/^import .*;$/gm, '').replace('export const db = new Database();', 'globalThis.db = new Database();');
vm.runInContext(source, context);
context.db.save();
const migrated = JSON.parse(storage.get(key));
assert.deepEqual(migrated.subjects, legacy.subjects);
assert.deepEqual(migrated.tasks, legacy.tasks);
assert.deepEqual(migrated.resources, legacy.resources);
assert.equal(migrated.pdfProgress['notes.pdf'].page, 18);
assert.deepEqual(migrated.pdfBookmarks['notes.pdf'], [2, 18]);
assert.equal(migrated.studyActivity.resourceId, 'kept-pdf');
assert.equal(storage.get('axiom_studia_database_v15'), JSON.stringify(legacy));
assert.ok(storage.has('axiom_pdf_progress'));
context.db.data = context.db.load(); context.db.save();
assert.deepEqual(JSON.parse(storage.get(key)), migrated, 'Repeating local migration must be idempotent');
console.log('Local migration passed: legacy workspace, grades, IDs, PDF references, reading progress, bookmarks, activity, original-key retention, and retry without duplicates.');
