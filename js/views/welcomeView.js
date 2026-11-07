import { db } from '../db.js';
import { studentFields, validateStudentDetails, saveStudentDetails } from '../studentProfile.js';

export function renderWelcome(container) {
  const profile = db.getUserProfile() || {};
  container.innerHTML = `
    <section class="welcome-card" aria-labelledby="welcome-heading">
      <img class="welcome-logo" src="assets/axiom-logo.png" alt="" width="56" height="56">
      <h1 id="welcome-heading">Welcome to Axiom Studia</h1>
      <p class="welcome-subtitle">Let’s set up your study space.</p>
      <form id="welcome-form" novalidate>
        ${studentFields.map(({ key, label, placeholder, autocomplete }) => `
          <div class="form-group">
            <label class="form-label" for="welcome-${key}">${label}</label>
            <input id="welcome-${key}" name="${key}" type="text" required maxlength="200"
              placeholder="${placeholder}" autocomplete="${autocomplete || 'off'}" aria-describedby="welcome-${key}-error">
            <span class="profile-field-error" id="welcome-${key}-error" data-error="${key}"></span>
          </div>`).join('')}
        <p class="profile-save-status" role="status" aria-live="polite"></p>
        <button class="btn btn-primary" type="submit">Start</button>
      </form>
    </section>`;
  const form = container.querySelector('form');
  for (const { key } of studentFields) form.elements.namedItem(key).value = profile[key] || '';
  // Hash changes must not discard a failed save or an in-progress form.
  form.addEventListener('input', e => {
    e.target.setCustomValidity('');
    e.target.removeAttribute('aria-invalid');
    const error = form.querySelector(`[data-error="${e.target.name}"]`);
    if (error) error.textContent = '';
  });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const details = validateStudentDetails(form);
    if (!details) return;
    const button = form.querySelector('button');
    const status = form.querySelector('[role="status"]');
    button.disabled = true;
    form.querySelectorAll('input').forEach(input => { input.readOnly = true; });
    button.textContent = 'Saving…';
    form.setAttribute('aria-busy', 'true');
    status.textContent = '';
    try {
      await saveStudentDetails(details, { setup: true });
      location.hash = '#dashboard';
    } catch (error) {
      status.textContent = error.message;
      button.textContent = 'Retry';
    } finally {
      button.disabled = false;
      form.querySelectorAll('input').forEach(input => { input.readOnly = false; });
      form.removeAttribute('aria-busy');
    }
  });
}
