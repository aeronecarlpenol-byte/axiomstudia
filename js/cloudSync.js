import { db } from './db.js';
import { cloudConfigured, getCloudClients } from './cloudClient.js';

const META_KEY = 'axiom-cloud-sync-v1';
const LOCAL_KEY = 'axiom_studia_database_v16';
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
  writeMeta() { this.storage.setItem(META_KEY, JSON.stringify(this.meta)); }
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
        try { this.db.data = remote.payload; this.db.save(); this.hydration++; }
        finally { this.applying = false; }
      }
      if (this.db.lastSaveError) throw new Error('Cloud data loaded, but this browser could not keep a local recovery copy. Free browser storage and retry.');
      this.meta.revision = remote.revision;
      this.writeMeta();
    } else {
      // Whole-workspace compare-and-swap preserves IDs and prevents duplicate migration.
      // A stale tab must never overwrite a newer cloud revision.
      const snapshot = workspaceJSON(this.db.data);
      const expected = this.meta.revision || 0;
      if (remote && (remote.revision !== expected || workspaceJSON(remote.payload) === snapshot)) {
        if (workspaceJSON(remote.payload) !== snapshot) {
          this.setStatus('conflict', 'A newer cloud copy exists. Your unsaved work is kept in this browser. Close other tabs and keep this tab open for recovery.');
          return;
        }
        this.meta.revision = remote.revision;
      } else {
        this.meta.upload = { revision: expected, hash: await fingerprint(snapshot) };
        this.writeMeta();
        const result = await visitor.rpc('save_workspace', { document: JSON.parse(snapshot), expected_revision: expected });
        if (result.error) throw result.error;
        this.meta.revision = Number(result.data);
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
  element.querySelector('button').onclick = () => cloudSync.retry();
  return cloudSync.subscribe(sync => {
    const labels = { setup: 'Cloud setup pending · work kept in this browser', saving: 'Saving…', saved: 'Saved to cloud', retry: 'Changes waiting · retry', conflict: 'Cloud conflict · local work kept' };
    element.querySelector('span').textContent = labels[sync.status];
    element.title = sync.message;
    element.querySelector('small').textContent = sync.message;
    element.querySelector('small').hidden = !sync.message;
    element.querySelector('button').hidden = !['retry', 'conflict'].includes(sync.status);
  });
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => cloudSync.retry());
  window.addEventListener('storage', event => {
    if (event.key === LOCAL_KEY && event.newValue && !cloudSync.meta.pending) {
      // Do not replace a tab with unsaved edits. Reload idle tabs to share the durable outbox.
      location.reload();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') cloudSync.retry();
  });
}
