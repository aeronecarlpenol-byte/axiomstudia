/**
 * FOCUS//ECE — Resources & External Links System
 * Grouped resources (LEARN, PRACTICE, SUBMIT) and external link management with OPEN ↗.
 */

import { db } from '../db.js';
import { parseYouTubeUrl } from '../youtube.js';

export function renderResources(container) {
  function render() {
    const resources = db.getResources();
    const subjects = db.getSubjects();

    // Grouping by LEARN, PRACTICE, SUBMIT, and OTHER
    const learnGroup = resources.filter(r => ['Lecture', 'Module', 'Reference'].includes(r.category));
    const practiceGroup = resources.filter(r => ['Practice', 'Calculator'].includes(r.category));
    const submitGroup = resources.filter(r => ['Submission', 'Assignment'].includes(r.category));
    const otherGroup = resources.filter(r => !['Lecture', 'Module', 'Reference', 'Practice', 'Calculator', 'Submission', 'Assignment'].includes(r.category));

    const renderCard = (res) => {
      const sub = db.getSubjectById(res.subjectId);
      const top = db.getTopicById(res.topicId);

      let icon = '🔗';
      if (res.type === 'youtube' || res.category === 'Lecture' || res.type === 'video') icon = '🎥';
      else if (res.category === 'Module' || res.type === 'pdf') icon = '📄';
      else if (res.category === 'Calculator') icon = '🧮';
      else if (res.type === 'textbook') icon = '📖';

      return `
        <div class="resource-card">
          <div>
            <div class="resource-card-header">
              <span class="resource-icon">${icon}</span>
              <div style="flex: 1; min-width: 0;">
                <div style="font-weight: 600; font-size: 0.95rem; color: var(--text-primary); line-height: 1.3;">${res.title}</div>
                <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 2px;">
                  ${res.domain || 'External Website'} · <span class="badge" style="font-size: 0.7rem; padding: 1px 6px;">${res.category}</span>
                </div>
              </div>
            </div>

            ${res.description ? `<p style="font-size: 0.82rem; margin-bottom: var(--space-3); line-height: 1.4;">${res.description}</p>` : ''}
            
            <div style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: var(--space-3);">
              ${sub ? `<span style="color: ${sub.color}; font-weight: 500;">${sub.code}</span>` : ''}
              ${top ? ` · ${top.name}` : ''}
            </div>
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--border-subtle); padding-top: var(--space-2);">
            <a href="${res.subjectId && (res.type === 'youtube' || res.type === 'pdf') ? '#subjects' : res.url}" ${res.subjectId && (res.type === 'youtube' || res.type === 'pdf') ? `data-study-resource="${res.id}"` : 'target="_blank" rel="noopener noreferrer"'} class="btn-open-link">
              <span>OPEN</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
            </a>
            <button class="btn btn-ghost btn-sm" data-action="delete-resource" data-res-id="${res.id}" style="color: var(--accent-rose); font-size: 0.75rem;">Delete</button>
          </div>
        </div>
      `;
    };

    container.innerHTML = `
      <div class="tasks-toolbar">
        <div>
          <h2>Resources & Study Materials</h2>
          <p style="font-size: 0.85rem;">Course modules, lecture recordings, simulators, textbooks, and submission links</p>
        </div>
        <button class="btn btn-primary" id="btn-add-resource">
          + Add Resource / Link
        </button>
      </div>

      <!-- LEARN SECTION -->
      <div class="resource-group">
        <div class="resource-group-title">
          <span>📖 LEARN</span>
          <span style="font-size: 0.75rem; color: var(--text-muted);">Modules · Lecture Videos · Reference Notes</span>
        </div>
        <div class="resource-grid">
          ${learnGroup.length ? learnGroup.map(renderCard).join('') : '<p style="color: var(--text-muted); font-size: 0.85rem;">No learning modules attached.</p>'}
        </div>
      </div>

      <!-- PRACTICE SECTION -->
      <div class="resource-group">
        <div class="resource-group-title">
          <span>⚡ PRACTICE</span>
          <span style="font-size: 0.75rem; color: var(--text-muted);">Simulators · Solvers · Practice Problem Sets</span>
        </div>
        <div class="resource-grid">
          ${practiceGroup.length ? practiceGroup.map(renderCard).join('') : '<p style="color: var(--text-muted); font-size: 0.85rem;">No practice materials attached.</p>'}
        </div>
      </div>

      <!-- SUBMIT SECTION -->
      <div class="resource-group">
        <div class="resource-group-title">
          <span>📤 SUBMIT</span>
          <span style="font-size: 0.75rem; color: var(--text-muted);">Google Classroom · LMS · Department Dropbox</span>
        </div>
        <div class="resource-grid">
          ${submitGroup.length ? submitGroup.map(renderCard).join('') : '<p style="color: var(--text-muted); font-size: 0.85rem;">No submission portals attached.</p>'}
        </div>
      </div>

      ${otherGroup.length ? `
        <div class="resource-group">
          <div class="resource-group-title">
            <span>🔗 OTHER LINKS</span>
          </div>
          <div class="resource-grid">
            ${otherGroup.map(renderCard).join('')}
          </div>
        </div>
      ` : ''}
    `;

    // Add Resource Trigger
    container.querySelector('#btn-add-resource').addEventListener('click', () => {
      showAddResourceModal(render);
    });
    container.querySelectorAll('[data-study-resource]').forEach(link => link.addEventListener('click', () => {
      const resource = resources.find(r => r.id === link.dataset.studyResource);
      if (resource) {
        sessionStorage.setItem('axiom_target_subject_id', resource.subjectId);
        sessionStorage.setItem('axiom_target_resource_id', resource.id);
      }
    }));

    // Delete Resource
    container.querySelectorAll('[data-action="delete-resource"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-res-id');
        if (confirm("Remove this resource?")) {
          db.deleteResource(id);
          render();
        }
      });
    });
  }

  render();
}

