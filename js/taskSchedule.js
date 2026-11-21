/** Calendar dates are local YYYY-MM-DD keys, never UTC timestamps. */
export function validDateKey(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

export function scheduledDateFromDeadline(deadline) {
  if (typeof deadline !== 'string') return null;
  const day = deadline.slice(0, 10);
  if (!validDateKey(day)) return null;
  // Absolute legacy timestamps were displayed in local time, so migrate the
  // local calendar day the student actually saw.
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(deadline)) {
    const date = new Date(deadline);
    if (Number.isNaN(date.getTime())) return null;
    const pad = number => String(number).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }
  return day;
}

export function taskScheduledDate(task) {
  if (validDateKey(task?.scheduledDate)) return task.scheduledDate;
  return task && !Object.hasOwn(task, 'scheduledDate') && scheduledDateFromDeadline(task.deadline) || todayTaskDate();
}

export function todayTaskDate() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function migrateTaskSchedules(data) {
  let changed = false;
  for (const task of data.tasks || []) {
    if (!validDateKey(task.scheduledDate)) {
      task.scheduledDate = taskScheduledDate(task);
      if (!task.deadline) task.deadline = task.scheduledDate;
      changed = true;
    }
  }
  return changed;
}
