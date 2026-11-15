import { db } from './db.js';
import { timer } from './timer.js';

// The extension only talks to an Axiom tab the student explicitly pairs by
// clicking its toolbar button. Data stays in this tab's existing workspace.
const CHANNEL = 'axiom-studia-companion-v1';
const safeUrl = value => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch { return null; }
};

let selectedSubjectId = null;
let lastWorkspaceSubjectId = null;

function snapshot() {
  const subjects = db.getSubjectsForPeriod();
  const workspaceSubjectId = db.getStudyActivity()?.subjectId || null;
  if (workspaceSubjectId && workspaceSubjectId !== lastWorkspaceSubjectId &&
      subjects.some(subject => subject.id === workspaceSubjectId)) selectedSubjectId = workspaceSubjectId;
  lastWorkspaceSubjectId = workspaceSubjectId;
  if (!subjects.some(subject => subject.id === selectedSubjectId)) {
    selectedSubjectId = subjects.find(subject => subject.id === timer.selectedSubjectId)?.id ||
      subjects.find(subject => subject.id === db.getStudyActivity()?.subjectId)?.id || subjects[0]?.id || null;
  }
  const subject = subjects.find(item => item.id === selectedSubjectId);
  return {
    ready: !!subject,
    subjects: subjects.map(item => ({ id: item.id, name: item.name, code: item.code || '' })),
    selectedSubjectId,
    tasks: subject ? db.getTasks().filter(task => task.subjectId === subject.id).map(task => ({
      id: task.id, title: task.title, status: task.status
    })) : [],
    resources: subject ? db.getResources().filter(resource => resource.subjectId === subject.id).map(resource => ({
      id: resource.id, title: resource.title, type: resource.type,
      url: safeUrl(resource.url || resource.youtubeUrl || '')
    })) : [],
    timer: {
      state: timer.state,
      time: timer.formatTime(true),
      subjectId: timer.selectedSubjectId,
      taskId: timer.selectedTaskId,
      progress: timer.getProgress()
    }
  };
}

function reply(requestId, data, error = null) {
  window.postMessage({ channel: CHANNEL, kind: 'response', requestId, data, error }, location.origin);
}

window.addEventListener('message', event => {
  if (event.source !== window || event.origin !== location.origin) return;
  const message = event.data;
  if (message?.channel !== CHANNEL || message.kind !== 'request' || typeof message.requestId !== 'string') return;
  const { action, subjectId, taskId } = message;
  try {
    if (action === 'snapshot') return reply(message.requestId, snapshot());
    if (action === 'select-subject') {
      if (!db.getSubjectsForPeriod().some(subject => subject.id === subjectId)) throw new Error('Subject unavailable in this semester.');
      selectedSubjectId = subjectId;
      lastWorkspaceSubjectId = db.getStudyActivity()?.subjectId || null;
    } else if (action === 'timer-start' || action === 'timer-pause' || action === 'timer-reset') {
      const subject = db.getSubjectById(selectedSubjectId);
      if (!subject) throw new Error('Choose a subject first.');
      if (action === 'timer-start') {
        if (timer.state === 'running') return reply(message.requestId, snapshot());
        timer.setContext(subject.id, null, timer.selectedTaskId && db.getTasks().some(task => task.id === timer.selectedTaskId && task.subjectId === subject.id) ? timer.selectedTaskId : null);
        timer.start();
      } else if (action === 'timer-pause') timer.pause();
      else timer.reset();
    } else if (action === 'select-task') {
      const task = db.getTasks().find(item => item.id === taskId && item.subjectId === selectedSubjectId);
      if (!task) throw new Error('Task unavailable.');
      timer.setContext(selectedSubjectId, null, task.id);
    } else if (action === 'toggle-task') {
      const task = db.getTasks().find(item => item.id === taskId && item.subjectId === selectedSubjectId);
      if (!task) throw new Error('Task unavailable.');
      db.updateTask(task.id, { status: task.status === 'completed' ? 'not_started' : 'completed',
        completedAt: task.status === 'completed' ? null : new Date().toISOString() });
      if (db.getStudyActivity()?.subjectId === selectedSubjectId) {
        window.dispatchEvent(new Event('axiom-companion-task-updated'));
      }
    } else {
      throw new Error('Unsupported companion action.');
    }
    reply(message.requestId, snapshot());
  } catch (error) {
    reply(message.requestId, null, error.message || 'Could not update workspace.');
  }
});
