import { showRenameResourceModal } from './renameResource.js';
import { folderOptions, showFolderModal } from './resourceFolders.js';
/** Axiom Studia - subject-organized resource library. */
import { db } from '../db.js';
import { parseYouTubeResource } from '../youtube.js';
import { savePdfToStorage } from '../pdfStorage.js';

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const uncategorized = '__uncategorized__';

export function renderResources(container) {
  let subjectFilter = '';
  let search = '';
  let term = db.getAcademicPeriod().semester || '1st Semester';
  const collapsed = new Set();
  const collapsedFolders = new Set();

  function render() {
    const resources = db.getResources().filter(resource => {
      const subject = db.getSubjectById(resource.subjectId);
      const resourceTerm = resource.academicPeriod?.semester || subject?.academicPeriod?.semester || db.getAcademicPeriod().semester;
      return !term || resourceTerm === term || (!resource.subjectId && !resource.academicPeriod);
    });
    const folders = db.getResourceFolders();
    const subjects = db.getSubjectsForPeriod({ semester: term, schoolYear: db.getAcademicPeriod().schoolYear });
    const subjectIds = new Set(subjects.map(s => s.id));
    const groupId = resource => subjectIds.has(resource.subjectId) ? resource.subjectId : uncategorized;
    const groups = [...subjects, { id: uncategorized, name: 'Uncategorized', code: '' }];
    const renderCard = res => {
      const parsed = parseYouTubeResource(res.url || res.youtubeUrl || '');
      const isPlaylist = ['playlist', 'youtube_playlist'].includes(res.type) || res.playlistId || parsed?.playlistId;
      const icon = isPlaylist ? '\u2637' : res.type === 'pdf' ? '\u{1f4c4}' : ['youtube', 'youtube_video', 'video'].includes(res.type) || parsed ? '\u25b6' : res.type === 'textbook' ? '\u{1f4d6}' : res.category === 'Calculator' ? '\u{1f9ee}' : '\u{1f517}';
      const typeLabel = isPlaylist ? 'YouTube playlist' : res.type === 'pdf' ? 'PDF' : parsed || ['youtube', 'youtube_video'].includes(res.type) ? 'YouTube video' : res.type || 'Link';
      const assigned = subjectIds.has(res.subjectId);
      const canStudy = ['pdf', 'image'].includes(res.type) || ['youtube', 'playlist', 'youtube_video', 'youtube_playlist'].includes(res.type) || parsed;
      const top = db.getTopicById(res.topicId);
      return `<article class="resource-card">
        <div class="resource-card-header">
          <span class="resource-icon" title="${escapeHtml(typeLabel)}" aria-label="${escapeHtml(typeLabel)}">${icon}</span>
          <div class="library-card-copy"><h3>${escapeHtml(res.title || 'Untitled resource')}</h3>
            <p class="library-meta">${escapeHtml(typeLabel)} \xb7 ${escapeHtml(res.category || 'Study Material')}</p>
          </div>
        </div>
        ${res.description ? `<p class="library-description">${escapeHtml(res.description)}</p>` : ''}
        <p class="library-meta">${escapeHtml(res.pdfFileName || res.domain || '')}${top ? ` \xb7 ${escapeHtml(top.name)}` : ''}</p>
        <div class="library-card-actions">
          ${canStudy ? `<button class="btn btn-secondary btn-sm" data-study-resource="${escapeHtml(res.id)}">${assigned ? 'Open in Study Viewer' : 'Assign & open'}</button>` : res.url ? `<a href="${escapeHtml(/^(https?:)/i.test(res.url) ? res.url : '#')}" target="_blank" rel="noopener noreferrer" class="btn-open-link">OPEN \u2197</a>` : '<span class="library-meta">No link attached</span>'}
          <button class="btn btn-ghost btn-sm" data-action="rename-resource" data-res-id="${escapeHtml(res.id)}">Rename</button>
          <button class="btn btn-ghost btn-sm" data-action="move-resource" data-res-id="${escapeHtml(res.id)}">Move</button>
          <button class="btn btn-ghost btn-sm library-delete" data-action="delete-resource" data-res-id="${escapeHtml(res.id)}">Delete</button>
        </div>
      </article>`;
    };

    container.innerHTML = `<div class="tasks-toolbar">
      <div><h2>Resources & Study Materials</h2></div>
      <div class="library-card-actions"><button type="button" class="btn btn-secondary" id="btn-add-folder">+ New Folder</button><button class="btn btn-primary" id="btn-add-resource">+ Add Resource / Link</button></div>
    </div>
    <div class="library-toolbar">
      <div><label class="form-label" for="resource-search">Search library</label><input id="resource-search" type="search" placeholder="Search subjects, titles, or notes\u2026" value="${escapeHtml(search)}"></div>
      <div><label class="form-label" for="resource-term-filter">Term</label><select id="resource-term-filter"><option value="1st Semester" ${term === '1st Semester' ? 'selected' : ''}>1st Term</option><option value="2nd Semester" ${term === '2nd Semester' ? 'selected' : ''}>2nd Term</option></select></div>
      <div><label class="form-label" for="resource-subject-filter">Subject</label><select id="resource-subject-filter"><option value="">All Subjects</option>${groups.map(s => `<option value="${escapeHtml(s.id)}" ${subjectFilter === s.id ? 'selected' : ''}>${escapeHtml(s.name)} (${resources.filter(r => groupId(r) === s.id).length})</option>`).join('')}</select></div>
    </div>
    <div id="resource-library"></div>`;

    function renderGroups() {
      const query = search.trim().toLocaleLowerCase();
      let shown = 0;
      container.querySelector('#resource-library').innerHTML = groups.filter(s => !subjectFilter || s.id === subjectFilter).map(subject => {
        const all = resources.filter(r => groupId(r) === subject.id);
        const subjectMatches = `${subject.name} ${subject.code}`.toLocaleLowerCase().includes(query);
        const subjectFolders = folders.filter(folder => groupId(folder) === subject.id);
        const matches = all.filter(r => !query || subjectMatches || [r.title, r.description, r.category, r.type, r.url, r.domain, r.pdfFileName, db.getTopicById(r.topicId)?.name, subjectFolders.find(folder => folder.id === r.folderId)?.title].join(' ').toLocaleLowerCase().includes(query));
        const visibleFolders = subjectFolders.filter(folder => !query || subjectMatches || folder.title.toLocaleLowerCase().includes(query) || matches.some(r => r.folderId === folder.id));
        const loose = matches.filter(r => !subjectFolders.some(folder => folder.id === r.folderId));
        if (query && !subjectMatches && !matches.length && !visibleFolders.length) return '';
        shown++;
        return `<details class="resource-group library-subject" data-subject-group="${escapeHtml(subject.id)}" ${query || !collapsed.has(subject.id) ? 'open' : ''}>
          <summary><h3>${escapeHtml(subject.name)}</h3><span class="library-count">${query ? `${matches.length} of ` : ''}${all.length} resource${all.length === 1 ? '' : 's'}</span><span class="library-chevron" aria-hidden="true">\u2304</span></summary>
          ${visibleFolders.map(folder => {
            const contents = matches.filter(r => r.folderId === folder.id);
            const count = all.filter(r => r.folderId === folder.id).length;
            return `<details class="library-folder" data-folder-id="${escapeHtml(folder.id)}" ${query || !collapsedFolders.has(folder.id) ? 'open' : ''}>
              <summary><span aria-hidden="true">📁</span><h4>${escapeHtml(folder.title)}</h4><span class="library-count">${count} resource${count === 1 ? '' : 's'}</span><span class="library-chevron" aria-hidden="true">⌄</span></summary>
              <div class="library-card-actions library-folder-actions"><button type="button" class="btn btn-ghost btn-sm" data-rename-folder="${escapeHtml(folder.id)}">Rename Folder</button><button type="button" class="btn btn-ghost btn-sm" data-delete-folder="${escapeHtml(folder.id)}">Remove Folder</button></div>
              <div class="resource-grid">${contents.length ? contents.map(renderCard).join('') : '<p class="library-empty">This folder is empty. Use Move on a resource to put it here.</p>'}</div>
            </details>`;
          }).join('')}
          <div class="resource-grid">${loose.map(renderCard).join('')}${!all.length && !subjectFolders.length ? '<p class="library-empty">No resources yet.</p>' : ''}</div>
        </details>`;
      }).join('');
      if (!shown) container.querySelector('#resource-library').innerHTML = '<p class="library-empty" role="status">No subjects or resources match your search.</p>';
      container.querySelectorAll('[data-folder-id]').forEach(section => section.addEventListener('toggle', () => {
        if (query) return;
        if (section.open) collapsedFolders.delete(section.dataset.folderId);
        else collapsedFolders.add(section.dataset.folderId);
      }));
      container.querySelectorAll('[data-rename-folder]').forEach(button => button.addEventListener('click', () => {
        showFolderModal(render, '', folders.find(folder => folder.id === button.dataset.renameFolder));
      }));
      container.querySelectorAll('[data-delete-folder]').forEach(button => button.addEventListener('click', () => {
        db.deleteResourceFolder(button.dataset.deleteFolder);
        render();
        window.showToast?.('Folder removed. Its resources are still in your library.');
      }));
      container.querySelectorAll('[data-subject-group]').forEach(section => section.addEventListener('toggle', () => {
        if (query) return;
        if (section.open) collapsed.delete(section.dataset.subjectGroup);
        else collapsed.add(section.dataset.subjectGroup);
      }));
      container.querySelectorAll('[data-study-resource]').forEach(button => button.addEventListener('click', () => {
        const resource = resources.find(r => r.id === button.dataset.studyResource);
        const open = () => {
          sessionStorage.setItem('axiom_target_subject_id', resource.subjectId);
          sessionStorage.setItem('axiom_target_resource_id', resource.id);
          window.location.hash = 'subjects';
        };
        if (subjectIds.has(resource.subjectId)) open();
        else showMoveResourceModal(resource, () => {
          resource.subjectId = db.getResources().find(r => r.id === resource.id).subjectId;
          if (db.getSubjectById(resource.subjectId)) open();
          else render();
        });
      }));
      container.querySelectorAll('[data-action="rename-resource"]').forEach(button => button.addEventListener('click', () => {
        showRenameResourceModal(resources.find(r => r.id === button.dataset.resId), render);
      }));
      container.querySelectorAll('[data-action="move-resource"]').forEach(button => button.addEventListener('click', () => {
        showMoveResourceModal(resources.find(r => r.id === button.dataset.resId), render);
      }));
      container.querySelectorAll('[data-action="delete-resource"]').forEach(button => button.addEventListener('click', () => {
        if (confirm('Remove this resource?')) { db.deleteResource(button.dataset.resId); render(); }
      }));
    }
    renderGroups();
    container.querySelector('#resource-search').addEventListener('input', event => { search = event.target.value; renderGroups(); });
    container.querySelector('#resource-term-filter').addEventListener('change', event => {
      term = event.target.value;
      db.updateUserProfile({ semester: term, term: '' });
      render();
    });
    container.querySelector('#resource-subject-filter').addEventListener('change', event => { subjectFilter = event.target.value; renderGroups(); });
    container.querySelector('#btn-add-folder').addEventListener('click', () => showFolderModal(() => {
      search = ''; subjectFilter = ''; render();
    }, subjectFilter === uncategorized ? '' : subjectFilter));
    container.querySelector('#btn-add-resource').addEventListener('click', () => showAddResourceModal(() => {
      subjectFilter = ''; search = ''; collapsed.clear(); render();
    }, subjectFilter === uncategorized ? '' : subjectFilter));
  }
  render();
}

