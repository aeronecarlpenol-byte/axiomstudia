import { db } from './db.js';
import { timer } from './timer.js';

class FloatingTimer {
  constructor() {
    this.window = null;
    this.subjectId = null;
    this.resourceId = null;
    this.unlisten = null;
    this.ending = false;
    this.previousCompletionHandler = null;
  }

  get active() { return !!this.window && !this.window.closed; }

  announce() { window.dispatchEvent(new Event('axiom-floating-timer-change')); }

  async open({ subjectId, resourceId = null }) {
    if (this.active) { this.window.focus(); return true; }
    if (!window.documentPictureInPicture?.requestWindow) {
      window.showToast?.('Floating timer needs a desktop browser that supports Document Picture-in-Picture.');
      return false;
    }
    const subject = db.getSubjectById(subjectId);
    if (!subject) return false;
    if ((timer.state === 'running' || timer.state === 'paused') && timer.selectedSubjectId !== subjectId) {
      window.showToast?.('The current session belongs to another subject. Finish it before floating this timer.');
      return false;
    }
    try {
      // Keep this call inside the user's click gesture.
      const pip = await window.documentPictureInPicture.requestWindow({ width: 320, height: 210 });
      this.window = pip;
      this.subjectId = subjectId;
      this.resourceId = resourceId;
      timer.lockedSubjectId = subjectId;
      this.ending = false;
      this.previousCompletionHandler = timer.onComplete;
      timer.onComplete = session => {
        this.endSession(session);
        return true;
      };
      pip.document.title = 'Axiom Studia Timer';
      const stylesheet = pip.document.createElement('link');
      stylesheet.rel = 'stylesheet';
      stylesheet.href = new URL('../css/floating-timer.css', import.meta.url).href;
      pip.document.head.append(stylesheet);
      const root = pip.document.createElement('main');
      root.className = 'floating-timer';
      root.innerHTML = '<div class="subject" id="floating-subject"></div><div class="countdown" id="floating-countdown" role="timer"></div><div class="controls"><button id="floating-pause"></button><button id="floating-end">End Session</button></div><button class="return" id="floating-return">Return to Workspace</button>';
      pip.document.body.append(root);
      root.querySelector('#floating-subject').textContent = subject.name;
      root.querySelector('#floating-pause').addEventListener('click', () => {
        if (timer.state === 'running') timer.pause();
        else if (timer.state === 'paused' || timer.state === 'idle') timer.start();
      });
      root.querySelector('#floating-end').addEventListener('click', () => this.endSession());
      root.querySelector('#floating-return').addEventListener('click', () => this.close(true));
      pip.addEventListener('pagehide', () => this.close(false), { once: true });
      this.unlisten = timer.subscribe(() => this.update());
      if (timer.state === 'idle') {
        timer.setContext(subjectId, null, null);
        timer.start();
      }
      this.update();
      this.announce();
      return true;
    } catch (error) {
      this.close(false);
      window.showToast?.('Could not open the floating timer in this browser.');
      return false;
    }
  }

  update() {
    if (!this.active) return;
    const doc = this.window.document;
    doc.querySelector('#floating-countdown').textContent = timer.formatTime(true);
    const pause = doc.querySelector('#floating-pause');
    pause.textContent = timer.state === 'running' ? 'Pause' : 'Resume';
    pause.disabled = timer.state === 'completed';
  }

  endSession(completedSession = null) {
    if (this.ending || !this.active) return;
    this.ending = true;
    const active = timer.state === 'running' || timer.state === 'paused' || timer.state === 'completed';
    if (active) {
      const durationSeconds = timer.getElapsedSeconds();
      const session = {
        subjectId: this.subjectId,
        topicId: timer.selectedTopicId,
        taskId: timer.selectedTaskId,
        startTime: timer.startTime || new Date().toISOString(),
        endTime: new Date().toISOString(),
        source: 'floating-timer',
        ...completedSession,
        // The floating session always uses actual active seconds, including
        // time spent on other tabs. Pauses never contribute to this value.
        durationMinutes: durationSeconds / 60
      };
      session.durationSeconds = durationSeconds;
      if (durationSeconds > 0) db.addFocusSession(session);
      timer.reset();
      window.showToast?.('Study time saved to your subject.');
    }
    this.close(!completedSession);
  }

  close(returnToWorkspace = false) {
    if (!this.window) return;
    const pip = this.window;
    this.window = null;
    this.unlisten?.();
    this.unlisten = null;
    timer.onComplete = this.previousCompletionHandler;
    timer.lockedSubjectId = null;
    this.previousCompletionHandler = null;
    this.subjectId = null;
    this.resourceId = null;
    this.ending = false;
    if (!pip.closed) pip.close();
    this.announce();
    if (returnToWorkspace) window.focus();
  }
}

export const floatingTimer = new FloatingTimer();
