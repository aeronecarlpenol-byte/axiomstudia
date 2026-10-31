/**
 * FOCUS//ECE — Focus View & Immersive Study Cockpit
 * Precision timer, ambient audio synthesis, motivation reminders, purpose recall, and session logging.
 */

import { db } from '../db.js';
import { getQuoteForDate } from '../dailyQuotes.js';
import { timer } from '../timer.js';

export function renderFocus(container) {
  let isFullscreen = false;
  let showMotivation = true;
  let currentQuote = getQuoteForDate().quote;

  function updateDisplay() {
    const timerText = container.querySelector('#focus-timer-text');
    const startPauseBtn = container.querySelector('#btn-start-pause');
    const progressFill = container.querySelector('#focus-progress-fill');

    if (timerText) {
      timerText.textContent = timer.formatTime();
      if (timer.state === 'running') {
        timerText.classList.add('running');
      } else {
        timerText.classList.remove('running');
      }
    }
    if (progressFill) progressFill.style.width = `${timer.getProgress()}%`;

    if (startPauseBtn) {
      if (timer.state === 'running') {
        startPauseBtn.innerHTML = `
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
          PAUSE
        `;
        startPauseBtn.className = 'btn btn-secondary btn-timer-primary';
      } else {
        startPauseBtn.innerHTML = `
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          ${timer.state === 'paused' ? 'RESUME' : 'FOCUS'}
        `;
        startPauseBtn.className = 'btn btn-primary btn-timer-primary';
      }
    }
  }

  function render() {
    const subjects = db.getSubjects();
    const tasks = db.getTasks().filter(t => t.status !== 'completed');

    const currentSubject = timer.selectedSubjectId ? db.getSubjectById(timer.selectedSubjectId) : null;
    const currentTopic = timer.selectedTopicId ? db.getTopicById(timer.selectedTopicId) : null;
    const currentTask = timer.selectedTaskId ? db.getTaskById(timer.selectedTaskId) : null;

    container.innerHTML = `
      <div class="focus-container ${isFullscreen ? 'fullscreen' : ''}" id="focus-wrapper">
        <!-- Top Cockpit Bar -->
        <div style="width: 100%; display: flex; justify-content: flex-end; align-items: center; margin-bottom: var(--space-4);">
          <div style="display: flex; gap: var(--space-2);">
            <button class="btn btn-secondary btn-sm" id="btn-settle-meditation" title="2-minute breathing reset before studying">
              🧘 2 Min Settle In
            </button>
            <button class="btn btn-secondary btn-sm" id="btn-toggle-fullscreen">
              ${isFullscreen ? 'Exit Fullscreen' : '⛶ Fullscreen'}
            </button>
          </div>
        </div>

        <!-- Task & Subject Selection -->
        <div class="focus-task-info">
          <div class="focus-subject-badge" id="focus-sub-badge">
            ${currentSubject ? `${currentSubject.code} · ${currentSubject.name}` : 'GENERAL STUDY'}
          </div>
          <div class="focus-task-name" id="focus-task-title">
            ${currentTask ? currentTask.title : (currentTopic ? currentTopic.name : 'Deep Work Session')}
          </div>
          <div class="focus-topic-name">
            ${currentTopic ? `Topic: ${currentTopic.name}` : 'Select a task or topic below to attach session logs'}
          </div>

          <!-- Quick Context Switcher Trigger -->
          <div style="margin-top: var(--space-2);">
            <select id="focus-task-picker" style="font-size: 0.82rem; padding: 4px 10px; max-width: 320px;">
              <option value="">Attach to a specific task...</option>
              ${tasks.map(t => `<option value="${t.id}" ${currentTask?.id === t.id ? 'selected' : ''}>${t.title}</option>`).join('')}
            </select>
          </div>
        </div>

        <!-- Duration Presets -->
        <div class="presets-bar">
          ${[15, 25, 30, 45, 50, 60, 90].map(mins => `
            <button class="preset-chip ${timer.durationMinutes === mins ? 'active' : ''}" data-mins="${mins}">
              ${mins}m
            </button>
          `).join('')}
        </div>

        <!-- Giant Timer Display -->
        <div class="timer-display" id="focus-timer-text">${timer.formatTime()}</div>

        <!-- Progress Line -->
        <div class="progress-bar" style="max-width: 400px; height: 6px; margin: 0 auto;">
          <div class="progress-fill" id="focus-progress-fill" style="width: ${timer.getProgress()}%;"></div>
        </div>

        <!-- Controls -->
        <div class="timer-controls">
          <button class="btn btn-primary btn-timer-primary" id="btn-start-pause">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            FOCUS
          </button>
          <button class="btn btn-secondary" id="btn-finish-session">
            FINISH SESSION
          </button>
        </div>

        <!-- Ambient Sound Controls -->
        <div class="focus-sound-bar">
          <span style="font-size: 0.75rem; color: var(--text-muted); margin-right: 4px;">AMBIENCE:</span>
          <button class="sound-btn ${timer.ambientSound === 'none' ? 'active' : ''}" data-sound="none">Silence</button>
          <button class="sound-btn ${timer.ambientSound === 'brown' ? 'active' : ''}" data-sound="brown">Brown Noise</button>
          <button class="sound-btn ${timer.ambientSound === 'rain' ? 'active' : ''}" data-sound="rain">Rain</button>
          <button class="sound-btn ${timer.ambientSound === 'library' ? 'active' : ''}" data-sound="library">Library</button>
        </div>

        <!-- Attached Task Subtasks Checklist -->
        ${currentTask && currentTask.subtasks && currentTask.subtasks.length > 0 ? `
          <div class="card" style="max-width: 480px; width: 100%; margin: var(--space-4) auto 0; text-align: left; background: var(--bg-surface); border: 1px solid var(--border-card);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-2);">
              <span style="font-size: 0.78rem; font-family: var(--font-mono); color: var(--accent-primary); text-transform: uppercase;">
                Task Breakdown (${currentTask.subtasks.filter(s => s.completed).length}/${currentTask.subtasks.length})
              </span>
              <span style="font-size: 0.72rem; color: var(--text-muted);">Tick off as you make progress</span>
            </div>
            <div style="display: flex; flex-direction: column; gap: var(--space-2);">
              ${currentTask.subtasks.map(st => `
                <label style="display: flex; align-items: center; gap: var(--space-2); font-size: 0.83rem; cursor: pointer;">
                  <input type="checkbox" ${st.completed ? 'checked' : ''} data-action="focus-toggle-subtask" data-st-id="${st.id}">
                  <span style="${st.completed ? 'text-decoration: line-through; opacity: 0.6;' : ''}">${st.text}</span>
                </label>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <!-- Subtle Motivation Quote Banner -->
        <div class="motivation-banner" style="display: ${showMotivation ? 'block' : 'none'};">
          <div class="motivation-quote">"${currentQuote}"</div>
          <button class="btn btn-ghost btn-sm motivation-toggle-btn" id="btn-hide-motivation" title="Hide motivation banner">✕</button>
        </div>
      </div>
    `;

    updateDisplay();

    // Event Listeners
    container.querySelectorAll('.preset-chip').forEach(chip => {
      chip.addEventListener('click', (e) => {
        const mins = parseInt(e.currentTarget.getAttribute('data-mins'), 10);
        timer.setDuration(mins);
        render();
      });
    });

    container.querySelector('#focus-task-picker').addEventListener('change', (e) => {
      const taskId = e.target.value;
      if (taskId) {
        const t = db.getTaskById(taskId);
        if (t) {
          timer.setContext(t.subjectId, t.topicId, t.id);
          render();
        }
      } else {
        timer.setContext(null, null, null);
        render();
      }
    });

    // Subtask toggle inside Focus cockpit
    container.querySelectorAll('[data-action="focus-toggle-subtask"]').forEach(box => {
      box.addEventListener('change', (e) => {
        const stId = e.target.getAttribute('data-st-id');
        if (currentTask && currentTask.subtasks) {
          const st = currentTask.subtasks.find(s => s.id === stId);
          if (st) {
            st.completed = e.target.checked;
            db.updateTask(currentTask.id, { subtasks: currentTask.subtasks });
            render();
          }
        }
      });
    });

    // Start / Pause with Resistance Check
    container.querySelector('#btn-start-pause').addEventListener('click', () => {
      if (timer.state === 'running') {
        // Show Resistance Check Dialog
        showResistanceModal(() => {
          timer.pause();
          updateDisplay();
        });
      } else {
        timer.start();
        updateDisplay();
      }
    });

    // Finish Session Button
    container.querySelector('#btn-finish-session').addEventListener('click', () => {
      if (timer.state === 'running' || timer.state === 'paused') {
        const elapsedMins = timer.stopEarly();
        window.focusApp.showSessionCompletionModal({
          durationMinutes: elapsedMins,
          subjectId: timer.selectedSubjectId,
          topicId: timer.selectedTopicId,
          taskId: timer.selectedTaskId,
          startTime: timer.startTime || new Date().toISOString(),
          endTime: new Date().toISOString()
        });
      } else {
        timer.reset();
        updateDisplay();
      }
    });

    // Ambient Sound switcher
    container.querySelectorAll('.sound-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const sound = e.currentTarget.getAttribute('data-sound');
        timer.setAmbientSound(sound);
        container.querySelectorAll('.sound-btn').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
      });
    });

    // Fullscreen Toggle
    container.querySelector('#btn-toggle-fullscreen').addEventListener('click', () => {
      isFullscreen = !isFullscreen;
      const wrapper = container.querySelector('#focus-wrapper');
      wrapper.classList.toggle('fullscreen', isFullscreen);
      container.querySelector('#btn-toggle-fullscreen').textContent = isFullscreen ? 'Exit Fullscreen' : '⛶ Fullscreen';
    });

    // Settle In Meditation (2 mins pre-study)
    container.querySelector('#btn-settle-meditation').addEventListener('click', () => {
      showPreStudyMeditationModal(() => {
        timer.start();
        updateDisplay();
      });
    });

    // Motivation hide
    const hideBtn = container.querySelector('#btn-hide-motivation');
    if (hideBtn) {
      hideBtn.addEventListener('click', () => {
        showMotivation = false;
        container.querySelector('.motivation-banner').style.display = 'none';
      });
    }
  }

  // Subscribe to timer ticks while view is active
  const unsubscribe = timer.subscribe(() => {
    updateDisplay();
  });

  render();

  // Return router unmount cleanup
  return () => {
    unsubscribe();
  };
}

