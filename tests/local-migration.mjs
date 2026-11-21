import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const key = 'axiom_studia_database_v16';
const legacy = { userProfile: { name: 'Existing visitor', studentId: 'retired-id' },
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
vm.runInContext(fs.readFileSync(new URL('../js/calendarClassification.js', import.meta.url), 'utf8').replaceAll('export ', ''), context);
vm.runInContext(fs.readFileSync(new URL('../js/taskSchedule.js', import.meta.url), 'utf8').replaceAll('export ', ''), context);
const source = fs.readFileSync(new URL('../js/db.js', import.meta.url), 'utf8')
  .replace(/^import .*;$/gm, '').replace('export const db = new Database();', 'globalThis.db = new Database();');
vm.runInContext(source, context);
context.db.save();
const migrated = JSON.parse(storage.get(key));
assert.deepEqual(migrated.subjects.map(({ academicPeriod, ...subject }) => subject), legacy.subjects);
assert.deepEqual(migrated.subjects[0].academicPeriod, { semester: '', schoolYear: '' });
assert.deepEqual(migrated.tasks, [{ ...legacy.tasks[0], scheduledDate: null }]);
assert.deepEqual(migrated.resources, legacy.resources);
assert.equal(migrated.pdfProgress['notes.pdf'].page, 18);
assert.deepEqual(migrated.pdfBookmarks['notes.pdf'], [2, 18]);
assert.equal(migrated.studyActivity.resourceId, 'kept-pdf');
assert.equal('studentId' in migrated.userProfile, false);
const sanitizedLegacy = JSON.parse(JSON.stringify(legacy));
delete sanitizedLegacy.userProfile.studentId;
assert.deepEqual(JSON.parse(storage.get('axiom_studia_database_v15')), sanitizedLegacy, 'Only the retired student ID is removed from legacy recovery data');
assert.ok(storage.has('axiom_pdf_progress'));
context.db.data = context.db.load(); context.db.save();
assert.deepEqual(JSON.parse(storage.get(key)), migrated, 'Repeating local migration must be idempotent');
console.log('Local migration passed: legacy workspace, grades, IDs, PDF references, reading progress, bookmarks, activity, original-key retention, and retry without duplicates.');

const agenda = context.db.addTask({
  title: 'Legacy quiz', taskType: 'quiz', subjectId: 'kept-subject', deadline: '2020-01-02T09:00',
  description: 'Bring calculator', reminders: [60], status: 'completed', completedAt: '2020-01-02T10:00'
});
assert.equal(context.db.getTasks().some(task => task.id === agenda.id), false);
let event = context.db.getExamById(agenda.id);
assert.equal(event.description, 'Bring calculator');
assert.equal(event.date, '2020-01-02T09:00');
assert.equal(context.db.getOverdueTasks().some(task => task.id === agenda.id), false);
context.db.updateExam(event.id, { eventType: 'assignment' });
assert.equal(context.db.getExamById(event.id), undefined);
assert.equal(context.db.getTaskById(event.id).taskType, 'assignment');
context.db.updateTask(event.id, { taskType: 'exam' });
assert.equal(context.db.getTaskById(event.id), undefined);
assert.equal(context.db.getExamById(event.id).reminders[0], 60);
context.db.data = context.db.load();
assert.equal(context.db.getTasks().some(task => task.id === event.id), false);
console.log('Calendar classification preserves IDs, notes, reminders and historical state across conversions.');

const progress = { id: 'timer-checkpoint', startTime: '2026-11-22T01:00:00Z', subjectId: 'kept-subject', durationSeconds: 0, durationMinutes: 0 };
context.db.addFocusSession(progress, { progress: true });
context.db.addFocusSession({ ...progress, durationSeconds: 73, durationMinutes: 73 / 60 }, { progress: true });
context.db.data = context.db.load();
assert.equal(context.db.getFocusSessions().filter(s => s.id === progress.id).length, 1);
assert.equal(context.db.getFocusSessions().find(s => s.id === progress.id).durationSeconds, 73, 'live progress survives reload before completion');
context.db.addFocusSession({ ...progress, durationSeconds: 120, durationMinutes: 2 }, { recordOnly: true });
assert.equal(context.db.getFocusSessions().find(s => s.id === progress.id).durationSeconds, 120, 'completion replaces partial time');
assert.equal(context.db.getFocusSessions().find(s => s.id === progress.id).inProgress, undefined);
context.db.addFocusSession({ ...progress, durationSeconds: 80 }, { progress: true });
assert.equal(context.db.getFocusSessions().find(s => s.id === progress.id).durationSeconds, 120, 'stale checkpoints cannot overwrite completion');
context.db.addFocusSession({ ...progress, durationSeconds: 120, durationMinutes: 2, completedGoal: 'partial' });
assert.equal(context.db.getFocusSessions().filter(s => s.id === progress.id).length, 1, 'study log reuses the progress record');
console.log('Live study records survive reload, update in place, finalize once, and reject stale checkpoints.');
