/**
 * Axiom Studia — Tasks View
 * Complete task management with status chips, subtask progress, task types,
 * clear actions, and integrated focus launcher.
 */

import { db } from '../db.js';
import { JustStartEngine } from '../just-start.js';

const TASK_TYPE_LABELS = {
  assignment: 'Assignment',
  problem_set: 'Problem Set',
  project: 'Project',
  lab: 'Lab',
  reading: 'Reading',
  review: 'Review',
  quiz: 'Quiz',
  exam_prep: 'Exam Prep'
};

function getStatusChipHtml(task) {
  const s = db.getTaskDeadlineStatus(task);
  const map = {
    overdue: ['chip-overdue', '🔴 OVERDUE'],
    due_today: ['chip-due-today', '🟠 DUE TODAY'],
    due_tomorrow: ['chip-due-tomorrow', '🟡 TOMORROW'],
    upcoming: ['chip-upcoming', '⚪ UPCOMING'],
    completed: ['chip-completed', '✓ DONE'],
    no_deadline: ['chip-upcoming', '— NO DUE DATE']
  };
  const [cls, label] = map[s] || map.upcoming;
  return `<span class="task-status-chip ${cls}">${label}</span>`;
}

export function renderTasks(container) {
  let filterSubject = 'all';
  let filterStatus = 'all';
  let filterPriority = 'all';
  let filterType = 'all';
  let hideCompleted = false;

  function render() {
    const subjects = db.getSubjects();
    let tasks = db.getTasks();

    // Apply filters
    if (filterSubject !== 'all') tasks = tasks.filter(t => t.subjectId === filterSubject);
    if (filterStatus === 'active') {
      tasks = tasks.filter(t => t.status !== 'completed');
    } else if (filterStatus === 'overdue') {
      tasks = tasks.filter(t => db.getTaskDeadlineStatus(t) === 'overdue' && t.status !== 'completed');
    } else if (filterStatus !== 'all') {
      tasks = tasks.filter(t => t.status === filterStatus);
    }
    if (hideCompleted) {
      tasks = tasks.filter(t => t.status !== 'completed');
    }

    // Sort: overdue first, then by priority, then by deadline
    const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
    tasks = [...tasks].sort((a, b) => {
      const sa = db.getTaskDeadlineStatus(a);
      const sb = db.getTaskDeadlineStatus(b);
      if (sa === 'overdue' && sb !== 'overdue') return -1;
      if (sb === 'overdue' && sa !== 'overdue') return 1;
      if (a.status === 'completed' && b.status !== 'completed') return 1;
      if (b.status === 'completed' && a.status !== 'completed') return -1;
      const pDiff = (priorityOrder[a.priority] || 2) - (priorityOrder[b.priority] || 2);
      if (pDiff !== 0) return pDiff;
      if (a.deadline && b.deadline) return new Date(a.deadline) - new Date(b.deadline);
      if (a.deadline) return -1;
      if (b.deadline) return 1;
      return 0;
    });

    const totalTasks = db.getTasks();
    const completedCount = totalTasks.filter(t => t.status === 'completed').length;
    const overdueCount = db.getOverdueTasks().length;

    container.innerHTML = `
      <!-- Toolbar -->
      <div class="tasks-toolbar">
        <div>
          <h2>Academic Tasks</h2>
          <p style="font-size: 0.82rem; color:var(--text-muted);">
            ${totalTasks.length - completedCount} active · ${completedCount} completed · ${overdueCount > 0 ? `<span style="color:var(--accent-rose);">${overdueCount} overdue</span>` : '0 overdue'}
          </p>
        </div>
        <div style="display:flex; gap:var(--space-2); flex-wrap:wrap;">
          ${completedCount > 0 ? `<button class="btn btn-secondary btn-sm" id="btn-clear-completed" style="color:var(--accent-amber);">🗑 Clear Completed (${completedCount})</button>` : ''}
          ${totalTasks.length > 0 ? `<button class="btn btn-ghost btn-sm" id="btn-clear-all" style="color:var(--accent-rose);">Clear All</button>` : ''}
          <button class="btn btn-primary" id="btn-create-task">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            New Task
          </button>
        </div>
      </div>

      <!-- Filters -->
      <div class="card" style="margin-bottom: var(--space-5); padding: var(--space-3) var(--space-4);">
        <div class="filter-group" style="flex-wrap:wrap; gap:var(--space-2); align-items:center;">
          <label class="sr-only" for="filter-subject">Filter tasks by subject</label>
          <select id="filter-subject" aria-label="Filter tasks by subject" style="font-size:0.82rem; padding:4px 8px;">
            <option value="all">All Subjects</option>
            ${subjects.map(s => `<option value="${s.id}" ${filterSubject === s.id ? 'selected' : ''}>${s.code} – ${s.name}</option>`).join('')}
          </select>
          <label class="sr-only" for="filter-status">Filter tasks by status</label>
          <select id="filter-status" aria-label="Filter tasks by status" style="font-size:0.82rem; padding:4px 8px;">
            <option value="all" ${filterStatus === 'all' ? 'selected' : ''}>All Statuses</option>
            <option value="active" ${filterStatus === 'active' ? 'selected' : ''}>⚡ Active Only (Hide Done)</option>
            <option value="overdue" ${filterStatus === 'overdue' ? 'selected' : ''}>🔴 Overdue</option>
            <option value="not_started" ${filterStatus === 'not_started' ? 'selected' : ''}>Not Started</option>
            <option value="in_progress" ${filterStatus === 'in_progress' ? 'selected' : ''}>In Progress</option>
            <option value="completed" ${filterStatus === 'completed' ? 'selected' : ''}>✓ Completed</option>
          </select>
          <label class="sr-only" for="filter-priority">Filter tasks by priority</label>
          <select id="filter-priority" aria-label="Filter tasks by priority" style="font-size:0.82rem; padding:4px 8px;">
            <option value="all">All Priorities</option>
            <option value="urgent" ${filterPriority === 'urgent' ? 'selected' : ''}>🔴 Urgent</option>
            <option value="high" ${filterPriority === 'high' ? 'selected' : ''}>🟠 High</option>
            <option value="medium" ${filterPriority === 'medium' ? 'selected' : ''}>🟡 Medium</option>
            <option value="low" ${filterPriority === 'low' ? 'selected' : ''}>⚪ Low</option>
          </select>
          <label class="sr-only" for="filter-type">Filter tasks by type</label>
          <select id="filter-type" aria-label="Filter tasks by type" style="font-size:0.82rem; padding:4px 8px;">
            <option value="all">All Types</option>
            ${Object.entries(TASK_TYPE_LABELS).map(([k, v]) => `<option value="${k}" ${filterType === k ? 'selected' : ''}>${v}</option>`).join('')}
          </select>
          <label style="display:inline-flex; align-items:center; gap:6px; font-size:0.82rem; color:var(--text-secondary); cursor:pointer; user-select:none; margin-left:auto;">
            <input type="checkbox" id="toggle-hide-completed" ${hideCompleted ? 'checked' : ''} />
            <span>Hide completed from list</span>
          </label>
        </div>
      </div>

      <!-- Task List -->
      <div class="task-list">
        ${tasks.length === 0 ? `
          <div class="card" style="text-align:center; padding:3rem;">
            <p style="color:var(--text-muted);">No tasks found matching current filters.</p>
            <button class="btn btn-primary" style="margin-top:1rem;" id="btn-create-task-empty">+ New Task</button>
          </div>
        ` : tasks.map(task => {
          const sub = db.getSubjectById(task.subjectId);
          const top = db.getTopicById(task.topicId);
          const isCompleted = task.status === 'completed';
          const subtaskDone = (task.subtasks || []).filter(s => s.completed).length;
          const subtaskTotal = (task.subtasks || []).length;
          const subtaskPct = subtaskTotal > 0 ? Math.round((subtaskDone / subtaskTotal) * 100) : 0;
          const typeLabel = TASK_TYPE_LABELS[task.taskType] || 'Assignment';

          return `
            <div class="task-card ${isCompleted ? 'completed' : ''}" data-task-id="${task.id}">
              <button type="button" class="task-checkbox ${isCompleted ? 'checked' : ''}" data-action="toggle-status" title="${isCompleted ? 'Mark not started' : 'Mark completed'}" aria-label="${isCompleted ? 'Mark task not started' : 'Mark task completed'}" aria-pressed="${isCompleted}">
                ${isCompleted ? '✓' : ''}
              </button>

              <div class="task-content">
                <div class="task-header">
                  ${getStatusChipHtml(task)}
                  <span class="badge ${task.priority === 'urgent' ? 'badge-rose' : task.priority === 'high' ? 'badge-amber' : 'badge-cyan'}">${task.priority.toUpperCase()}</span>
                  <span class="task-type-badge">${typeLabel}</span>
                  ${sub ? `<span class="badge" style="background:${sub.color}22; color:${sub.color};">${sub.code}</span>` : ''}
                </div>

                <div class="task-title" style="margin-top:5px;">${task.title}</div>

                ${task.description ? `<p style="font-size:0.83rem; color:var(--text-muted); margin-top:4px;">${task.description}</p>` : ''}

                ${task.notes ? `<div style="font-size:0.8rem; color:var(--text-secondary); background:var(--bg-surface); border-radius:var(--radius-sm); padding:6px 10px; margin-top:6px; border: 1px solid var(--border-subtle);">📌 ${task.notes}</div>` : ''}

                <!-- Subtask Progress -->
                ${subtaskTotal > 0 ? `
                  <div class="subtask-progress">
                    <div class="subtask-progress-bar"><div class="subtask-progress-fill" style="width:${subtaskPct}%;"></div></div>
                    <span>${subtaskDone}/${subtaskTotal} subtasks · ${subtaskPct}%</span>
                  </div>
                ` : ''}

                <!-- Subtasks (expandable) -->
                ${task.subtasks && task.subtasks.length > 0 ? `
                  <div class="subtasks-container">
                    ${task.subtasks.map(st => `
                      <label class="subtask-item">
                        <input type="checkbox" ${st.completed ? 'checked' : ''} data-action="toggle-subtask" data-st-id="${st.id}">
                        <span style="${st.completed ? 'text-decoration:line-through; opacity:0.6;' : ''}">${st.text}</span>
                      </label>
                    `).join('')}
                  </div>
                ` : ''}

                <!-- Submission Pipeline -->
                ${task.submissionChecklist && task.submissionChecklist.length > 0 ? `
                  <div class="submission-checklist">
                    <div class="submission-title">Submission Pipeline</div>
                    <div style="display:flex; flex-wrap:wrap; gap:var(--space-3);">
                      ${task.submissionChecklist.map(sc => `
                        <label style="display:flex; align-items:center; gap:4px; font-size:0.78rem; cursor:pointer;">
                          <input type="checkbox" ${sc.checked ? 'checked' : ''} data-action="toggle-submission" data-sc-id="${sc.id}">
                          <span style="${sc.checked ? 'color:var(--accent-emerald); font-weight:500;' : ''}">${sc.label}</span>
                        </label>
                      `).join('')}
                    </div>
                  </div>
                ` : ''}

                <!-- External Links -->
                ${task.externalLinks && task.externalLinks.length > 0 ? `
                  <div style="display:flex; flex-wrap:wrap; gap:var(--space-2); margin-top:var(--space-3);">
                    ${task.externalLinks.map(link => `
                      <a href="${link.url}" target="_blank" rel="noopener noreferrer" class="btn-open-link" style="padding:2px 8px; font-size:0.75rem;">
                        🔗 ${link.title} ↗
                      </a>
                    `).join('')}
                  </div>
                ` : ''}

                <div class="task-meta">
                  ${top ? `<span>Topic: <b>${top.name}</b></span>` : ''}
                  ${task.deadline ? `<span>Due: <b>${new Date(task.deadline).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</b></span>` : ''}
                  <span>⏱ ${task.estimatedMinutes || 45}m est.</span>
                  <span>Status: <b style="text-transform:capitalize;">${task.status.replace('_', ' ')}</b></span>
                </div>
              </div>

              <div style="display:flex; flex-direction:column; gap:var(--space-2); align-self:flex-start; flex-shrink:0;">
                <button class="btn btn-secondary btn-sm" data-action="focus-task">▶ Focus</button>
                <button class="btn btn-secondary btn-sm" data-action="edit-task">✏ Edit</button>
                ${isCompleted ? `
                  <button class="btn btn-ghost btn-sm" data-action="remove-done-task" style="color:var(--accent-rose); font-weight:600;" title="Remove this completed task from the list">🗑 Remove Done</button>
                ` : `
                  <button class="btn btn-ghost btn-sm" data-action="delete-task" style="color:var(--accent-rose);">Delete</button>
                `}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    // Filters
    container.querySelector('#filter-subject')?.addEventListener('change', e => { filterSubject = e.target.value; render(); });
    container.querySelector('#filter-status')?.addEventListener('change', e => { filterStatus = e.target.value; render(); });
    container.querySelector('#filter-priority')?.addEventListener('change', e => { filterPriority = e.target.value; render(); });
    container.querySelector('#filter-type')?.addEventListener('change', e => { filterType = e.target.value; render(); });
    container.querySelector('#toggle-hide-completed')?.addEventListener('change', e => { hideCompleted = e.target.checked; render(); });

    // Create Task
    container.querySelector('#btn-create-task')?.addEventListener('click', () => showCreateTaskModal(render));
    container.querySelector('#btn-create-task-empty')?.addEventListener('click', () => showCreateTaskModal(render));

    // Clear Completed
    container.querySelector('#btn-clear-completed')?.addEventListener('click', () => {
      if (confirm(`Clear all ${completedCount} completed tasks? This cannot be undone.`)) {
        db.clearCompletedTasks();
        window.showToast?.('Completed tasks cleared.');
        render();
      }
    });

    // Clear All Tasks
    container.querySelector('#btn-clear-all')?.addEventListener('click', () => {
      if (confirm(`Are you sure you want to delete ALL ${totalTasks.length} tasks? This cannot be undone.`)) {
        db.clearAllTasks();
        window.showToast?.('All tasks cleared.');
        render();
      }
    });

    // Task Card Actions
    container.querySelectorAll('.task-card').forEach(card => {
      const taskId = card.getAttribute('data-task-id');
      const task = db.getTaskById(taskId);
      if (!task) return;

      card.querySelector('[data-action="toggle-status"]')?.addEventListener('click', () => {
        const next = task.status === 'completed' ? 'not_started' : 'completed';
        db.updateTask(taskId, { status: next, completedAt: next === 'completed' ? new Date().toISOString() : null });
        if (next === 'completed') {
          window.showToast?.('Task marked done!' + (hideCompleted || filterStatus === 'active' ? ' Removed from active view.' : ''));
        }
        render();
      });

      card.querySelector('[data-action="focus-task"]')?.addEventListener('click', () => {
        JustStartEngine.launchTask(task);
      });

      card.querySelector('[data-action="edit-task"]')?.addEventListener('click', () => {
        showEditTaskModal(task, render);
      });

      card.querySelector('[data-action="remove-done-task"]')?.addEventListener('click', () => {
        db.deleteTask(taskId);
        window.showToast?.('Completed task removed from list.');
        render();
      });

      card.querySelector('[data-action="delete-task"]')?.addEventListener('click', () => {
        if (confirm(`Delete task "${task.title}"?`)) {
          db.deleteTask(taskId);
          window.showToast?.('Task removed from list.');
          render();
        }
      });

      card.querySelectorAll('[data-action="toggle-subtask"]').forEach(box => {
        box.addEventListener('change', e => {
          const stId = e.target.getAttribute('data-st-id');
          const st = task.subtasks.find(s => s.id === stId);
          if (st) {
            st.completed = e.target.checked;
            db.updateTask(taskId, { subtasks: task.subtasks });
            render();
          }
        });
      });

      card.querySelectorAll('[data-action="toggle-submission"]').forEach(box => {
        box.addEventListener('change', e => {
          const scId = e.target.getAttribute('data-sc-id');
          const sc = task.submissionChecklist.find(s => s.id === scId);
          if (sc) {
            sc.checked = e.target.checked;
            db.updateTask(taskId, { submissionChecklist: task.submissionChecklist });
            render();
          }
        });
      });
    });
  }

  render();
}

