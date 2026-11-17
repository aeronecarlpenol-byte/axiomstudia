import assert from 'node:assert/strict';
import { validDateKey, scheduledDateFromDeadline, taskScheduledDate, migrateTaskSchedules } from '../js/taskSchedule.js';

assert.equal(validDateKey('2026-02-28'), true);
assert.equal(validDateKey('2026-02-29'), false);
assert.equal(validDateKey('2026-11-20T09:00'), false);
assert.equal(scheduledDateFromDeadline('2026-11-20T15:00'), '2026-11-20');
assert.equal(taskScheduledDate({ scheduledDate: '2026-11-20', deadline: '2026-11-21T15:00' }), '2026-11-20');
assert.equal(taskScheduledDate({ scheduledDate: null, deadline: '2026-11-21T15:00' }), null);
const data = { tasks: [{ id: 'legacy', deadline: '2026-11-20T15:00' }, { id: 'unscheduled' }, { id: 'moved', scheduledDate: null, deadline: '2026-11-21' }] };
assert.equal(migrateTaskSchedules(data), true);
assert.deepEqual(data.tasks.map(task => task.scheduledDate), ['2026-11-20', null, null]);
assert.equal(migrateTaskSchedules(data), false);
assert.equal(data.tasks.length, 3);
console.log('Task scheduling date validation, legacy migration, explicit unscheduling, and idempotence passed.');
