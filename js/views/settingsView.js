/**
 * FOCUS//ECE — Settings & System Configuration
 * Preferences, Purpose Statement editor, and Data Backup/Restore.
 */

import { db } from '../db.js';

export function renderSettings(container) {
  function render() {
    const profile = db.getUserProfile();

    container.innerHTML = `
      <div class="tasks-toolbar">
        <div>
          <h2>System Settings & Preferences</h2>
          <p style="font-size: 0.85rem;">Configure your academic profile, appearance, purpose statement, and storage</p>
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
                <input type="text" name="name" value="${profile.name}" required />
              </div>
              <div class="form-group">
                <label class="form-label">Student ID Number</label>
                <input type="text" name="studentId" value="${profile.studentId || ''}" />
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label class="form-label">University / School</label>
                <input type="text" name="school" value="${profile.school || ''}" />
              </div>
              <div class="form-group">
                <label class="form-label">Degree & Program</label>
                <input type="text" name="major" value="${profile.major}" />
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Current Academic Semester & Year</label>
                <input type="text" name="semester" value="${profile.semester}" />
              </div>
              <div class="form-group">
                <label class="form-label">Daily Focus Goal (Minutes)</label>
                <input type="number" name="dailyGoal" value="${profile.dailyFocusGoalMinutes}" step="15" min="30" />
              </div>
            </div>

            <button type="submit" class="btn btn-primary" style="margin-top: var(--space-2);">
              Save Profile Changes
            </button>
          </form>
        </div>

        <!-- Appearance & Theme -->
        <div class="card">
          <div class="card-header">
            <div class="card-title">🎨 Appearance & Atmosphere</div>
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div>
              <div style="font-weight: 500;">Interface Color Theme</div>
              <div style="font-size: 0.8rem; color: var(--text-muted);">Toggle between high-contrast engineering dark blueprint and clean light mode</div>
            </div>
            <div style="display: flex; gap: var(--space-2);">
              <button class="btn ${profile.theme === 'dark' ? 'btn-primary' : 'btn-secondary'} btn-sm" id="btn-theme-dark">
                Dark Mode
              </button>
              <button class="btn ${profile.theme === 'light' ? 'btn-primary' : 'btn-secondary'} btn-sm" id="btn-theme-light">
                Light Mode
              </button>
            </div>
          </div>
        </div>

        <!-- Personal Purpose Statement ("Why am I doing this?") -->
        <div class="card">
          <div class="card-header">
            <div class="card-title">💡 Personal Purpose Statement</div>
          </div>
          <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: var(--space-3);">
            This statement is recalled whenever you click "WHY AM I DOING THIS?" during resistance in focus mode.
          </p>

          <form id="purpose-form">
            <div class="form-group">
              <textarea name="purposeStatement" rows="3" style="font-size: 0.95rem; line-height: 1.6;">${profile.purposeStatement}</textarea>
            </div>
            <button type="submit" class="btn btn-primary">Update Purpose Statement</button>
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
        dailyFocusGoalMinutes: parseInt(fd.get('dailyGoal'), 10) || 240
      });
      alert("Academic profile updated.");
    });

    // Theme switches
    container.querySelector('#btn-theme-dark').addEventListener('click', () => {
      db.updateUserProfile({ theme: 'dark' });
      document.documentElement.setAttribute('data-theme', 'dark');
      render();
    });
    container.querySelector('#btn-theme-light').addEventListener('click', () => {
      db.updateUserProfile({ theme: 'light' });
      document.documentElement.setAttribute('data-theme', 'light');
      render();
    });

    // Purpose form
    container.querySelector('#purpose-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      db.updateUserProfile({
        purposeStatement: fd.get('purposeStatement')
      });
      alert("Purpose statement updated.");
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