/**
 * Resistance Check Dialog: "TAKING A BREAK? You can stop. Or give yourself five more minutes."
 * Never shames the user.
 */
function showResistanceModal(onConfirmPause) {
  const modalHtml = `
    <dialog class="modal" id="resistance-dialog">
      <div class="modal-header">
        <h3 style="font-size: 1rem; color: var(--accent-amber);">TAKING A BREAK?</h3>
        <button class="btn btn-ghost btn-sm" id="close-res-btn">✕</button>
      </div>
      <div class="modal-body" style="text-align: center; padding: var(--space-6) var(--space-4);">
        <p style="font-size: 1.1rem; color: var(--text-primary); margin-bottom: var(--space-2);">You can stop.</p>
        <p style="font-size: 0.95rem; color: var(--text-secondary); margin-bottom: var(--space-6);">Or give yourself five more minutes of focus?</p>

        <div style="display: flex; justify-content: center; gap: var(--space-4);">
          <button class="btn btn-primary" id="res-continue-btn">
            Give 5 More Minutes
          </button>
          <button class="btn btn-secondary" id="res-pause-btn">
            Take Break
          </button>
        </div>
      </div>
    </dialog>
  `;

  const existing = document.getElementById('resistance-dialog');
  if (existing) existing.remove();

  document.body.insertAdjacentHTML('beforeend', modalHtml);
  const dialog = document.getElementById('resistance-dialog');
  dialog.showModal();

  const close = () => {
    dialog.close();
    dialog.remove();
  };

  dialog.querySelector('#close-res-btn').addEventListener('click', close);

  dialog.querySelector('#res-continue-btn').addEventListener('click', () => {
    close();
    timer.addFiveMinutes();
  });

  dialog.querySelector('#res-pause-btn').addEventListener('click', () => {
    close();
    onConfirmPause();
  });
}

