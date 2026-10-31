/**
 * FOCUS//ECE — Settings & System Configuration
 * Academic profile, cloud storage, and privacy.
 */

import { db } from '../db.js';
import { mountCloudStatus } from '../cloudSync.js';

const escapeSetting = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);

export function renderSettings(container) {
  function render() {
    const profile = db.getUserProfile() || {};
    const period = db.getAcademicPeriod();

    container.innerHTML = `
      <div class="tasks-toolbar">
        <div>
          <h2>System Settings & Preferences</h2>
          <p style="font-size: 0.85rem;">Configure your academic profile and storage</p>
        </div>
      </div>

      <div style="display: flex; flex-direction: column; gap: var(--space-6); max-width: 800px;">
        <!-- Academic Profile -->
        <div class="card">
          <div class="card-header">
            <div class="card-title">👤 Student Profile</div>
          </div>

          <form id="profile-form">
            <div class="form-row">
              <div class="form-group">
                <label class="form-label" for="display-name">Display Name</label>
                <input type="text" id="display-name" name="name" maxlength="200" value="${escapeSetting(profile.name)}" />
              </div>
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
              <div class="form-group">
                <label class="form-label">Degree & Program</label>
                <input type="text" name="major" value="${escapeSetting(profile.major)}" />
              </div>
            </div>

            <fieldset class="academic-settings">
              <legend class="form-label">Current Academic Semester & Year</legend>
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
          </form>
        </div>

        <div class="card">
          <div class="card-header"><div class="card-title">Cloud Storage</div></div>
          <div id="settings-cloud-status"></div>
          <p>You can use this app without an account. Your display name is only a label; it never unlocks another workspace.</p>
          <p>When cloud storage is connected, your workspace is stored in the cloud and linked to this browser’s anonymous session. Clearing browser data or changing devices may make it inaccessible.</p>
        </div>
        <div class="card">
          <div class="card-header"><div class="card-title">Privacy</div></div>
          <p>The owner can view your entered display name, first visit, and approximate last active time. A unique anonymous ID identifies your workspace. We record this basic activity to operate the app; no browsing history is collected.</p>
          <p>Uploaded PDF files remain on this device; their references, bookmarks, and reading progress are included in cloud sync.</p>
        </div>
        <div style="text-align:center; color:var(--text-muted)">
          <button id="settings-brand" type="button" class="btn btn-ghost" aria-label="AXIOM STUDIA. Activate five times to open admin sign-in.">AXIOM STUDIA</button>
        </div>
      </div>
    `;

    // Profile form
    container.querySelector('#profile-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      db.updateUserProfile({
        name: fd.get('name'),
        studentId: fd.get('studentId'),
        school: fd.get('school'),
        major: fd.get('major'),
        semester: fd.get('semester'),
        schoolYear: fd.get('schoolYear').trim(),
        dailyFocusGoalMinutes: parseInt(fd.get('dailyGoal'), 10) || 240
      });
      alert("Academic profile updated.");
    });

    let activations = 0;
    let lastActivation = 0;
    container.querySelector('#settings-brand').addEventListener('click', () => {
      const now = Date.now();
      if (now - lastActivation > 5000) activations = 0;
      lastActivation = now;
      if (++activations >= 5) { activations = 0; location.hash = '#admin'; }
    });
    return mountCloudStatus(container.querySelector('#settings-cloud-status'));
  }

  return render();
}
