/**
 * FOCUS//ECE — Application Master Controller
 * Initializes themes, routing, global shortcuts, "I'm Lost" engine, and session logging.
 */

import { db } from './db.js';
import { cloudSync } from './cloudSync.js';
import { renderAdmin } from './views/adminView.js';
import { timer } from './timer.js';
import { Router } from './router.js';
import { JustStartEngine } from './just-start.js';

import { renderDashboard } from './views/dashboardView.js';
import { renderSubjects } from './views/subjectsView.js';
import { renderGrades } from './views/gradesView.js';

import { renderCalendar } from './views/calendarView.js';
import { renderAnalytics } from './views/analyticsView.js';
import { renderExams } from './views/examsView.js';
import { renderSettings } from './views/settingsView.js';
import { renderFocus } from './views/focusView.js';
import { renderTasks } from './views/tasksView.js';
import { renderResources } from './views/resourcesView.js';
import { renderMind } from './views/mindView.js';

class FocusApp {
  constructor() {
    this.initTheme();
    this.setupRouter();
    this.setupGlobalEvents();
    this.setupLostEngine();
    this.setupJustStart();
    let hydration = 0;
    cloudSync.subscribe(sync => {
      if (sync.hydration !== hydration) {
        hydration = sync.hydration;
        if (!document.querySelector('input:focus, textarea:focus, select:focus, dialog[open]') && this.router.currentRoute !== 'admin') this.router.handleRoute();
      }
    });
    cloudSync.retry();
  }

  initTheme() {
    const profile = db.getUserProfile();
    const theme = profile?.theme || 'dark';
    document.documentElement.setAttribute('data-theme', theme);
  }

  setupRouter() {
    const content = document.getElementById('main-content');
    const routes = {
      dashboard: renderDashboard,
      subjects: renderSubjects,
      grades: renderGrades,
      calendar: renderCalendar,
      analytics: renderAnalytics,
      exams: renderExams,
      settings: renderSettings,
      admin: renderAdmin,
      focus: renderFocus,
      tasks: renderTasks,
      resources: renderResources,
      mind: renderMind
    };

    this.router = new Router(routes, content);
    this.router.init();
  }

  setupGlobalEvents() {
    this.setupDialogFallback();
    // Keyboard shortcuts
    window.addEventListener('keydown', (e) => {
      // Escape: close open dialogs
      if (e.key === 'Escape') {
        const openDialog = document.querySelector('dialog[open]');
        if (openDialog) openDialog.close();
      }

      // Spacebar: toggle timer if on focus page and not inside input/textarea
      if (e.code === 'Space' && window.location.hash === '#focus') {
        const activeTag = document.activeElement?.tagName?.toLowerCase();
        if (activeTag !== 'input' && activeTag !== 'textarea' && activeTag !== 'select') {
          e.preventDefault();
          if (timer.state === 'running') timer.pause();
          else timer.start();
        }
      }
    });

    const openMobileMore = () => {
      const dialog = document.getElementById('mobile-more-dialog');
      if (dialog) dialog.showModal();
    };
    document.getElementById('mobile-more-trigger')?.addEventListener('click', openMobileMore);
    document.getElementById('mobile-nav-more-trigger')?.addEventListener('click', openMobileMore);
    document.getElementById('close-mobile-more')?.addEventListener('click', () => {
      document.getElementById('mobile-more-dialog')?.close();
    });
    document.querySelectorAll('[data-mobile-route]').forEach(link => {
      link.addEventListener('click', () => document.getElementById('mobile-more-dialog')?.close());
    });
  }

  setupDialogFallback() {
    const probe = document.createElement('dialog');
    if (typeof probe.showModal === 'function') return;

    const fallbackShowModal = function () {
      if (this.tagName !== 'DIALOG') return;
      this.setAttribute('open', '');
      this.setAttribute('role', 'dialog');
      this.setAttribute('aria-modal', 'true');
      this.classList.add('modal-fallback');
      this.querySelector('button, input, select, textarea, [href]')?.focus();
    };
    const fallbackClose = function () {
      if (this.tagName !== 'DIALOG') return;
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    };

    HTMLElement.prototype.showModal = fallbackShowModal;
    HTMLElement.prototype.close = fallbackClose;
  }

  setupJustStart() {
    const justStartBtn = document.getElementById('topbar-just-start');
    if (justStartBtn) {
      justStartBtn.addEventListener('click', () => {
        const nextTask = JustStartEngine.getRecommendedTask();
        if (nextTask) {
          JustStartEngine.launchTask(nextTask);
        } else {
          window.location.hash = '#focus';
        }
      });
    }
  }

