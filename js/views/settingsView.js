/**
 * FOCUS//ECE — Settings & System Configuration
 * Academic profile and preferences.
 */

import { db } from '../db.js';
import { studentFields, validateStudentDetails, saveStudentDetails } from '../studentProfile.js';

const escapeSetting = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":"&#39;" })[char]);

export function renderSettings(container) {
  function render() {
    const profile = db.getUserProfile() || {};
    const period = db.getAcademicPeriod();

    container.innerHTML = `
      <div class="tasks-toolbar">
        <div>
          <h2>System Settings &amp; Preferences</h2>
          <p style="font-size: 0.85rem;">Configure your academic profile</p>
        </div>
      </div>

      <div style="display: flex; flex-direction: column; gap: var(--space-6); max-width: 800px;">
        <!-- Academic Profile -->
        <div class="card">
          <div class="card-header">
            <div class="card-title">👤 Student Profile</div>
          </div>

          <form id="profile-form">
            ${studentFields.map(({ key, label, placeholder, autocomplete }) => `
              <div class="form-group">
                <label class="form-label" for="profile-${key}">${label}</label>
                <input id="profile-${key}" name="${key}" type="text" required maxlength="200" value="${escapeSetting(profile[key])}" placeholder="${placeholder}" autocomplete="${autocomplete || 'off'}" aria-describedby="profile-${key}-error">
                <span class="profile-field-error" id="profile-${key}-error" data-error="${key}"></span>
              </div>`).join('')}
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Student ID Number</label>
                <input type="text" name="studentId" value="${escapeSetting(profile.studentId)}" />
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label class="form-label">University / School</label>
                <input type="text" name="school" value="${escapeSetting(profile.school)}" />
              </div>
            </div>

            <fieldset class="academic-settings">
              <legend class="form-label">Current Academic Semester &amp; Year</legend>
              <div class="form-row">
                <div class="form-group">
                  <label class="form-label" for="academic-semester">Semester</label>
                  <select id="academic-semester" name="semester" required>
                    <option value="" disabled ${!['1st Semester','2nd Semester','3rd Semester'].includes(period.semester) ? 'selected' : ''}>Select semester</option>
                    ${['1st Semester','2nd Semester','3rd Semester'].map(value => `<option value="${value}" ${period.semester === value ? 'selected' : ''}>${value}</option>`).join('')}
                  </select>
                </div>
                <div class="form-group">
                  <label class="form-label" for="academic-school-year">School Year</label>
                  <input id="academic-school-year" type="text" name="schoolYear" value="${escapeSetting(period.schoolYear)}" placeholder="2026–2027" pattern="[0-9]{4}\\s*(?:–|—|-)\\s*[0-9]{4}" title="Enter a school year such as 2026–2027" required />
                </div>
              </div>
            </fieldset>

            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Daily Focus Goal (Minutes)</label>
                <input type="number" name="dailyGoal" value="${profile.dailyFocusGoalMinutes ?? 240}" step="15" min="30" />
              </div>
            </div>

            <button type="submit" class="btn btn-primary" style="margin-top: var(--space-2);">
              Save Profile Changes
            </button>
            <p class="profile-save-status" role="status" aria-live="polite"></p>
          </form>
        </div>
      </div>
    `;

    // Profile form
    const form = container.querySelector('#profile-form');
    form.addEventListener('input', e => {
      e.target.setCustomValidity?.('');
      e.target.removeAttribute('aria-invalid');
      const error = form.querySelector(`[data-error="${e.target.name}"]`);
      if (error) error.textContent = '';
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const details = validateStudentDetails(form);
      if (!details) return;
      const fd = new FormData(e.target);
      const button = form.querySelector('button[type="submit"]');
      const status = form.querySelector('[role="status"]');
      button.disabled = true;
      status.textContent = 'Saving…';
      try {
        await saveStudentDetails(details, { updates: {
          studentId: fd.get('studentId'),
          school: fd.get('school'),
          semester: fd.get('semester'),
          schoolYear: fd.get('schoolYear').trim(),
          dailyFocusGoalMinutes: parseInt(fd.get('dailyGoal'), 10) || 240
        } });
        status.textContent = 'Academic profile updated.';
        button.textContent = 'Save Profile Changes';
      } catch (error) {
        status.textContent = error.message;
        button.textContent = 'Retry';
      } finally {
        button.disabled = false;
      }
    });
  }

  return render();
}
