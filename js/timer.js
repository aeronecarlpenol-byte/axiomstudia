/**
 * FOCUS//ECE — Focus Timer & Study Session Engine
 * High-precision timer with drift compensation, resistance checking, ambient sounds, and session logging.
 */

import { soundEngine } from './audio.js';

const DURATION_KEY = 'axiom_studia_study_duration';
const SECONDS_KEY = 'axiom_studia_study_duration_seconds';
export const MAX_DURATION_SECONDS = 99 * 3600 + 59 * 60 + 59;
export const isValidStudyDuration = minutes => Number.isFinite(minutes) && Math.abs(minutes * 60 - Math.round(minutes * 60)) < 1e-8 && minutes > 0 &&
  minutes * 60 <= MAX_DURATION_SECONDS;

function savedDuration() {
  try {
    const seconds = Number(localStorage.getItem(SECONDS_KEY));
    if (Number.isInteger(seconds) && seconds > 0 && seconds <= MAX_DURATION_SECONDS) return seconds / 60;
    const minutes = Number(localStorage.getItem(DURATION_KEY));
    if (isValidStudyDuration(minutes)) return minutes;
  } catch { /* Browser storage may be unavailable. */ }
  return 45;
}

export class TimerEngine {
  constructor() {
    this.selectedDurationMinutes = savedDuration();
    this.durationMinutes = this.selectedDurationMinutes;
    this.remainingSeconds = Math.round(this.durationMinutes * 60);
    this.totalSeconds = this.remainingSeconds;
    this._elapsedBeforeRestart = 0;
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

  setDuration(minutes, { restart = false } = {}) {
    if (!isValidStudyDuration(minutes)) return false;
    if (minutes === this.selectedDurationMinutes) return true;
    const active = this.state === 'running' || this.state === 'paused';
    if (active && !restart) return false;
    const wasRunning = this.state === 'running';
    const startTime = this.startTime;
    const remaining = this._deadlineMs === null ? this.remainingSeconds :
      Math.max(0, (this._deadlineMs - Date.now()) / 1000);
    const elapsed = active ? this._elapsedBeforeRestart + this.totalSeconds - remaining : 0;
    this.reset();
    this._elapsedBeforeRestart = elapsed;
    this.selectedDurationMinutes = minutes;
    this.durationMinutes = minutes;
    this.totalSeconds = Math.round(minutes * 60);
    this.remainingSeconds = this.totalSeconds;
    this._deadlineMs = null;
    try { localStorage.setItem(DURATION_KEY, String(minutes)); } catch { /* Storage may be disabled. */ }
    try { localStorage.setItem(SECONDS_KEY, String(this.totalSeconds)); } catch { /* Storage may be disabled. */ }
    if (active) {
      this.startTime = startTime;
      this.state = 'paused';
      if (wasRunning) this.start();
    }
    this.notify();
    return true;
  }

  get selectedDurationSeconds() { return Math.round(this.selectedDurationMinutes * 60); }

  setDurationSeconds(seconds, options) {
    if (!Number.isInteger(seconds) || seconds <= 0 || seconds > MAX_DURATION_SECONDS) return false;
    return this.setDuration(seconds / 60, options);
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
    if (this.state === 'completed') this.reset();

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
      const secsLeft = Math.max(0, (this._deadlineMs - Date.now()) / 1000);
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
      this.remainingSeconds = Math.max(0, (this._deadlineMs - Date.now()) / 1000);
      this._deadlineMs = null;
    }
    this.state = 'paused';
    soundEngine.stop();
    this.notify();
  }

  // Gives user 5 more minutes without pressure
  addFiveMinutes() {
    if (this._deadlineMs !== null) {
      this.remainingSeconds = Math.max(0, (this._deadlineMs - Date.now()) / 1000);
    }
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
      this.remainingSeconds = Math.max(0, (this._deadlineMs - Date.now()) / 1000);
      this._deadlineMs = null;
    }

    const elapsedSeconds = this._elapsedBeforeRestart + this.totalSeconds - this.remainingSeconds;
    const elapsedMinutes = Math.max(1, Math.round(elapsedSeconds / 60));

    this.state = 'idle';
    this.durationMinutes = this.selectedDurationMinutes;
    this.totalSeconds = Math.round(this.durationMinutes * 60);
    this.remainingSeconds = this.totalSeconds;
    this._elapsedBeforeRestart = 0;
    this.notify();

    return elapsedMinutes;
  }

  complete() {
    clearInterval(this.timerInterval);
    this.timerInterval = null;
    this._deadlineMs = null;
    this.remainingSeconds = 0;
    this.state = 'completed';
    soundEngine.stop();
    soundEngine.playChime();
    this.notify();

    // Trigger session completion modal
    if (window.focusApp) {
      window.focusApp.showSessionCompletionModal({
        durationMinutes: Math.max(1, Math.round((this._elapsedBeforeRestart + this.totalSeconds) / 60)),
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
    this.durationMinutes = this.selectedDurationMinutes;
    this.totalSeconds = Math.round(this.durationMinutes * 60);
    this.remainingSeconds = this.totalSeconds;
    this._elapsedBeforeRestart = 0;
    this.startTime = null;
    this.notify();
  }

  formatTime(includeHours = false) {
    const seconds = Math.ceil(this.remainingSeconds);
    const hours = Math.floor(seconds / 3600);
    const mins = includeHours ? Math.floor(seconds / 60) % 60 : Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (includeHours) return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
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
