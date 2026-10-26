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

export function showCreateTaskModal(onComplete, prefillSubjectId = null) {
  const subjects = db.getSubjects();
  const topics = db.getTopics();

  const existing = document.getElementById('task-create-dialog');
  if (existing) existing.remove();

  const modalHtml = `
    <dialog class="modal" id="task-create-dialog" style="max-width:640px; width:95vw;">
      <div class="modal-header">
        <h3>Create Academic Task</h3>
        <button class="btn btn-ghost btn-sm" id="close-dialog-btn">✕</button>
      </div>
      <div class="modal-body" style="max-height:70vh; overflow-y:auto;">
        <form id="create-task-form">
          <div class="form-group">
            <label class="form-label">Task Title *</label>
            <input type="text" name="title" required placeholder="e.g. DC Circuits Assignment 3" />
          </div>

          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Subject</label>
              <select name="subjectId" id="modal-subject-select">
                <option value="">No subject</option>
                ${subjects.map(s => `<option value="${s.id}" ${prefillSubjectId === s.id ? 'selected' : ''}>${s.code} – ${s.name}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Topic</label>
              <select name="topicId" id="modal-topic-select">
                <option value="">No specific topic</option>
                ${topics.filter(t => !prefillSubjectId || t.subjectId === prefillSubjectId).map(t => `<option value="${t.id}">${t.name}</option>`).join('')}
              </select>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Task Type</label>
              <select name="taskType">
                <option value="assignment">Assignment</option>
                <option value="problem_set">Problem Set</option>
                <option value="project">Project</option>
                <option value="lab">Lab</option>
                <option value="reading">Reading</option>
                <option value="review">Review</option>
                <option value="quiz">Quiz</option>
                <option value="exam_prep">Exam Prep</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Priority</label>
              <select name="priority">
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
                <option value="low">Low</option>
              </select>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Deadline</label>
              <input type="datetime-local" name="deadline" />
            </div>
            <div class="form-group">
              <label class="form-label">Estimated Minutes</label>
              <input type="number" name="estimatedMinutes" value="45" min="5" step="5" />
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">Description / Instructions</label>
            <textarea name="description" rows="2" placeholder="Details, problem numbers, or special guidelines..."></textarea>
          </div>

          <div class="form-group">
            <label class="form-label">Notes (private reminder)</label>
            <input type="text" name="notes" placeholder="e.g. Watch out for sign errors in the integrating factor..." />
          </div>

          <!-- Subtasks -->
          <div class="form-group">
            <label class="form-label">Subtasks</label>
            <div id="subtasks-list" style="display:flex; flex-direction:column; gap:var(--space-2); margin-bottom:var(--space-2);"></div>
            <button type="button" class="btn btn-secondary btn-sm" id="btn-add-subtask">+ Add Subtask</button>
            <div style="display:flex; gap:var(--space-2); margin-top:var(--space-2); flex-wrap:wrap;">
              <button type="button" class="btn btn-ghost btn-sm" data-preset="problem_set">📋 Problem Set preset</button>
              <button type="button" class="btn btn-ghost btn-sm" data-preset="essay">📝 Essay preset</button>
              <button type="button" class="btn btn-ghost btn-sm" data-preset="lab">🔬 Lab preset</button>
            </div>
          </div>

          <!-- Submission Pipeline -->
          <div class="form-group">
            <label class="form-label">Include Submission Pipeline?</label>
            <select name="hasSubmission">
              <option value="yes">Yes (Solve → Check → Scan → PDF → Upload → Submit)</option>
              <option value="no" selected>No</option>
            </select>
          </div>
        </form>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" id="cancel-task-btn">Cancel</button>
        <button class="btn btn-primary" id="save-task-btn">Create Task</button>
      </div>
    </dialog>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHtml);
  const dialog = document.getElementById('task-create-dialog');
  dialog.showModal();

  const close = () => { dialog.close(); dialog.remove(); };
  dialog.querySelector('#close-dialog-btn').addEventListener('click', close);
  dialog.querySelector('#cancel-task-btn').addEventListener('click', close);

  // Dynamic topic filter by subject
  dialog.querySelector('#modal-subject-select').addEventListener('change', e => {
    const selSubId = e.target.value;
    const topSel = dialog.querySelector('#modal-topic-select');
    topSel.innerHTML = `<option value="">No specific topic</option>` +
      topics.filter(t => !selSubId || t.subjectId === selSubId)
        .map(t => `<option value="${t.id}">${t.name}</option>`).join('');
  });

  // Subtasks
  let subtaskCount = 0;
  const subtasksList = dialog.querySelector('#subtasks-list');

  const addSubtask = (text = '') => {
    subtaskCount++;
    const id = `new-st-${subtaskCount}`;
    const div = document.createElement('div');
    div.style.cssText = 'display:flex; align-items:center; gap:var(--space-2);';
    div.innerHTML = `
      <span style="color:var(--text-muted); font-size:0.8rem;">${subtaskCount}.</span>
      <input type="text" class="subtask-input" placeholder="Subtask description" value="${text}" style="flex:1;" />
      <button type="button" class="btn btn-ghost btn-sm" style="color:var(--accent-rose); padding:2px 6px;" data-remove-subtask>✕</button>
    `;
    div.querySelector('[data-remove-subtask]').addEventListener('click', () => {
      div.remove();
    });
    subtasksList.appendChild(div);
    div.querySelector('input').focus();
  };

  dialog.querySelector('#btn-add-subtask').addEventListener('click', () => addSubtask());

  // Presets
  dialog.querySelectorAll('[data-preset]').forEach(btn => {
    btn.addEventListener('click', () => {
      subtasksList.innerHTML = '';
      subtaskCount = 0;
      const presets = {
        problem_set: ['Read module / lecture notes', 'Attempt all assigned problems', 'Verify answers against solutions', 'Scan or photograph work', 'Submit on Google Classroom'],
        essay: ['Research and outline', 'Write first draft', 'Revise and edit', 'Format and finalize', 'Submit online'],
        lab: ['Pre-lab reading', 'Set up equipment / simulation', 'Collect data and measurements', 'Analyze results and compute', 'Write lab report', 'Submit report']
      };
      (presets[btn.getAttribute('data-preset')] || []).forEach(t => addSubtask(t));
    });
  });

  // Save
  dialog.querySelector('#save-task-btn').addEventListener('click', () => {
    const form = dialog.querySelector('#create-task-form');
    const fd = new FormData(form);
    const title = fd.get('title');
    if (!title) return;

    const hasSubmission = fd.get('hasSubmission') === 'yes';
    const submissionChecklist = hasSubmission ? [
      { id: 'sc-1', label: 'Solve', checked: false },
      { id: 'sc-2', label: 'Check answers', checked: false },
      { id: 'sc-3', label: 'Scan / photo', checked: false },
      { id: 'sc-4', label: 'Convert to PDF', checked: false },
      { id: 'sc-5', label: 'Upload to drive', checked: false },
      { id: 'sc-6', label: 'Submit', checked: false }
    ] : [];

    const subtasks = [...subtasksList.querySelectorAll('.subtask-input')]
      .map((inp, i) => ({ id: `st-new-${Date.now()}-${i}`, text: inp.value.trim(), completed: false }))
      .filter(st => st.text);

    db.addTask({
      title: title.trim(),
      description: fd.get('description') || '',
      subjectId: fd.get('subjectId') || null,
      topicId: fd.get('topicId') || null,
      deadline: fd.get('deadline') || null,
      priority: fd.get('priority') || 'medium',
      taskType: fd.get('taskType') || 'assignment',
      estimatedMinutes: parseInt(fd.get('estimatedMinutes'), 10) || 45,
      notes: fd.get('notes') || '',
      status: 'not_started',
      subtasks,
      submissionChecklist,
      externalLinks: [],
      attachedResources: []
    });

    window.showToast?.('Task created!');
    close();
    if (onComplete) onComplete();
  });
}

