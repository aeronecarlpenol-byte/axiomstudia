/**
 * FOCUS//ECE — Settings & System Configuration
 * Academic profile and Data Backup/Restore.
 */

import { db } from '../db.js';

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
                <label class="form-label">Full Name</label>
                <input type="text" name="name" value="${escapeSetting(profile.name)}" required />
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

        <!-- Data Backup & Reset -->
        <div class="card">
          <div class="card-header">
            <div class="card-title">💾 Data Operations & Portability</div>
          </div>

          <p style="margin-bottom: var(--space-3);">This workspace is stored in this browser. Export a backup before switching devices or clearing browser data.</p>
          <div style="display: flex; gap: var(--space-3); flex-wrap: wrap;">
            <button class="btn btn-secondary" id="btn-export-data">
              ⬇ Export Backup (JSON)
            </button>
            <label class="btn btn-secondary" style="margin: 0; cursor: pointer;">
              ⬆ Import Backup (JSON)
              <input type="file" id="file-import-input" accept=".json" style="display: none;" />
            </label>
            <button class="btn btn-danger" id="btn-reset-data">
              Reset to Defaults
            </button>
          </div>
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

    // Export Data
    container.querySelector('#btn-export-data').addEventListener('click', () => {
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(db.exportJSON());
      const dlAnchor = document.createElement('a');
      dlAnchor.setAttribute("href", dataStr);
      dlAnchor.setAttribute("download", `axiom_studia_backup_${new Date().toISOString().split('T')[0]}.json`);
      dlAnchor.click();
    });

    // Import Data
    container.querySelector('#file-import-input').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
          const success = db.importJSON(event.target.result);
          if (success) {
            alert("Backup successfully restored!");
            location.reload();
          } else {
            alert("Failed to parse backup JSON file.");
          }
        };
        reader.readAsText(file);
      }
    });

    // Reset Data
    container.querySelector('#btn-reset-data').addEventListener('click', () => {
      if (confirm("Reset Axiom Studia to a blank workspace? Your current entries will be lost unless you exported a backup.")) {
        db.reset();
        location.reload();
      }
    });
  }

  render();
}