function showAddResourceModal(onComplete) {
  const subjects = db.getSubjects();
  const topics = db.getTopics();

  const modalHtml = `
    <dialog class="modal" id="resource-modal">
      <div class="modal-header">
        <h3>Add Resource / External Link</h3>
        <button class="btn btn-ghost btn-sm" id="close-res-modal">✕</button>
      </div>
      <div class="modal-body">
        <form id="resource-form">
          <div class="form-group"><label class="form-label">Resource Type</label><select name="type" id="res-type-select"><option value="link">External Link</option><option value="youtube">YouTube Video</option><option value="pdf">PDF Link</option></select></div>
          <div class="form-group">
            <label class="form-label">Resource Title *</label>
            <input type="text" name="title" id="res-title-input" required placeholder="e.g. Falstad Circuit Simulator" />
          </div>

          <div class="form-group">
            <label class="form-label">URL *</label>
            <input type="url" name="url" id="res-url-input" required placeholder="https://..." />
            <div id="url-detected-domain" style="font-size: 0.75rem; color: var(--accent-primary); margin-top: 4px;"></div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Category</label>
              <select name="category">
                <option value="Lecture">Lecture Video</option>
                <option value="Module">Course Module</option>
                <option value="Practice">Practice Problems</option>
                <option value="Calculator">Calculator / Simulator</option>
                <option value="Submission">Submission Portal</option>
                <option value="Reference">Reference</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Subject</label>
              <select name="subjectId">
                <option value="">(None)</option>
                ${subjects.map(s => `<option value="${s.id}">${s.code} - ${s.name}</option>`).join('')}
              </select>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">Topic</label>
            <select name="topicId">
              <option value="">(None)</option>
              ${topics.map(t => `<option value="${t.id}">${t.name}</option>`).join('')}
            </select>
          </div>

          <div class="form-group">
            <label class="form-label">Description / Notes</label>
            <textarea name="description" rows="2" placeholder="Brief note on what this link contains..."></textarea>
          </div>
        </form>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" id="cancel-res-btn">Cancel</button>
        <button class="btn btn-primary" id="save-res-btn">Save Resource</button>
      </div>
    </dialog>
  `;

  const existing = document.getElementById('resource-modal');
  if (existing) existing.remove();

  document.body.insertAdjacentHTML('beforeend', modalHtml);
  const dialog = document.getElementById('resource-modal');
  dialog.showModal();

  const urlInput = dialog.querySelector('#res-url-input');
  const typeSelect = dialog.querySelector('#res-type-select');
  const titleInput = dialog.querySelector('#res-title-input');
  const domainHint = dialog.querySelector('#url-detected-domain');

  // Auto identify domain & attempt default title
  urlInput.addEventListener('input', () => {
    if (parseYouTubeUrl(urlInput.value)) typeSelect.value = 'youtube';
    try {
      const parsed = new URL(urlInput.value);
      domainHint.textContent = `Detected domain: ${parsed.hostname}`;
      if (!titleInput.value) {
        if (parsed.hostname.includes('youtube')) titleInput.value = 'YouTube Lecture';
        else if (parsed.hostname.includes('drive.google')) titleInput.value = 'Google Drive Document';
        else if (parsed.hostname.includes('classroom')) titleInput.value = 'Google Classroom Submission';
        else if (parsed.hostname.includes('falstad')) titleInput.value = 'Falstad Circuit Simulator';
        else if (parsed.hostname.includes('desmos')) titleInput.value = 'Desmos Graphing Tool';
      }
    } catch (e) {
      domainHint.textContent = '';
    }
  });

  const close = () => {
    dialog.close();
    dialog.remove();
  };

  dialog.querySelector('#close-res-modal').addEventListener('click', close);
  dialog.querySelector('#cancel-res-btn').addEventListener('click', close);
  dialog.querySelector('#save-res-btn').addEventListener('click', () => {
    const form = dialog.querySelector('#resource-form');
    const formData = new FormData(form);
    const title = formData.get('title');
    const url = formData.get('url');
    if (!title || !url) return;
    const type = formData.get('type') || 'link';
    const videoId = type === 'youtube' ? parseYouTubeUrl(url) : null;
    if (type === 'youtube' && !videoId) {
      domainHint.textContent = 'Enter a valid YouTube watch, short, or youtu.be link.';
      urlInput.focus();
      return;
    }
    if ((type === 'youtube' || type === 'pdf') && !formData.get('subjectId')) {
      domainHint.textContent = 'Choose a subject to use this resource in the Study Viewer.';
      return;
    }

    let domain = '';
    try {
      domain = new URL(url).hostname;
    } catch (e) {
      domain = 'external';
    }

    db.addResource({
      title,
      url,
      description: formData.get('description'),
      category: formData.get('category'),
      type,
      ...(videoId ? { videoId, youtubeUrl: url, lastPlaybackPosition: 0, lastStudiedAt: null } : {}),
      dateAdded: new Date().toISOString(),
      subjectId: formData.get('subjectId') || null,
      topicId: formData.get('topicId') || null,
      domain
    });

    close();
    if (onComplete) onComplete();
  });
}