/**
 * Pre-study 2-Minute Meditation Prompt
 */
function showPreStudyMeditationModal(onReadyToStudy) {
  let secondsLeft = 120;
  let interval = null;

  const modalHtml = `
    <dialog class="modal" id="pre-med-dialog">
      <div class="modal-header">
        <h3>2-Minute Settle In</h3>
        <button class="btn btn-ghost btn-sm" id="close-pre-med-btn">✕</button>
      </div>
      <div class="modal-body" style="text-align: center; padding: var(--space-8) var(--space-4);">
        <p style="font-size: 0.95rem; color: var(--text-secondary); margin-bottom: var(--space-4);">
          Clear distractions. Close unnecessary browser tabs. Take steady, calm breaths.
        </p>

        <div style="font-family: var(--font-mono); font-size: 3rem; font-weight: 700; color: var(--accent-primary); margin: var(--space-4) 0;" id="pre-med-timer">
          02:00
        </div>

        <p style="font-size: 0.85rem; color: var(--text-muted); font-style: italic;">
          "The mind is not a vessel to be filled, but a fire to be kindled."
        </p>
      </div>
      <div class="modal-footer" style="justify-content: space-between;">
        <button class="btn btn-ghost" id="pre-med-skip-btn">Skip to Study</button>
        <button class="btn btn-primary" id="pre-med-ready-btn">I'm Ready</button>
      </div>
    </dialog>
  `;

  const existing = document.getElementById('pre-med-dialog');
  if (existing) existing.remove();

  document.body.insertAdjacentHTML('beforeend', modalHtml);
  const dialog = document.getElementById('pre-med-dialog');
  dialog.showModal();

  const timerDisplay = dialog.querySelector('#pre-med-timer');

  interval = setInterval(() => {
    secondsLeft--;
    const m = Math.floor(secondsLeft / 60);
    const s = secondsLeft % 60;
    if (timerDisplay) {
      timerDisplay.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    if (secondsLeft <= 0) {
      clearInterval(interval);
      close();
      onReadyToStudy();
    }
  }, 1000);

  const close = () => {
    clearInterval(interval);
    dialog.close();
    dialog.remove();
  };

  dialog.querySelector('#close-pre-med-btn').addEventListener('click', close);
  dialog.querySelector('#pre-med-skip-btn').addEventListener('click', () => {
    close();
    onReadyToStudy();
  });
  dialog.querySelector('#pre-med-ready-btn').addEventListener('click', () => {
    close();
    onReadyToStudy();
  });
}