function taskFormFields(subjects, task = {}, prefix = 'task') {
  const escape = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const pad = n => String(n).padStart(2, '0');
  const date = task.deadline ? new Date(task.deadline) : null;
  const deadline = date && !isNaN(date.getTime())
    ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
    : '';

  return `
    <div class="form-group">
      <label class="form-label" for="${prefix}-title">Task Title *</label>
      <input id="${prefix}-title" type="text" name="title" required value="${escape(task.title)}" />
    </div>
    <div class="form-group">
      <label class="form-label" for="${prefix}-subject">Subject</label>
      <select name="subjectId" id="${prefix}-subject">
        <option value=""></option>
        ${subjects.map(s => `<option value="${escape(s.id)}" ${task.subjectId === s.id ? 'selected' : ''}>${escape(s.code)} – ${escape(s.name)}</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label class="form-label" for="${prefix}-deadline">Deadline</label>
      <input id="${prefix}-deadline" type="datetime-local" name="deadline" value="${deadline}" />
    </div>
    <div class="form-group">
      <label class="form-label" for="${prefix}-type">Task Type</label>
      <select id="${prefix}-type" name="taskType">
        ${Object.entries(TASK_TYPE_LABELS).map(([key, label]) => `<option value="${key}" ${(task.taskType || 'assignment') === key ? 'selected' : ''}>${label}</option>`).join('')}
      </select>
    </div>
  `;
}

function readTaskForm(form) {
  if (!form.reportValidity()) return null;
  const fd = new FormData(form);
  const title = fd.get('title').trim();
  if (!title) {
    form.elements.title.value = '';
    form.reportValidity();
    return null;
  }
  return {
    title,
    subjectId: fd.get('subjectId') || null,
    deadline: fd.get('deadline') || null,
    taskType: fd.get('taskType') || 'assignment'
  };
}

export function showCreateTaskModal(onComplete, prefillSubjectId = null) {
  document.getElementById('task-create-dialog')?.remove();
  document.body.insertAdjacentHTML('beforeend', `
    <dialog class="modal" id="task-create-dialog" style="max-width:480px; width:95vw;">
      <div class="modal-header">
        <h3>Create Academic Task</h3>
        <button class="btn btn-ghost btn-sm" id="close-dialog-btn" aria-label="Close">✕</button>
      </div>
      <div class="modal-body">
        <form id="create-task-form">
          ${taskFormFields(db.getSubjects(), { subjectId: prefillSubjectId }, 'create-task')}
        </form>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" id="cancel-task-btn">Cancel</button>
        <button type="submit" form="create-task-form" class="btn btn-primary" id="save-task-btn">Create Task</button>
      </div>
    </dialog>
  `);
  const dialog = document.getElementById('task-create-dialog');
  const close = () => { dialog.close(); dialog.remove(); };
  dialog.querySelector('#close-dialog-btn').addEventListener('click', close);
  dialog.querySelector('#cancel-task-btn').addEventListener('click', close);
  dialog.querySelector('#create-task-form').addEventListener('submit', event => {
    event.preventDefault();
    const values = readTaskForm(event.currentTarget);
    if (!values) return;
    db.addTask({
      ...values,
      description: '',
      topicId: null,
      priority: 'medium',
      estimatedMinutes: 45,
      notes: '',
      status: 'not_started',
      subtasks: [],
      submissionChecklist: [],
      externalLinks: [],
      attachedResources: []
    });
    window.showToast?.('Task created!');
    close();
    if (onComplete) onComplete();
  });
  dialog.showModal();
}

export function showEditTaskModal(task, onComplete) {
  if (!task) return;
  document.getElementById('task-edit-dialog')?.remove();
  document.body.insertAdjacentHTML('beforeend', `
    <dialog class="modal" id="task-edit-dialog" style="max-width:480px; width:95vw;">
      <div class="modal-header">
        <h3>Edit Task</h3>
        <button class="btn btn-ghost btn-sm" id="close-edit-dialog-btn" aria-label="Close">✕</button>
      </div>
      <div class="modal-body">
        <form id="edit-task-form">
          ${taskFormFields(db.getSubjects(), task, 'edit-task')}
        </form>
      </div>
      <div class="modal-footer" style="flex-wrap:wrap;">
        <button class="btn btn-ghost btn-sm" id="delete-edit-task-btn" style="color:var(--accent-rose); margin-right:auto;">Delete Task</button>
        <button class="btn btn-secondary" id="cancel-edit-task-btn">Cancel</button>
        <button type="submit" form="edit-task-form" class="btn btn-primary" id="save-edit-task-btn">Save Changes</button>
      </div>
    </dialog>
  `);
  const dialog = document.getElementById('task-edit-dialog');
  const close = () => { dialog.close(); dialog.remove(); };
  dialog.querySelector('#close-edit-dialog-btn').addEventListener('click', close);
  dialog.querySelector('#cancel-edit-task-btn').addEventListener('click', close);
  dialog.querySelector('#delete-edit-task-btn').addEventListener('click', () => {
    if (confirm(`Delete task "${task.title}"? This cannot be undone.`)) {
      db.deleteTask(task.id);
      window.showToast?.('Task deleted.');
      close();
      if (onComplete) onComplete();
    }
  });
  dialog.querySelector('#edit-task-form').addEventListener('submit', event => {
    event.preventDefault();
    const values = readTaskForm(event.currentTarget);
    if (!values) return;
    // Only update the visible fields so existing task details stay intact.
    if (values.subjectId !== (task.subjectId || null)) values.topicId = null;
    db.updateTask(task.id, values);
    window.showToast?.('Task updated successfully!');
    close();
    if (onComplete) onComplete();
  });
  dialog.showModal();
}
