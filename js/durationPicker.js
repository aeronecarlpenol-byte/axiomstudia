/** Compact, editable duration wheels. Selection is committed after scrolling settles. */
export function durationPickerMarkup(seconds) {
  const values = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60];
  return `<fieldset class="ws-duration-picker"><legend>Study duration</legend>
    <div class="ws-duration-wheels">${['Hours', 'Minutes', 'Seconds'].map((label, i) => `
      ${i ? '<span class="ws-duration-colon" aria-hidden="true">:</span>' : ''}
      <div class="ws-duration-column" data-duration-column>
        <label for="ws-duration-${label.toLowerCase()}">${label}</label>
        <div class="ws-duration-wheel">
          <div class="ws-duration-scroll" aria-hidden="true">${Array.from({ length: i ? 60 : 100 }, (_, n) => `<div class="ws-duration-number">${String(n).padStart(2, '0')}</div>`).join('')}</div>
          <input id="ws-duration-${label.toLowerCase()}" type="text" inputmode="numeric" role="spinbutton"
            autocomplete="off" aria-valuemin="0" aria-valuemax="${i ? 59 : 99}" aria-valuenow="${values[i]}"
            aria-describedby="ws-duration-help ws-duration-error" value="${String(values[i]).padStart(2, '0')}" />
        </div>
      </div>`).join('')}</div>
    <p id="ws-duration-help">Scroll or swipe · Click to type · ↑ ↓ to adjust</p>
    <p id="ws-duration-error" role="alert" hidden></p>
  </fieldset>`;
}

export function mountDurationPicker(root, timer, onChange) {
  const columns = [...root.querySelectorAll('[data-duration-column]')];
  const inputs = columns.map(column => column.querySelector('input'));
  const error = root.querySelector('#ws-duration-error');
  const timers = new Set();
  const cancelPending = new Set();
  let disposed = false;
  const rowHeight = 36;
  const validate = () => {
    let valid = true;
    inputs.forEach((input, i) => {
      const raw = input.value.trim();
      const ok = /^\d{1,2}$/.test(raw) && Number(raw) <= (i ? 59 : 99);
      input.setAttribute('aria-invalid', String(!ok));
      if (ok) input.setAttribute('aria-valuenow', String(Number(raw)));
      else input.removeAttribute('aria-valuenow');
      valid &&= ok;
    });
    const seconds = inputs.reduce((sum, input, i) => sum + Number(input.value) * [3600, 60, 1][i], 0);
    error.hidden = valid && seconds > 0;
    error.textContent = valid ? (seconds > 0 ? '' : 'Choose a duration greater than zero.') :
      'Enter whole numbers: hours 0–99, minutes and seconds 0–59.';
    return error.hidden ? seconds : null;
  };
  const sync = () => {
    const seconds = timer.selectedDurationSeconds;
    const values = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60];
    inputs.forEach((input, i) => {
      input.value = String(values[i]).padStart(2, '0');
      columns[i].querySelector('.ws-duration-scroll').scrollTop = values[i] * rowHeight;
    });
    validate();
  };
  const apply = () => {
    cancelPending.forEach(cancel => cancel());
    const seconds = validate();
    if (seconds === null) return false;
    if (seconds !== timer.selectedDurationSeconds) {
      const active = timer.state === 'running' || timer.state === 'paused';
      const formatted = inputs.map(input => input.value.padStart(2, '0')).join(' : ');
      if (active && !window.confirm(`Restart the countdown at ${formatted}? Time already studied will still count toward this session.`)) {
        sync();
        return false;
      }
      if (!timer.setDurationSeconds(seconds, { restart: active })) return false;
      onChange();
    }
    sync();
    return true;
  };
  columns.forEach((column, i) => {
    const input = inputs[i];
    const scroll = column.querySelector('.ws-duration-scroll');
    const max = i ? 59 : 99;
    let pending;
    let dragging = null;
    let swiped = false;
    const cancel = () => { clearTimeout(pending); timers.delete(pending); };
    cancelPending.add(cancel);
    const schedule = () => {
      cancel();
      pending = setTimeout(() => { timers.delete(pending); if (!disposed && !dragging) apply(); }, 180);
      timers.add(pending);
    };
    const move = value => {
      input.value = String(Math.max(0, Math.min(max, value))).padStart(2, '0');
      scroll.scrollTop = Number(input.value) * rowHeight;
      validate();
    };
    scroll.addEventListener('scroll', () => {
      const value = Math.max(0, Math.min(max, Math.round(scroll.scrollTop / rowHeight)));
      if (Number(input.value) === value && input.value !== '') return;
      input.value = String(value).padStart(2, '0');
      validate();
      schedule();
    });
    scroll.addEventListener('click', event => {
      const row = event.target.closest('.ws-duration-number');
      if (!row) return;
      move(Number(row.textContent));
      apply();
    });
    input.addEventListener('wheel', event => {
      event.preventDefault();
      move((Number(input.value) || 0) + Math.sign(event.deltaY));
      schedule();
    }, { passive: false });
    input.addEventListener('input', validate);
    input.addEventListener('change', () => { if (!swiped) apply(); });
    input.addEventListener('focus', () => input.select());
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); apply(); }
      if (event.key === 'Escape') { cancel(); sync(); }
      const steps = { ArrowUp: 1, ArrowDown: -1, PageUp: 10, PageDown: -10 };
      if (event.key in steps || event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        move(event.key === 'Home' ? 0 : event.key === 'End' ? max : (Number(input.value) || 0) + steps[event.key]);
        schedule();
      }
    });
    input.addEventListener('pointerdown', event => {
      swiped = false;
      if (event.pointerType === 'mouse') return;
      dragging = { y: event.clientY, value: Number(input.value) || 0 };
      input.setPointerCapture(event.pointerId);
    });
    input.addEventListener('pointermove', event => {
      if (!dragging) return;
      const delta = Math.round((dragging.y - event.clientY) / rowHeight);
      if (delta) swiped = true;
      if (swiped) move(dragging.value + delta);
    });
    input.addEventListener('pointerup', () => {
      dragging = null;
      if (swiped) { input.blur(); apply(); }
      swiped = false;
    });
    input.addEventListener('pointercancel', () => { dragging = null; sync(); });
  });
  sync();
  return { apply, sync, focus: () => (inputs.find(input => input.getAttribute('aria-invalid') === 'true') || inputs[0]).focus(),
    destroy: () => { disposed = true; timers.forEach(clearTimeout); } };
}
