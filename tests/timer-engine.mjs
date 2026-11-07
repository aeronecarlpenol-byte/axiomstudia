import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

let now = 1000000;
let tick;
let completion;
const storage = new Map([['axiom_studia_study_duration', '37']]);
class Clock extends Date { static now() { return now; } }
const context = vm.createContext({
  Date: Clock, console,
  localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
  setInterval: fn => { tick = fn; return 1; }, clearInterval: () => {},
  soundEngine: { stop() {}, playChime() {} },
  window: { focusApp: { showSessionCompletionModal: data => { completion = data; } } }
});
vm.runInContext(fs.readFileSync(new URL('../js/timer.js', import.meta.url), 'utf8')
  .replace("import { soundEngine } from './audio.js';", '')
  .replaceAll('export ', '') + '\nglobalThis.Engine = TimerEngine; globalThis.valid = isValidStudyDuration;', context);
const timer = new context.Engine();
assert.equal(timer.selectedDurationSeconds, 37 * 60, 'legacy minutes migrate');
for (const invalid of [0, -1, 360000, 1.2, NaN, Infinity]) assert.equal(timer.setDurationSeconds(invalid), false);
for (let seconds = 1; seconds <= 359999; seconds++) {
  assert.equal(context.valid(seconds / 60), true);
}
assert.equal(timer.setDurationSeconds(31), true);
assert.equal(new context.Engine().selectedDurationSeconds, 31, 'seconds survive reload');
timer.start();
for (let i = 0; i < 100; i++) { now += 100; timer.pause(); now += 1000; timer.start(); }
assert.ok(Math.abs(timer.remainingSeconds - 21) < 1e-9, 'repeated pauses preserve fractional seconds');
assert.equal(timer.setDurationSeconds(60), false, 'active changes need explicit restart');
assert.equal(timer.setDurationSeconds(60, { restart: true }), true);
assert.ok(Math.abs(timer._elapsedBeforeRestart - 10) < 1e-9);
assert.equal(timer.state, 'running');
now += 20000;
timer.pause();
assert.equal(timer.setDurationSeconds(90, { restart: true }), true);
assert.equal(timer.state, 'paused');
assert.ok(Math.abs(timer._elapsedBeforeRestart - 30) < 1e-9);
timer.start();
now += 89501;
tick();
assert.equal(timer.state, 'running', 'countdown does not complete half a second early');
assert.equal(timer.formatTime(true), '00:00:01');
now += 499;
tick();
assert.equal(timer.state, 'completed');
assert.equal(completion.durationMinutes, 2, 'elapsed time survives multiple restarts');
timer.reset();
assert.equal(timer.remainingSeconds, 90);
timer.addFiveMinutes();
timer.reset();
assert.equal(timer.remainingSeconds, 90, 'reset restores selection after extension');
console.log('Timer engine passed: bounds, persistence, legacy migration, pause precision, confirmed restarts, completion timing, accumulated study time, reset.');