function showMoveResourceModal(resource, onComplete) {
  const subjects = db.getSubjects();
  document.getElementById('move-resource-modal')?.remove();
  document.body.insertAdjacentHTML('beforeend', `<dialog class="modal" id="move-resource-modal" aria-labelledby="move-resource-title">
    <div class="modal-header"><h3 id="move-resource-title">Move resource</h3></div>
    <form class="modal-body" id="move-resource-form"><p>${escapeHtml(resource.title)}</p>
      <div class="form-group"><label class="form-label" for="move-resource-subject">Subject</label><select id="move-resource-subject" name="subjectId">
        <option value="">Uncategorized</option>${subjects.map(s => `<option value="${escapeHtml(s.id)}" ${s.id === resource.subjectId ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
      </select></div>
      <div class="form-group"><label class="form-label" for="move-resource-folder">Folder</label><select id="move-resource-folder" name="folderId"></select></div>
    </form><div class="modal-footer"><button class="btn btn-secondary" id="cancel-move-resource">Cancel</button><button class="btn btn-primary" type="submit" form="move-resource-form">Move Resource</button></div>
  </dialog>`);
  const dialog = document.getElementById('move-resource-modal');
  const subjectSelect = dialog.querySelector('[name="subjectId"]');
  const folderSelect = dialog.querySelector('[name="folderId"]');
  const updateFolders = () => { folderSelect.innerHTML = folderOptions(subjectSelect.value, resource.folderId); };
  subjectSelect.addEventListener('change', updateFolders);
  updateFolders();
  const close = () => { dialog.close(); dialog.remove(); };
  dialog.querySelector('#cancel-move-resource').addEventListener('click', close);
  dialog.querySelector('form').addEventListener('submit', event => {
    event.preventDefault();
    const subjectId = subjectSelect.value || null;
    if (subjectId && !db.getSubjectById(subjectId)) return;
    // Update only assignment; retain the ID, PDF storage key, and playback metadata.
    db.updateResource(resource.id, { subjectId, folderId: folderSelect.value || null, ...(resource.topicId && db.getTopicById(resource.topicId)?.subjectId !== subjectId ? { topicId: null } : {}) });
    close(); onComplete();
  });
  dialog.showModal();
}

function showAddResourceModal(onComplete, selectedSubjectId = '') {
  const subjects = db.getSubjects();
  const topics = db.getTopics();

  const modalHtml = `
    <dialog class="modal" id="resource-modal">
      <div class="modal-header">
        <h3>Add Resource / External Link</h3>
        <button class="btn btn-ghost btn-sm" id="close-res-modal">\u2715</button>
      </div>
      <div class="modal-body">
        <form id="resource-form">${!subjects.length ? '<p>Add a subject in Grades before adding resources.</p>' : ''}
          <div class="form-group"><label class="form-label">Resource Type</label><select name="type" id="res-type-select"><option value="link">External Link</option><option value="youtube">YouTube Video</option><option value="playlist">YouTube Playlist</option><option value="pdf">PDF File / Link</option><option value="module">Module</option><option value="notes">Notes</option><option value="drive">Google Drive</option><option value="video">Other Video</option><option value="reviewer">Reviewer</option><option value="textbook">Textbook</option><option value="reference">Reference</option><option value="other">Other Material</option></select></div>
          <div class="form-group">
            <label class="form-label">Resource Title *</label>
            <input type="text" name="title" id="res-title-input" required />
          </div>

          <div class="form-group">
            <label class="form-label">URL *</label>
            <input type="url" name="url" id="res-url-input" required placeholder="https://..." />
            <div id="url-detected-domain" style="font-size: 0.75rem; color: var(--accent-primary); margin-top: 4px;"></div>
          </div>

          <div class="form-group" id="library-pdf-upload" hidden><label class="form-label" for="res-pdf-file">Upload PDF</label><input type="file" id="res-pdf-file" accept="application/pdf,.pdf"></div>
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
              <label class="form-label" for="res-subject">Subject *</label>
              <select name="subjectId" id="res-subject" required>
                <option value="">Choose a subject</option>
                ${subjects.map(s => `<option value="${escapeHtml(s.id)}" ${s.id === selectedSubjectId ? 'selected' : ''}>${escapeHtml(s.code)} - ${escapeHtml(s.name)}</option>`).join('')}
              </select>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label" for="res-folder">Folder</label>
            <select name="folderId" id="res-folder"><option value="">No folder</option></select>
          </div>
          <div class="form-group">
            <label class="form-label">Topic</label>
            <select name="topicId">
              <option value="">(None)</option>

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
        <button class="btn btn-primary" id="save-res-btn" type="submit" form="resource-form" ${!subjects.length ? 'disabled' : ''}>Save Resource</button>
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

  const form = dialog.querySelector('#resource-form');
  const subjectSelect = form.elements.subjectId;
  const topicSelect = form.elements.topicId;
  const pdfInput = dialog.querySelector('#res-pdf-file');
  const updateTopics = () => {
    form.elements.folderId.innerHTML = folderOptions(subjectSelect.value);
    topicSelect.innerHTML = '<option value="">(None)</option>' + topics.filter(t => t.subjectId === subjectSelect.value).map(t => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)}</option>`).join('');
  };
  subjectSelect.addEventListener('change', updateTopics);
  updateTopics();
  const updateType = () => {
    const isPdf = typeSelect.value === 'pdf';
    dialog.querySelector('#library-pdf-upload').hidden = !isPdf;
    urlInput.required = !(isPdf && pdfInput.files.length);
    urlInput.closest('.form-group').querySelector('label').textContent = urlInput.required ? 'URL *' : 'URL (optional with uploaded PDF)';
  };
  typeSelect.addEventListener('change', updateType);
  pdfInput.addEventListener('change', updateType);
  updateType();

  // Auto identify domain & attempt default title
  urlInput.addEventListener('input', () => {
    if (parseYouTubeResource(urlInput.value)) typeSelect.value = parseYouTubeResource(urlInput.value).playlistId ? 'playlist' : 'youtube';
    updateType();
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
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity() || dialog.querySelector('#save-res-btn').disabled) return;
    const formData = new FormData(form);
    const title = formData.get('title').trim();
    const url = formData.get('url').trim();
    if (!title || !db.getSubjectById(formData.get('subjectId'))) return;
    const type = formData.get('type') || 'link';
    const parsed = parseYouTubeResource(url);
    const videoId = parsed?.videoId;
    if (['youtube', 'playlist'].includes(type) && !parsed) {
      domainHint.textContent = 'Enter a valid YouTube video or playlist URL.';
      urlInput.focus();
      return;
    }

    let domain = '';
    try {
      domain = new URL(url).hostname;
    } catch (e) {
      domain = 'external';
    }

    const saveButton = dialog.querySelector('#save-res-btn');
    saveButton.disabled = true;
    const file = type === 'pdf' ? pdfInput.files[0] : null;
    const resourceData = {
      title,
      url,
      description: formData.get('description'),
      category: formData.get('category'),
      type,
      ...(parsed || {}),
      ...(videoId ? { videoId, youtubeUrl: url, lastPlaybackPosition: 0, lastStudiedAt: null } : {}),
      dateAdded: new Date().toISOString(),
      subjectId: formData.get('subjectId') || null,
      folderId: formData.get('folderId') || null,
      topicId: formData.get('topicId') || null,
      domain
    };
    const created = db.addResource(resourceData);
    if (file) {
      const saved = await savePdfToStorage(created.id, file, file.name);
      if (!saved) {
        db.deleteResource(created.id);
        domainHint.textContent = 'Could not save the PDF. Please try again; the resource has not been added.';
        saveButton.disabled = false;
        return;
      }
      db.updateResource(created.id, { hasPdfFile: true, pdfFileName: file.name });
    }

    close();
    if (onComplete) onComplete();
  });
}
