/**
 * FOCUS//ECE — Settings & System Configuration
 * Academic profile and preferences.
 */

import { db } from '../db.js';
import { clearStoredPdfs } from '../pdfStorage.js';
import { studentFields, validateStudentDetails, saveStudentDetails, anonymousWorkspaceNotice } from '../studentProfile.js';
import { googleClientId, saveGoogleClientId, googleConnectionStatus, connectGoogle, disconnectGoogle, listGoogleDriveFiles, prepareGoogleConnection } from '../googleDriveConnection.js';

const escapeSetting = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":"&#39;" })[char]);

export function renderSettings(container) {
  function render() {
    prepareGoogleConnection().catch(() => {});
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
            <p class="anonymous-workspace-note">${anonymousWorkspaceNotice}</p>

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

            <button type="submit" class="btn btn-primary" style="margin-top: var(--space-2);">
              Save Profile Changes
            </button>
            <p class="profile-save-status" role="status" aria-live="polite"></p>
          </form>
        </div>
        <section class="card" aria-labelledby="connected-accounts-title">
          <div class="card-header"><h3 class="card-title" id="connected-accounts-title">Connected Accounts</h3></div>
          <p>Google Drive <span id="google-connection-status">${googleConnectionStatus()}</span></p>
          <label class="form-group"><span class="form-label">Google OAuth Web Client ID</span><input id="google-client-id" value="${escapeSetting(googleClientId())}" autocomplete="off" placeholder="Your Google Web Client ID"></label>
          <div class="form-row"><button class="btn btn-primary" type="button" id="google-connect">Connect or Reauthorize</button><button class="btn btn-secondary" type="button" id="google-disconnect">Disconnect</button></div>
          <p id="google-connection-message" role="status" aria-live="polite"></p>
          <div id="google-file-list"></div>
        </section>
        <section class="card" aria-labelledby="workspace-data-title">
          <div class="card-header">
            <h3 class="card-title" id="workspace-data-title">Workspace Data</h3>
          </div>
          <p>Clear the workspace and uploaded PDFs from this browser to start over. The anonymous online backup remains stored and will no longer be accessible from the new workspace.</p>
          <button type="button" class="btn btn-secondary" id="workspace-clear-data">Clear Workspace Data</button>
          <p id="workspace-clear-status" role="status"></p>
        </section>
        <section class="card" aria-labelledby="feedback-title">
          <div class="card-header">
            <h3 class="card-title" id="feedback-title">Feedback</h3>
          </div>
          <div style="display: flex; flex-wrap: wrap; gap: var(--space-2);">
            <a class="btn btn-primary" href="mailto:aeronecarlpenol@gmail.com?subject=Axiom%20Studia%20Feedback">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="3" y="5" width="18" height="14" rx="2"/>
                <path d="m4 7 8 6 8-6"/>
              </svg>
              Send Feedback
            </a>
            <a class="btn btn-secondary" href="https://www.facebook.com/aerone.carl1/" target="_blank" rel="noopener noreferrer">Facebook</a>
            <a class="btn btn-secondary" href="https://www.instagram.com/aerone_carl/" target="_blank" rel="noopener noreferrer">Instagram</a>
          </div>
        </section>
      </div>
    `;

    const googleMessage = container.querySelector('#google-connection-message');
    const updateGoogleStatus = () => { container.querySelector('#google-connection-status').textContent = googleConnectionStatus(); };
    container.querySelector('#google-connect').addEventListener('click', async () => {
      try {
        saveGoogleClientId(container.querySelector('#google-client-id').value);
        await connectGoogle();
        const files = await listGoogleDriveFiles();
        const list = container.querySelector('#google-file-list');
        list.replaceChildren();
        const heading = document.createElement('p');
        heading.textContent = `${files.length} accessible Google Drive files`;
        list.append(heading);
        for (const file of files) {
          const line = document.createElement('div');
          line.textContent = file.name;
          list.append(line);
        }
        googleMessage.textContent = 'Google Drive connected.';
      } catch (error) { googleMessage.textContent = error.message; }
      updateGoogleStatus();
    });
    container.querySelector('#google-disconnect').addEventListener('click', async () => {
      try { await disconnectGoogle(); googleMessage.textContent = 'Google Drive disconnected.'; }
      catch (error) { googleMessage.textContent = error.message; }
      container.querySelector('#google-file-list').replaceChildren();
      updateGoogleStatus();
    });

    const clearButton = container.querySelector('#workspace-clear-data');
    const clearStatus = container.querySelector('#workspace-clear-status');
    clearButton.addEventListener('click', async () => {
      if (!window.confirm('Permanently clear the local workspace and uploaded PDFs from this browser and start over?')) return;
      clearButton.disabled = true;
      clearStatus.textContent = 'Clearing workspace data…';
      try {
        await clearStoredPdfs();
        for (const storage of [sessionStorage, localStorage]) {
          const appKeys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
            .filter(key => /^axiom[_-]/.test(key));
          for (const key of appKeys) storage.removeItem(key);
        }
        location.reload();
      } catch {
        clearStatus.textContent = 'Could not finish clearing workspace data. Try again.';
        clearButton.disabled = false;
      }
    });

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
          school: fd.get('school'),
          semester: fd.get('semester'),
          schoolYear: fd.get('schoolYear').trim()
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