export function showEditTaskModal(task, onComplete) {
  if (!task) return;
  const subjects = db.getSubjects();
  const topics = db.getTopics();

  const existing = document.getElementById('task-edit-dialog');
  if (existing) existing.remove();

  const pad = n => String(n).padStart(2, '0');
  const formatDateTimeLocal = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const currentType = task.taskType || 'assignment';
  const currentPriority = task.priority || 'medium';
  const currentStatus = task.status || 'not_started';

  const modalHtml = `
    <dialog class="modal" id="task-edit-dialog" style="max-width:640px; width:95vw;">
      <div class="modal-header">
        <div style="display:flex; align-items:center; gap:var(--space-2);">
          <span style="font-size:1.15rem; color:var(--accent-primary);">✏</span>
          <h3>Edit Task</h3>
        </div>
        <button class="btn btn-ghost btn-sm" id="close-edit-dialog-btn">✕</button>
      </div>
      <div class="modal-body" style="max-height:70vh; overflow-y:auto;">
        <form id="edit-task-form">
          <div class="form-group">
            <label class="form-label">Task Title *</label>
            <input type="text" name="title" required value="${(task.title || '').replace(/"/g, '&quot;')}" placeholder="e.g. DC Circuits Assignment 3" />
          </div>

          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Subject</label>
              <select name="subjectId" id="modal-edit-subject-select">
                <option value="">No subject</option>
                ${subjects.map(s => `<option value="${s.id}" ${task.subjectId === s.id ? 'selected' : ''}>${s.code} – ${s.name}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Topic</label>
              <select name="topicId" id="modal-edit-topic-select">
                <option value="">No specific topic</option>
                ${topics.filter(t => !task.subjectId || t.subjectId === task.subjectId).map(t => `<option value="${t.id}" ${task.topicId === t.id ? 'selected' : ''}>${t.name}</option>`).join('')}
              </select>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Task Type</label>
              <select name="taskType">
                ${Object.entries(TASK_TYPE_LABELS).map(([k, v]) => `
                  <option value="${k}" ${currentType === k ? 'selected' : ''}>${v}</option>
                `).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Priority</label>
              <select name="priority">
                <option value="urgent" ${currentPriority === 'urgent' ? 'selected' : ''}>🔴 Urgent</option>
                <option value="high" ${currentPriority === 'high' ? 'selected' : ''}>🟠 High</option>
                <option value="medium" ${currentPriority === 'medium' ? 'selected' : ''}>🟡 Medium</option>
                <option value="low" ${currentPriority === 'low' ? 'selected' : ''}>⚪ Low</option>
              </select>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Status</label>
              <select name="status">
                <option value="not_started" ${currentStatus === 'not_started' ? 'selected' : ''}>Not Started</option>
                <option value="in_progress" ${currentStatus === 'in_progress' ? 'selected' : ''}>In Progress</option>
                <option value="completed" ${currentStatus === 'completed' ? 'selected' : ''}>✓ Completed</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Estimated Minutes</label>
              <input type="number" name="estimatedMinutes" value="${task.estimatedMinutes || 45}" min="5" step="5" />
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">Deadline</label>
            <input type="datetime-local" name="deadline" value="${formatDateTimeLocal(task.deadline)}" />
          </div>

          <div class="form-group">
            <label class="form-label">Description / Instructions</label>
            <textarea name="description" rows="2" placeholder="Details, problem numbers, or special guidelines...">${task.description || ''}</textarea>
          </div>

          <div class="form-group">
            <label class="form-label">Notes (private reminder)</label>
            <input type="text" name="notes" value="${(task.notes || '').replace(/"/g, '&quot;')}" placeholder="e.g. Formulas, textbook references, hints..." />
          </div>

          <!-- Subtasks -->
          <div class="form-group">
            <label class="form-label">Subtasks</label>
            <div id="edit-subtasks-list" style="display:flex; flex-direction:column; gap:var(--space-2); margin-bottom:var(--space-2);"></div>
            <button type="button" class="btn btn-secondary btn-sm" id="btn-add-edit-subtask">+ Add Subtask</button>
          </div>
        </form>
      </div>
      <div class="modal-footer" style="display:flex; justify-content:space-between; align-items:center;">
        <button class="btn btn-ghost btn-sm" id="delete-edit-task-btn" style="color:var(--accent-rose);">🗑 Delete Task</button>
        <div style="display:flex; gap:var(--space-2);">
          <button class="btn btn-secondary" id="cancel-edit-task-btn">Cancel</button>
          <button class="btn btn-primary" id="save-edit-task-btn">Save Changes</button>
        </div>
      </div>
    </dialog>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHtml);
  const dialog = document.getElementById('task-edit-dialog');
  dialog.showModal();

  const close = () => { dialog.close(); dialog.remove(); };
  dialog.querySelector('#close-edit-dialog-btn').addEventListener('click', close);
  dialog.querySelector('#cancel-edit-task-btn').addEventListener('click', close);

  // Dynamic topic filter by subject
  dialog.querySelector('#modal-edit-subject-select').addEventListener('change', e => {
    const selSubId = e.target.value;
    const topSel = dialog.querySelector('#modal-edit-topic-select');
    topSel.innerHTML = `<option value="">No specific topic</option>` +
      topics.filter(t => !selSubId || t.subjectId === selSubId)
        .map(t => `<option value="${t.id}">${t.name}</option>`).join('');
  });

  // Subtasks list setup
  const editSubtasksList = dialog.querySelector('#edit-subtasks-list');

  const addEditSubtask = (text = '', completed = false) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; align-items:center; gap:var(--space-2);';
    row.innerHTML = `
      <input type="checkbox" class="subtask-edit-check" ${completed ? 'checked' : ''} title="Mark subtask completed" />
      <input type="text" class="subtask-edit-input" placeholder="Subtask description" value="${text.replace(/"/g, '&quot;')}" style="flex:1;" />
      <button type="button" class="btn btn-ghost btn-sm" style="color:var(--accent-rose); padding:2px 6px;" data-remove-subtask title="Remove subtask">✕</button>
    `;
    row.querySelector('[data-remove-subtask]').addEventListener('click', () => row.remove());
    editSubtasksList.appendChild(row);
  };

  (task.subtasks || []).forEach(st => addEditSubtask(st.text || '', st.completed || false));

  dialog.querySelector('#btn-add-edit-subtask').addEventListener('click', () => {
    addEditSubtask();
    const lastInput = editSubtasksList.querySelector('div:last-child .subtask-edit-input');
    if (lastInput) lastInput.focus();
  });

  // Delete Task from inside Edit Modal
  dialog.querySelector('#delete-edit-task-btn').addEventListener('click', () => {
    if (confirm(`Delete task "${task.title}"? This cannot be undone.`)) {
      db.deleteTask(task.id);
      window.showToast?.('Task deleted.');
      close();
      if (onComplete) onComplete();
    }
  });

  // Save Task Changes
  dialog.querySelector('#save-edit-task-btn').addEventListener('click', () => {
    const form = dialog.querySelector('#edit-task-form');
    const fd = new FormData(form);
    const title = fd.get('title');
    if (!title || !title.trim()) {
      window.showToast?.('Task title is required.');
      return;
    }

    const updatedSubtasks = [...editSubtasksList.querySelectorAll('div')].map((el, i) => {
      const inp = el.querySelector('.subtask-edit-input');
      const chk = el.querySelector('.subtask-edit-check');
      return {
        id: `st-${task.id}-${i}-${Date.now()}`,
        text: inp ? inp.value.trim() : '',
        completed: chk ? chk.checked : false
      };
    }).filter(st => st.text);

    const newStatus = fd.get('status') || 'not_started';
    const updates = {
      title: title.trim(),
      description: fd.get('description') || '',
      subjectId: fd.get('subjectId') || null,
      topicId: fd.get('topicId') || null,
      deadline: fd.get('deadline') || null,
      priority: fd.get('priority') || 'medium',
      taskType: fd.get('taskType') || 'assignment',
      status: newStatus,
      completedAt: newStatus === 'completed' ? (task.completedAt || new Date().toISOString()) : null,
      estimatedMinutes: parseInt(fd.get('estimatedMinutes'), 10) || 45,
      notes: fd.get('notes') || '',
      subtasks: updatedSubtasks
    };

    db.updateTask(task.id, updates);
    window.showToast?.('Task updated successfully!');
    close();
    if (onComplete) onComplete();
  });
}
