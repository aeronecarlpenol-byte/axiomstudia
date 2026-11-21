import { mergeWorkspaces } from './workspaceMerge.js';
import { db } from './db.js';
import { cloudConfigured, getCloudClients } from './cloudClient.js';

const META_KEY = 'axiom-cloud-sync-v1';
const LOCAL_KEY = 'axiom_studia_database_v16';
const BASE_KEY = 'axiom-cloud-base-v1';
function workspaceJSON(value) {
  // Postgres JSONB reorders object keys; equality must ignore that ordering.
  return JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
}
async function fingerprint(snapshot) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(snapshot));
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}
export class CloudSync {
  constructor(database = db, storage = localStorage, clientFactory = getCloudClients) {
    this.db = database;
    this.storage = storage;
    this.clientFactory = clientFactory;
    this.listeners = new Set();
    this.hydration = 0;
    this.status = cloudConfigured() ? 'saving' : 'setup';
    this.message = '';
    this.meta = this.db.cloudState || this.readMeta();
    this.db.beforeSave = () => {
      if (!this.applying) this.meta.pending = true;
      this.db.cloudState = { ...this.meta };
    };
    this.db.subscribe(() => {
      if (this.applying) return;
      this.meta.pending = true;
      try { this.writeMeta(); } catch { this.setStatus('retry', 'Browser storage is full. Keep this tab open and retry.'); }
      this.setStatus(this.db.lastSaveError ? 'retry' : (cloudConfigured() ? 'saving' : 'setup'));
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.retry(), 650);
    });
  }
  readMeta() {
    try { return JSON.parse(this.storage.getItem(META_KEY)) || { revision: 0, pending: true }; }
    catch { return { revision: 0, pending: true }; }
  }
  rememberBase(payload, revision) {
    this.base = { uid: this.meta.uid, revision, payload: JSON.parse(workspaceJSON(payload)) };
    try { this.storage.setItem(BASE_KEY, JSON.stringify(this.base)); } catch { /* In-memory merging remains available. */ }
  }
  loadBase() {
    let base = this.base;
    if (!base) {
      try { base = JSON.parse(this.storage.getItem(BASE_KEY)); } catch { return null; }
    }
    return base?.uid === this.meta.uid && base.revision === this.meta.revision ? base.payload : null;
  }
  async resolveConflict(prefer) {
    const conflict = this.conflict;
    if (!conflict) return;
    // Save both originals before applying a choice. Failed backup writes stop resolution.
    this.storage.setItem('axiom-cloud-recovery-' + Date.now(), JSON.stringify({
      uid: this.meta.uid, local: this.db.data, remote: conflict.remote, savedAt: new Date().toISOString()
    }));
    const value = conflict.base ? mergeWorkspaces(conflict.base, this.db.data, conflict.remote.payload, prefer).value
      : prefer === 'remote' ? conflict.remote.payload : this.db.data;
    this.meta.revision = conflict.remote.revision;
    this.rememberBase(conflict.remote.payload, conflict.remote.revision);
    this.applyMerged(value);
    this.conflict = null;
    await this.retry();
  }
  applyMerged(value) {
    this.meta.pending = true;
    delete this.meta.upload;
    this.applying = true;
    try {
      this.db.data = JSON.parse(workspaceJSON(value));
      this.db.save();
      this.hydration++;
    } finally { this.applying = false; }
    if (this.db.lastSaveError) throw new Error('Could not keep the merged work in browser storage. Free storage and retry.');
    this.writeMeta();
    this.setStatus('saving');
  }
  writeMeta() { this.storage.setItem(META_KEY, JSON.stringify(this.meta)); }
  adoptSavedWorkspace() {
    if (this.meta.pending) return;
    let stored;
    try { stored = JSON.parse(this.storage.getItem(LOCAL_KEY)); } catch { return; }
    const nextMeta = stored?.__axiomCloud;
    if (!nextMeta || nextMeta.pending || nextMeta.revision < this.meta.revision ||
        (this.meta.uid && this.meta.uid !== nextMeta.uid)) return;

    delete stored.__axiomCloud;
    this.meta = { ...nextMeta };
    this.rememberBase(stored, nextMeta.revision);
    this.db.cloudState = { ...nextMeta };
    if (workspaceJSON(stored) === workspaceJSON(this.db.data)) return;

    this.applying = true;
    try {
      this.db.data = stored;
      this.hydration++;
      this.db.notify();
    } finally { this.applying = false; }
    this.setStatus('saved');
  }
  checkpoint() {
    // Do not overwrite another tab's newer durable outbox while acknowledging
    // this tab's request. Its own embedded base revision remains authoritative.
    const stored = this.storage.getItem(LOCAL_KEY);
    if (stored) {
      const payload = JSON.parse(stored);
      delete payload.__axiomCloud;
      if (workspaceJSON(payload) !== workspaceJSON(this.db.data)) return;
    }
    this.applying = true;
    try { this.db.save(); } finally { this.applying = false; }
    if (this.db.lastSaveError) throw new Error('Cloud saved, but browser recovery storage is unavailable. Keep this tab open and retry.');
  }
  subscribe(listener) { this.listeners.add(listener); listener(this); return () => this.listeners.delete(listener); }
  setStatus(status, message = '') {
    this.status = status; this.message = message;
    this.listeners.forEach(listener => listener(this));
  }
  async identity(client) {
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    let session = data.session;
    const durable = this.readMeta();
    if (!this.meta.uid && durable.uid) this.meta.uid = durable.uid;
    if (!session) {
      // Never silently replace a previously assigned identity after token loss.
      if (this.meta.uid) throw new Error('The anonymous session is unavailable. This browser still holds your work; its cloud identity cannot be replaced automatically.');
      const result = await client.auth.signInAnonymously();
      if (result.error) throw result.error;
      session = result.data.session;
    }
    if (!session?.user?.is_anonymous) throw new Error('An anonymous visitor session is required.');
    if (this.meta.uid && this.meta.uid !== session.user.id) throw new Error('Workspace identity mismatch. Your local work has been kept.');
    this.meta.uid = session.user.id;
    this.writeMeta();
    return session.user.id;
  }
  async retry() {
    if (!cloudConfigured()) { this.setStatus('setup'); return; }
    if (this.running) { this.again = true; return this.running; }
    const run = () => this.sync();
    this.running = (globalThis.navigator?.locks
      ? navigator.locks.request('axiom-cloud-workspace', run) : run())
      .catch(error => {
        this.setStatus('retry', error.message || 'Connection failed. Your changes are waiting in this browser.');
        clearTimeout(this.retryTimer);
        this.retryTimer = setTimeout(() => this.retry(), 30000);
      }).finally(() => {
        this.running = null;
        if (this.again) { this.again = false; this.retry(); }
      });
    return this.running;
  }
  async sync() {
    this.adoptSavedWorkspace();
    this.setStatus('saving');
    // Keep this tab's base revision. Adopting another tab's newer revision would
    // allow a stale local snapshot to overwrite that tab's changes.
    const { visitor } = await this.clientFactory();
    const uid = await this.identity(visitor);
    const beforeRead = workspaceJSON(this.db.data);
    const { data: remote, error } = await visitor.from('workspaces').select('payload, revision').eq('user_id', uid).maybeSingle();
    if (error) throw error;
    // A request may commit but lose its response while more edits are queued.
    // Recognize its exact payload and advance the base without losing those edits.
    if (remote && this.meta.upload && remote.revision === this.meta.upload.revision + 1
      && await fingerprint(workspaceJSON(remote.payload)) === this.meta.upload.hash) {
      this.meta.revision = remote.revision;
      delete this.meta.upload;
      this.writeMeta();
    }
    if (remote && !this.meta.pending && beforeRead === workspaceJSON(this.db.data)) {
      if (beforeRead !== workspaceJSON(remote.payload)) {
        this.applying = true;
        try { this.db.data = JSON.parse(JSON.stringify(remote.payload)); this.db.save(); this.hydration++; }
        finally { this.applying = false; }
      }
      if (this.db.lastSaveError) throw new Error('Cloud data loaded, but this browser could not keep a local recovery copy. Free browser storage and retry.');
      this.meta.revision = remote.revision;
      this.rememberBase(remote.payload, remote.revision);
      // A profile migration may remove retired fields while hydrating. Queue
      // that sanitized snapshot against the revision just read, without merging
      // entities or assigning a new owner.
      this.meta.pending = workspaceJSON(this.db.data) !== workspaceJSON(remote.payload);
      this.writeMeta();
      if (this.meta.pending) { this.again = true; return; }
    } else {
      // Whole-workspace compare-and-swap preserves IDs and prevents duplicate migration.
      // A stale tab must never overwrite a newer cloud revision.
      const snapshot = workspaceJSON(this.db.data);
      const expected = this.meta.revision || 0;
      if (remote && (remote.revision !== expected || workspaceJSON(remote.payload) === snapshot)) {
        if (workspaceJSON(remote.payload) !== snapshot) {
          const base = this.loadBase();
          if (base) {
            const merged = mergeWorkspaces(base, this.db.data, remote.payload);
            if (!merged.conflicts) {
              this.meta.revision = remote.revision;
              this.rememberBase(remote.payload, remote.revision);
              this.applyMerged(merged.value);
              this.again = true;
              return;
            }
          }
          this.conflict = { base, remote };
          this.setStatus('conflict', 'Changes were saved in two places. Review the versions to finish syncing.');
          return;
        }
        this.meta.revision = remote.revision;
        this.rememberBase(remote.payload, remote.revision);
      } else {
        this.meta.upload = { revision: expected, hash: await fingerprint(snapshot) };
        this.writeMeta();
        const result = await visitor.rpc('save_workspace', { document: JSON.parse(snapshot), expected_revision: expected });
        if (result.error) throw result.error;
        this.meta.revision = Number(result.data);
        this.rememberBase(JSON.parse(snapshot), this.meta.revision);
      }
      delete this.meta.upload;
      // Changes made during the request remain pending, including after a tab closes.
      this.meta.pending = workspaceJSON(this.db.data) !== snapshot;
      this.writeMeta();
      if (this.meta.pending) { this.again = true; return; }
    }
    // Heartbeats are server-throttled and contain no browsing history.
    const activity = await visitor.rpc('touch_visitor');
    if (activity.error) throw activity.error;
    this.conflict = null;
    this.checkpoint();
    this.setStatus('saved');
  }
}

