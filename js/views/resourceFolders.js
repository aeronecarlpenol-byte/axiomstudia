import { db } from '../db.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function folderOptions(subjectId, selectedId = '') {
  return '<option value="">No folder</option>' + db.getResourceFolders()
    .filter(folder => (folder.subjectId || '') === (subjectId || ''))
    .map(folder => `<option value="${escape(folder.id)}" ${folder.id === selectedId ? 'selected' : ''}>${escape(folder.title)}</option>`).join('');
}

export function showFolderModal(onComplete, subjectId = '', folder = null) {
  const dialog = document.createElement('dialog');
  dialog.className = 'modal';
  dialog.setAttribute('aria-labelledby', 'resource-folder-heading');
  dialog.innerHTML = `<form>
    <div class="modal-header"><h3 id="resource-folder-heading">${folder ? 'Rename Folder' : 'New Folder'}</h3></div>
    <div class="modal-body">
      <div class="form-group"><label for="resource-folder-name" class="form-label">Folder name</label><input id="resource-folder-name" name="title" required maxlength="120" autofocus></div>
      ${folder ? '' : `<div class="form-group"><label for="resource-folder-subject" class="form-label">Subject</label><select id="resource-folder-subject" name="subjectId"><option value="">Uncategorized</option>${db.getSubjects().map(subject => `<option value="${escape(subject.id)}" ${subject.id === subjectId ? 'selected' : ''}>${escape(subject.name)}</option>`).join('')}</select></div>`}
    </div>
    <div class="modal-footer"><button type="button" class="btn btn-secondary">Cancel</button><button type="submit" class="btn btn-primary">${folder ? 'Save Name' : 'Create Folder'}</button></div>
  </form>`;
  const form = dialog.querySelector('form');
  const input = form.elements.title;
  input.value = folder?.title || '';
  input.addEventListener('input', () => input.setCustomValidity(''));
  dialog.querySelector('[type="button"]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => dialog.remove());
  form.addEventListener('submit', event => {
    event.preventDefault();
    const title = input.value.trim();
    if (!title) { input.setCustomValidity('Enter a folder name.'); input.reportValidity(); return; }
    if (folder) db.renameResourceFolder(folder.id, title);
    else db.addResourceFolder(title, form.elements.subjectId.value || null);
    dialog.close();
    onComplete();
  });
  document.body.append(dialog);
  dialog.showModal();
}
