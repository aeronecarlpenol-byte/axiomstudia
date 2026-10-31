import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const source = fs.readFileSync(new URL('../js/cloudSync.js', import.meta.url), 'utf8')
  .replace(/^import .*;$/gm, '').replace('export class CloudSync', 'globalThis.CloudSync = class CloudSync')
  .split('export const cloudSync')[0];
const clone = value => JSON.parse(JSON.stringify(value));
const store = () => {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
};
const context = vm.createContext({ console, cloudConfigured: () => true,
  crypto: webcrypto, TextEncoder, setTimeout: () => 1, clearTimeout() {}, getCloudClients() {} });
vm.runInContext(source, context);
const CloudSync = context.CloudSync;
const remote = new Map();
let fail = false, loseResponse = false, inFlight;
let nextId = 0;
function client(sessionStore) {
  return {
    auth: {
      async getSession() { return { data: { session: sessionStore.session || null } }; },
      async signInAnonymously() {
        sessionStore.session = { user: { id: `visitor-${++nextId}`, is_anonymous: true } };
        return { data: { session: sessionStore.session } };
      }
    },
    from() { return { select() { return this; }, eq() { return this; }, async maybeSingle() {
      if (fail) throw new Error('Offline');
      const row = clone(remote.get(sessionStore.session.user.id) || null);
      if (row) row.payload = Object.fromEntries(Object.entries(row.payload).reverse());
      return { data: row };
    } }; },
    async rpc(name, args) {
      if (fail) throw new Error('Offline');
      if (name === 'touch_visitor') return {};
      const uid = sessionStore.session.user.id;
      const old = remote.get(uid);
      if ((old?.revision || 0) !== args.expected_revision) return { error: new Error('Revision conflict') };
      const revision = (old?.revision || 0) + 1;
      remote.set(uid, { revision, payload: clone(args.document) });
      if (inFlight) { const fn = inFlight; inFlight = null; fn(); }
      if (loseResponse) { loseResponse = false; throw new Error('Lost response'); }
      return { data: revision };
    }
  };
}
function workspace(storage, data) {
  const payload = clone(data);
  const cloudState = payload.__axiomCloud;
  delete payload.__axiomCloud;
  return {
    data: payload, cloudState, listeners: [],
    subscribe(fn) { this.listeners.push(fn); },
    save() {
      this.beforeSave?.();
      storage.setItem('axiom_studia_database_v16', JSON.stringify({ ...this.data, __axiomCloud: this.cloudState }));
      this.listeners.forEach(fn => fn());
    }
  };
}
const seed = { userProfile: { name: 'Same name' }, subjects: [{ id: 'sub-old', grades: { prelim: 7 } }], tasks: [{ id: 'task-old' }],
  pdfProgress: { 'notes.pdf': { page: 12 } }, resources: [{ id: 'res-old' }] };
const storageA = store(), authA = {}, transportA = client(authA);
let dbA = workspace(storageA, seed);
let syncA = new CloudSync(dbA, storageA, async () => ({ visitor: transportA }));
loseResponse = true;
await syncA.retry();
assert.equal(syncA.status, 'retry');
assert.equal(remote.size, 1);
await syncA.retry();
assert.equal(syncA.status, 'saved');
assert.equal(remote.get(authA.session.user.id).revision, 1, 'Lost response retry must not create another migration');
assert.deepEqual(remote.get(authA.session.user.id).payload, seed);

fail = true;
dbA.data.tasks.push({ id: 'offline-task' }); dbA.save();
await syncA.retry();
assert.equal(syncA.status, 'retry');
assert.equal(JSON.parse(storageA.getItem('axiom-cloud-sync-v1')).pending, true);
// Reopen with persistent local data, auth session and durable outbox.
dbA = workspace(storageA, JSON.parse(storageA.getItem('axiom_studia_database_v16')));
syncA = new CloudSync(dbA, storageA, async () => ({ visitor: transportA }));
fail = false;
await syncA.retry();
assert.equal(syncA.status, 'saved');
assert.equal(remote.get(authA.session.user.id).payload.tasks.length, 2);
assert.equal(nextId, 1, 'Reopening reuses the anonymous identity');

const storageB = store(), authB = {}, dbB = workspace(storageB, { ...seed, tasks: [] });
const syncB = new CloudSync(dbB, storageB, async () => ({ visitor: client(authB) }));
await syncB.retry();
assert.notEqual(authA.session.user.id, authB.session.user.id);
assert.equal(remote.size, 2, 'Equal names never select the same workspace');
assert.equal(remote.get(authB.session.user.id).payload.tasks.length, 0);

inFlight = () => { dbA.data.tasks.push({ id: 'during-save' }); dbA.save(); };
dbA.data.tasks.push({ id: 'before-save' }); dbA.save();
await syncA.retry();
if (syncA.running) await syncA.running;
assert.equal(remote.get(authA.session.user.id).payload.tasks.length, 4, 'Edits during save remain queued');

loseResponse = true;
inFlight = () => { dbA.data.tasks.push({ id: 'after-lost-ack' }); dbA.save(); };
dbA.data.tasks.push({ id: 'lost-ack' }); dbA.save();
await syncA.retry();
if (syncA.running) await syncA.running;
await syncA.retry();
if (syncA.running) await syncA.running;
assert.equal(syncA.status, 'saved');
assert.equal(remote.get(authA.session.user.id).payload.tasks.length, 6, 'New edits survive a lost save acknowledgement');

// A stale tab must preserve its copy and refuse to overwrite a newer revision.
const staleStore = store();
// Another tab has acknowledged a newer cloud revision in the shared metadata.
// The atomic outbox still binds these unsaved edits to their original revision.
staleStore.setItem('axiom-cloud-sync-v1', JSON.stringify({ uid: authA.session.user.id, revision: remote.get(authA.session.user.id).revision, pending: false }));
const staleDB = workspace(staleStore, { ...seed, __axiomCloud: { uid: authA.session.user.id, revision: 1, pending: true } });
const stale = new CloudSync(staleDB, staleStore, async () => ({ visitor: transportA }));
await stale.retry();
assert.equal(stale.status, 'conflict');
assert.deepEqual(staleDB.data, seed);
assert.equal(remote.get(authA.session.user.id).payload.tasks.length, 6);

// Missing established credentials must not mint a replacement anonymous identity.
authA.session = null;
await syncA.retry();
assert.equal(syncA.status, 'retry');
assert.equal(nextId, 2);
assert.match(syncA.message, /session is unavailable/);
console.log('Cloud sync: idempotent migration, offline/reopen recovery, equal-name identities, in-flight edits, stale revisions, lost-session protection passed (simulated transport).');