export const cloudSync = new CloudSync();

export function mountCloudStatus(parent) {
  const element = document.createElement('div');
  element.className = 'cloud-status';
  element.innerHTML = '<span role="status" aria-live="polite"></span> <button class="btn btn-ghost btn-sm" type="button" hidden>Retry</button><small style="display:block;max-width:420px" hidden></small>';
  parent.append(element);
  element.querySelector('button').onclick = () => cloudSync.status === 'conflict' ? reviewCloudConflict() : cloudSync.retry();
  return cloudSync.subscribe(sync => {
    const labels = { setup: 'Cloud setup pending · work kept in this browser', saving: 'Saving…', saved: 'Saved to cloud', retry: 'Changes waiting · retry', conflict: 'Sync needs review' };
    element.querySelector('button').textContent = sync.status === 'conflict' ? 'Review changes' : 'Retry';
    element.querySelector('span').textContent = labels[sync.status];
    element.title = sync.message;
    element.querySelector('small').textContent = sync.message;
    element.querySelector('small').hidden = !sync.message;
    element.querySelector('button').hidden = !['retry', 'conflict'].includes(sync.status);
  });
}

function reviewCloudConflict() {
  if (!cloudSync.conflict || document.getElementById('cloud-conflict-dialog')) return;
  const dialog = document.createElement('dialog');
  dialog.id = 'cloud-conflict-dialog';
  dialog.className = 'modal';
  dialog.setAttribute('aria-labelledby', 'cloud-conflict-title');
  dialog.innerHTML = '<div class="modal-header"><h3 id="cloud-conflict-title">Review sync changes</h3></div><div class="modal-body"><p>Choose which version to use for conflicting edits. A recovery copy of both versions will be saved in this browser.</p><p data-conflict-detail></p><p role="alert"></p></div><div class="modal-footer"><button class="btn btn-secondary" data-choice="local">Use this browser’s edits</button><button class="btn btn-secondary" data-choice="remote">Use cloud edits</button><button class="btn btn-ghost" data-cancel>Cancel</button></div>';
  dialog.querySelector('[data-conflict-detail]').textContent = cloudSync.conflict.base
    ? 'Independent edits will be combined. Your choice applies to overlapping changes.'
    : 'The original shared version is unavailable. Your choice will become the active workspace.';
  dialog.querySelector('[data-cancel]').onclick = () => dialog.close();
  dialog.addEventListener('close', () => dialog.remove());
  for (const button of dialog.querySelectorAll('[data-choice]')) button.onclick = async () => {
    dialog.querySelectorAll('button').forEach(item => { item.disabled = true; });
    try { await cloudSync.resolveConflict(button.dataset.choice); dialog.close(); }
    catch (error) {
      dialog.querySelector('[role="alert"]').textContent = error.message;
      dialog.querySelectorAll('button').forEach(item => { item.disabled = false; });
    }
  };
  document.body.append(dialog);
  dialog.showModal();
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => cloudSync.retry());
  window.addEventListener('storage', event => {
    if (event.key !== LOCAL_KEY || !event.newValue || cloudSync.meta.pending) return;
    // The other tab may be publishing a checkpoint. Adopt it without reloading
    // this document, so its timer and open dialogs stay alive.
    if (cloudSync.running) cloudSync.again = true;
    else cloudSync.adoptSavedWorkspace();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') cloudSync.retry();
  });
}
