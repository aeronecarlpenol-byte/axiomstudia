import assert from 'node:assert/strict';
import { agendaIsDone } from '../js/calendarClassification.js';
import { validDateKey, scheduledDateFromDeadline, taskScheduledDate, migrateTaskSchedules, todayTaskDate } from '../js/taskSchedule.js';

assert.equal(validDateKey('2026-02-28'), true);
assert.equal(validDateKey('2026-02-29'), false);
assert.equal(validDateKey('2026-11-20T09:00'), false);
assert.equal(scheduledDateFromDeadline('2026-11-20T15:00'), '2026-11-20');
assert.equal(taskScheduledDate({ scheduledDate: '2026-11-20', deadline: '2026-11-21T15:00' }), '2026-11-20');
assert.equal(taskScheduledDate({ scheduledDate: null, deadline: '2026-11-21T15:00' }), todayTaskDate());
const data = { tasks: [{ id: 'legacy', deadline: '2026-11-20T15:00' }, { id: 'unscheduled' }, { id: 'moved', scheduledDate: null, deadline: '2026-11-21' }] };
assert.equal(migrateTaskSchedules(data), true);
assert.deepEqual(data.tasks.map(task => task.scheduledDate), ['2026-11-20', todayTaskDate(), todayTaskDate()]);
assert.equal(migrateTaskSchedules(data), false);
assert.equal(data.tasks.length, 3);
console.log('Task scheduling date validation, legacy migration, automatic today scheduling, and idempotence passed.');
const examDay = new Date(2026, 10, 25, 23, 59);
for (const eventType of ['exam', 'quiz', undefined]) {
  assert.equal(agendaIsDone({ eventType, date: '2026-11-25' }, examDay), false, 'exam stays active throughout its scheduled day');
  assert.equal(agendaIsDone({ eventType, date: '2026-11-25T08:00:00' }, examDay), false, 'passing the exam time does not finish its agenda early');
  assert.equal(agendaIsDone({ eventType, date: '2026-11-25' }, new Date(2026, 10, 26)), true, 'exam is done starting the following day');
  assert.equal(agendaIsDone({ eventType, date: '2026-11-26' }, examDay), false, 'future exams stay active');
}
assert.equal(agendaIsDone({ eventType: 'assignment', date: '2026-11-24' }, examDay), false, 'assignments are not automatically completed');
assert.equal(agendaIsDone({ eventType: 'exam', date: 'invalid' }, examDay), false);
