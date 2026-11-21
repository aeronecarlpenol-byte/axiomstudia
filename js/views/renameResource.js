import { db } from '../db.js';

export function showRenameResourceModal(resource, onComplete) {
  const dialog = document.createElement('dialog');
  dialog.className = 'modal';
  dialog.setAttribute('aria-labelledby', 'subject-resource-heading');
  dialog.innerHTML = `
    <form>
      <div class="modal-header"><h3 id="subject-resource-heading">Rename Resource</h3></div>
      <div class="modal-body">
        <label class="form-group">Resource name<input name="title" required autofocus></label>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary">Cancel</button>
        <button type="submit" class="btn btn-primary">Save Name</button>
      </div>
    </form>`;
  document.body.append(dialog);
  const form = dialog.querySelector('form');
  const title = form.elements.namedItem('title');
  title.value = resource.title || '';
  title.addEventListener('input', () => title.setCustomValidity(''));
  dialog.addEventListener('close', () => dialog.remove());
  form.querySelector('button[type="button"]').addEventListener('click', () => dialog.close());
  form.addEventListener('submit', event => {
    event.preventDefault();
    const name = title.value.trim();
    if (!name) {
      title.setCustomValidity('Enter a resource name.');
      title.reportValidity();
      return;
    }
    db.updateResource(resource.id, { title: name });
    dialog.close();
    onComplete();
  });
  dialog.showModal();
}

