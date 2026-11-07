import { db } from './db.js';
import { cloudSync } from './cloudSync.js';

export const studentFields = [
  { key: 'name', label: 'Name', placeholder: 'Your name', autocomplete: 'name' },
  { key: 'section', label: 'Section', placeholder: 'ECE 2A' },
  { key: 'major', label: 'Course / Program', placeholder: 'BS Electronics Engineering' }
];

export function profileComplete(profile = db.getUserProfile()) {
  return !profile?.setupPending && studentFields.every(({ key }) => typeof profile?.[key] === 'string' && profile[key].trim());
}

export function validateStudentDetails(form) {
  let firstInvalid;
  const details = {};
  for (const { key, label } of studentFields) {
    const input = form.elements.namedItem(key);
    details[key] = input.value.trim();
    const message = details[key] ? '' : `Enter your ${label.toLowerCase()}.`;
    input.setCustomValidity(message);
    input.setAttribute('aria-invalid', String(Boolean(message)));
    const error = form.querySelector(`[data-error="${key}"]`);
    if (error) error.textContent = message;
    if (message && !firstInvalid) firstInvalid = input;
  }
  if (firstInvalid) { firstInvalid.focus(); return null; }
  return details;
}

// Keep the existing workspace and anonymous UID. Names are display labels only.
export async function saveStudentDetails(details, { setup = false, updates = {} } = {}) {
  const previous = { ...db.getUserProfile() };
  db.updateUserProfile({ ...updates, ...details, ...(setup ? { setupPending: true } : {}) });
  if (db.lastSaveError) {
    db.data.userProfile = previous;
    throw new Error('Could not save in this browser. Free some browser storage and retry. Your entries are still here.');
  }
  await cloudSync.retry();
  if (!['saved', 'setup'].includes(cloudSync.status)) {
    throw new Error('Could not sync your profile. Check your connection and retry. Your entries are kept in this browser.');
  }
  if (setup) {
    db.updateUserProfile({ setupPending: false });
    if (db.lastSaveError) {
      db.data.userProfile.setupPending = true;
      throw new Error('Could not finish saving in this browser. Your entries are still here. Please retry.');
    }
  }
}