  setupLostEngine() {
    const lostBtn = document.getElementById('topbar-btn-lost');
    if (lostBtn) {
      lostBtn.addEventListener('click', () => this.showLostDialog());
    }
  }

  showLostDialog() {
    const modalHtml = `
      <dialog class="modal" id="lost-dialog" style="max-width: 500px;">
        <div class="modal-header">
          <div>
            <h3 style="color: var(--accent-amber);">I'M LOST</h3>
            <p style="font-size: 0.8rem; color: var(--text-muted);">Select what best matches your current state</p>
          </div>
          <button class="btn btn-ghost btn-sm" id="close-lost-modal">✕</button>
        </div>
        <div class="modal-body" style="display: flex; flex-direction: column; gap: var(--space-2);">
          <button class="btn btn-secondary" style="justify-content: flex-start; text-align: left; padding: var(--space-3);" data-situation="no_idea">
            🧭 I don't know what to study
          </button>
          <button class="btn btn-secondary" style="justify-content: flex-start; text-align: left; padding: var(--space-3);" data-situation="not_understanding">
            🧩 I don't understand the topic
          </button>
          <button class="btn btn-secondary" style="justify-content: flex-start; text-align: left; padding: var(--space-3);" data-situation="too_many_tasks">
            ⚡ I have too many tasks / feeling overwhelmed
          </button>
          <button class="btn btn-secondary" style="justify-content: flex-start; text-align: left; padding: var(--space-3);" data-situation="procrastinating">
            ⏳ I'm procrastinating / resistance is high
          </button>
          <button class="btn btn-secondary" style="justify-content: flex-start; text-align: left; padding: var(--space-3);" data-situation="exam_coming">
            🚨 Exam is coming
          </button>
          <button class="btn btn-secondary" style="justify-content: flex-start; text-align: left; padding: var(--space-3);" data-situation="twenty_minutes">
            ⏱ I only have 20 minutes
          </button>
        </div>
      </dialog>
    `;

    const existing = document.getElementById('lost-dialog');
    if (existing) existing.remove();

    document.body.insertAdjacentHTML('beforeend', modalHtml);
    const dialog = document.getElementById('lost-dialog');
    dialog.showModal();

    dialog.querySelector('#close-lost-modal').addEventListener('click', () => dialog.close());

    dialog.querySelectorAll('[data-situation]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const situation = e.currentTarget.getAttribute('data-situation');
        const recommendation = JustStartEngine.getTriageRecommendation(situation);
        dialog.close();
        this.showTriageOutcomeModal(recommendation);
      });
    });
  }

  showTriageOutcomeModal(rec) {
    const task = rec.task;
    const sub = task ? db.getSubjectById(task.subjectId) : null;

    const modalHtml = `
      <dialog class="modal" id="triage-dialog">
        <div class="modal-header">
          <h3 style="color: var(--accent-primary);">YOUR CLARITY PATH</h3>
          <button class="btn btn-ghost btn-sm" id="close-triage-modal">✕</button>
        </div>
        <div class="modal-body" style="padding: var(--space-6);">
          <div style="font-size: 0.95rem; line-height: 1.6; color: var(--text-secondary); background: var(--bg-surface); padding: var(--space-4); border-radius: var(--radius-md); margin-bottom: var(--space-4); border: 1px solid var(--border-card);">
            ${rec.advice}
          </div>

          ${task ? `
            <div style="font-size: 0.8rem; text-transform: uppercase; color: var(--text-muted); margin-bottom: var(--space-2);">Recommended Action</div>
            <div style="padding: var(--space-4); background: var(--bg-card); border: 1px solid var(--border-strong); border-radius: var(--radius-md);">
              <div style="font-weight: 600; font-size: 1.05rem; color: var(--text-primary);">${task.title}</div>
              <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 4px;">
                ${sub ? `${sub.code} · ` : ''}⏱ Estimated: ${task.estimatedMinutes || 45} mins
              </div>
            </div>
          ` : ''}
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="triage-cancel-btn">Dismiss</button>
          ${task ? `
            <button class="btn btn-primary" id="triage-launch-btn">Start Focus on this Task</button>
          ` : ''}
        </div>
      </dialog>
    `;

    const existing = document.getElementById('triage-dialog');
    if (existing) existing.remove();

    document.body.insertAdjacentHTML('beforeend', modalHtml);
    const dialog = document.getElementById('triage-dialog');
    dialog.showModal();

    dialog.querySelector('#close-triage-modal').addEventListener('click', () => dialog.close());
    dialog.querySelector('#triage-cancel-btn').addEventListener('click', () => dialog.close());

    const launchBtn = dialog.querySelector('#triage-launch-btn');
    if (launchBtn && task) {
      launchBtn.addEventListener('click', () => {
        dialog.close();
        JustStartEngine.launchTask(task);
      });
    }
  }

  showSessionCompletionModal(sessionData) {
    const sub = sessionData.subjectId ? db.getSubjectById(sessionData.subjectId) : null;
    const top = sessionData.topicId ? db.getTopicById(sessionData.topicId) : null;

    const modalHtml = `
      <dialog class="modal" id="session-log-dialog">
        <div class="modal-header">
          <div style="display: flex; align-items: center; gap: var(--space-2);">
            <span style="color: var(--accent-emerald); font-size: 1.25rem;">✓</span>
            <h3>SESSION COMPLETE</h3>
          </div>
        </div>
        <div class="modal-body">
          <form id="session-complete-form">
            <div style="padding: var(--space-3); background: var(--bg-surface); border-radius: var(--radius-md); margin-bottom: var(--space-4); display: flex; justify-content: space-between;">
              <span>Focus Duration: <b style="font-family: var(--font-mono); color: var(--accent-primary);">${sessionData.durationMinutes} minutes</b></span>
              <span>${sub ? sub.code : 'General'} ${top ? `· ${top.name}` : ''}</span>
            </div>

            <div class="form-group">
              <label class="form-label">Did you accomplish your session goal?</label>
              <div style="display: flex; gap: var(--space-4); font-size: 0.85rem; margin-top: 4px;">
                <label style="display: flex; align-items: center; gap: 4px; cursor: pointer;">
                  <input type="radio" name="completedGoal" value="finished" checked /> Finished
                </label>
                <label style="display: flex; align-items: center; gap: 4px; cursor: pointer;">
                  <input type="radio" name="completedGoal" value="partial" /> Partially Finished
                </label>
                <label style="display: flex; align-items: center; gap: 4px; cursor: pointer;">
                  <input type="radio" name="completedGoal" value="not_finished" /> Not Finished
                </label>
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Subject Difficulty (1 = Easy, 5 = Severe)</label>
                <select name="difficulty">
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="3" selected>3</option>
                  <option value="4">4</option>
                  <option value="5">5</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Post-Session Confidence (1 = Low, 5 = Confident)</label>
                <select name="confidence">
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                  <option value="4" selected>4</option>
                  <option value="5">5</option>
                </select>
              </div>
            </div>
          </form>
        </div>
        <div class="modal-footer">
          <button class="btn btn-primary" id="save-session-log-btn">Save Study Log & Update Mastery</button>
        </div>
      </dialog>
    `;

    const existing = document.getElementById('session-log-dialog');
    if (existing) existing.remove();

    document.body.insertAdjacentHTML('beforeend', modalHtml);
    const dialog = document.getElementById('session-log-dialog');
    dialog.showModal();

    dialog.querySelector('#save-session-log-btn').addEventListener('click', () => {
      const form = dialog.querySelector('#session-complete-form');
      const fd = new FormData(form);

      db.addFocusSession({
        ...sessionData,
        completedGoal: fd.get('completedGoal'),
        difficulty: parseInt(fd.get('difficulty'), 10),
        confidence: parseInt(fd.get('confidence'), 10),
        whatLearned: fd.get('whatLearned') || '',
        whatToReview: fd.get('whatToReview') || ''
      });

      dialog.close();
      dialog.remove();
      timer.reset();

      // Navigate to Analytics to view the updated study telemetry
      window.location.hash = '#analytics';
    });
  }

  launchTaskById(taskId) {
    const task = db.getTaskById(taskId);
    if (task) {
      JustStartEngine.launchTask(task);
    }
  }
}

export function showToast(message, duration = 3000) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.innerHTML = `<span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 200ms ease';
    setTimeout(() => toast.remove(), 250);
  }, duration);
}
window.showToast = showToast;

// Expose key singletons globally for cross-view access
window._axiomJustStart = { JustStartEngine };
window._axiomTimer = { timer };
window._axiomSetTimerContext = (subjectId, topicId, taskId) => {
  timer.setContext(subjectId, topicId, taskId);
};

// Global bootstrap
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.focusApp = new FocusApp();
  });
} else {
  window.focusApp = new FocusApp();
}
