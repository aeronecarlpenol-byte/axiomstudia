/**
 * FOCUS//ECE — Focus Timer & Study Session Engine
 * High-precision timer with drift compensation, resistance checking, ambient sounds, and session logging.
 */

import { db } from './db.js';
import { soundEngine } from './audio.js';

class TimerEngine {
  constructor() {
    this.durationMinutes = 45;
    this.remainingSeconds = 45 * 60;
    this.totalSeconds = 45 * 60;
    this.state = 'idle'; // 'idle' | 'running' | 'paused' | 'completed'

    this.selectedSubjectId = null;
    this.selectedTopicId = null;
    this.selectedTaskId = null;

    this.startTime = null;
    this.timerInterval = null;
    this.listeners = new Set();
    this.ambientSound = 'none'; // 'none' | 'brown' | 'rain' | 'library'

    this.resistancePromptShown = false;
    this._deadlineMs = null; // absolute epoch ms when timer reaches 0
  }

  setDuration(minutes) {
    if (this.state === 'running') return;
    this.durationMinutes = minutes;
    this.totalSeconds = minutes * 60;
    this.remainingSeconds = this.totalSeconds;
    this._deadlineMs = null;
    this.notify();
  }

  setContext(subjectId, topicId, taskId) {
    this.selectedSubjectId = subjectId || null;
    this.selectedTopicId = topicId || null;
    this.selectedTaskId = taskId || null;
    this.notify();
  }

  setAmbientSound(sound) {
    this.ambientSound = sound;
    if (this.state === 'running') {
      if (sound === 'brown') soundEngine.playBrownNoise();
      else if (sound === 'rain') soundEngine.playRain();
      else if (sound === 'library') soundEngine.playLibrary();
      else soundEngine.stop();
    } else {
      soundEngine.stop();
    }
    this.notify();
  }

  start() {
    if (this.state === 'running') return;

    if (this.state === 'idle') {
      this.startTime = new Date().toISOString();
      this.resistancePromptShown = false;
    }

    this.state = 'running';

    // Deadline-based: compute the absolute ms epoch when the countdown hits 0.
    // On resume from pause, remainingSeconds is already the amount left,
    // so the new deadline is simply now + that many seconds.
    // This makes the timer immune to tab-backgrounding, slow intervals, and drift.
    this._deadlineMs = Date.now() + this.remainingSeconds * 1000;

    // Start ambient sound if selected
    this.setAmbientSound(this.ambientSound);

    this.timerInterval = setInterval(() => {
      const secsLeft = Math.max(0, Math.round((this._deadlineMs - Date.now()) / 1000));
      this.remainingSeconds = secsLeft;
      this.notify();

      if (secsLeft <= 0) {
        this.complete();
      }
    }, 500);

    this.notify();
  }

  pause() {
    if (this.state !== 'running') return;
    clearInterval(this.timerInterval);
    this.timerInterval = null;
    if (this._deadlineMs) {
      this.remainingSeconds = Math.max(0, Math.round((this._deadlineMs - Date.now()) / 1000));
      this._deadlineMs = null;
    }
    this.state = 'paused';
    soundEngine.stop();
    this.notify();
  }

  // Gives user 5 more minutes without pressure
  addFiveMinutes() {
    this.remainingSeconds += 5 * 60;
    this.totalSeconds += 5 * 60;
    this.durationMinutes += 5;
    if (this.state === 'running') {
      this._deadlineMs = Date.now() + this.remainingSeconds * 1000;
    } else {
      this.start();
    }
    this.notify();
  }

  stopEarly() {
    clearInterval(this.timerInterval);
    this.timerInterval = null;
    soundEngine.stop();

    if (this._deadlineMs) {
      this.remainingSeconds = Math.max(0, Math.round((this._deadlineMs - Date.now()) / 1000));
      this._deadlineMs = null;
    }

    const elapsedSeconds = this.totalSeconds - this.remainingSeconds;
    const elapsedMinutes = Math.max(1, Math.round(elapsedSeconds / 60));

    this.state = 'idle';
    this.remainingSeconds = this.totalSeconds;
    this.notify();

    return elapsedMinutes;
  }

  complete() {
    clearInterval(this.timerInterval);
    this.timerInterval = null;
    this._deadlineMs = null;
    this.state = 'completed';
    soundEngine.stop();
    soundEngine.playChime();
    this.notify();

    // Trigger session completion modal
    if (window.focusApp) {
      window.focusApp.showSessionCompletionModal({
        durationMinutes: this.durationMinutes,
        subjectId: this.selectedSubjectId,
        topicId: this.selectedTopicId,
        taskId: this.selectedTaskId,
        startTime: this.startTime,
        endTime: new Date().toISOString()
      });
    }
  }

  reset() {
    clearInterval(this.timerInterval);
    this.timerInterval = null;
    this._deadlineMs = null;
    soundEngine.stop();
    this.state = 'idle';
    this.remainingSeconds = this.totalSeconds;
    this.notify();
  }

  formatTime() {
    const mins = Math.floor(this.remainingSeconds / 60);
    const secs = this.remainingSeconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  getProgress() {
    if (this.totalSeconds === 0) return 0;
    return ((this.totalSeconds - this.remainingSeconds) / this.totalSeconds) * 100;
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify() {
    for (const fn of this.listeners) {
      try {
        fn(this);
      } catch (e) {
        console.error("Timer listener error", e);
      }
    }
  }
}

export const timer = new TimerEngine();
