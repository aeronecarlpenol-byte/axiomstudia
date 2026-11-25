export const CALENDAR_TYPES = {
  quiz: 'Quiz', exam: 'Exam', assignment: 'Assignment', project: 'Project Deadline',
  study_session: 'Study Session', personal: 'Personal Event'
};

export function isAgendaType(value) {
  return ['quiz', 'exam', 'study_session', 'personal'].includes(value);
}

// Keep the same IDs and metadata when an entry changes classification.
export function reconcileCalendarEntries(data) {
  data.tasks ||= [];
  data.exams ||= [];
  const agendas = data.tasks.filter(task => isAgendaType(task.eventType || task.taskType));
  const actions = data.exams.filter(event => ['assignment', 'project'].includes(event.eventType));
  if (!agendas.length && !actions.length) return false;
  for (const task of agendas) {
    const linked = data.exams.find(event => event.id === task.id || event.taskId === task.id);
    if (linked) {
      linked.sourceTask = { ...task };
    } else {
      data.exams.push({
        ...task, eventType: task.eventType || task.taskType,
        date: task.date || task.deadline || task.scheduledDate,
        notes: task.notes || task.description || ''
      });
    }
  }
  for (const event of actions) {
    if (!data.tasks.some(task => task.id === event.id)) {
      data.tasks.push({
        ...event, taskType: event.eventType, deadline: event.date || event.deadline || null,
        scheduledDate: event.date?.slice(0, 10) || event.scheduledDate || null,
        status: event.status || 'not_started', priority: event.priority || 'medium'
      });
    }
  }
  const agendaIds = new Set(agendas.map(task => task.id));
  const actionIds = new Set(actions.map(event => event.id));
  data.tasks = data.tasks.filter(task => !agendaIds.has(task.id));
  data.exams = data.exams.filter(event => !actionIds.has(event.id));
  return true;
}

export function agendaIsDone(event, today = new Date()) {
  if (!['quiz', 'exam'].includes(event.eventType || 'exam') || !event.date) return false;
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(event.date) ? event.date + 'T00:00:00' : event.date);
  if (!Number.isFinite(date.getTime())) return false;
  const scheduledDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const currentDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return scheduledDay < currentDay;
}
