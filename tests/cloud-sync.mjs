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
vm.runInContext(fs.readFileSync(new URL('../js/workspaceMerge.js', import.meta.url), 'utf8').replaceAll('export ', ''), context);
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
    notify() { this.listeners.forEach(fn => fn()); },
    save() {
      if (this.data.userProfile) delete this.data.userProfile.studentId;
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

// A clean tab adopts a completed checkpoint without writing it back.
const sharedStore = store();
const sharedMeta = { uid: authA.session.user.id, revision: 1, pending: false };
const secondDB = workspace(sharedStore, { ...seed, __axiomCloud: sharedMeta });
const secondTab = new CloudSync(secondDB, sharedStore);
const checkpoint = JSON.stringify({ ...seed, tasks: [], __axiomCloud: { ...sharedMeta, revision: 2 } });
sharedStore.setItem('axiom_studia_database_v16', checkpoint);
secondTab.adoptSavedWorkspace();
assert.equal(secondDB.data.tasks.length, 0);
assert.equal(secondTab.meta.revision, 2);
assert.equal(secondTab.hydration, 1);
assert.equal(sharedStore.getItem('axiom_studia_database_v16'), checkpoint);
secondTab.adoptSavedWorkspace();
assert.equal(secondTab.hydration, 1, 'An identical checkpoint should not refresh the view again');
secondTab.meta.pending = true;
sharedStore.setItem('axiom_studia_database_v16', JSON.stringify({ ...seed, __axiomCloud: { ...sharedMeta, revision: 3 } }));
secondTab.adoptSavedWorkspace();
assert.equal(secondDB.data.tasks.length, 0, 'Pending edits must stay in their original tab');

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

// A user can recover a legacy conflict without repeatedly hitting the same revision.
await stale.resolveConflict('local');
if (stale.running) await stale.running;
assert.equal(stale.status, 'saved');
assert.equal(remote.get(authA.session.user.id).payload.tasks.length, seed.tasks.length);
// Return the original test tab to the latest remote before the next independent edit.
syncA.meta.pending = false;
await syncA.retry();
if (syncA.running) await syncA.running;
assert.equal(dbA.data.tasks.length, seed.tasks.length);

// Renaming is an update to the same authenticated UUID, never another lookup.
const owner = authA.session.user.id;
dbA.data.userProfile.name = 'Renamed label'; dbA.save();
await syncA.retry();
if (syncA.running) await syncA.running;
assert.equal(authA.session.user.id, owner);
assert.equal(remote.size, 2);
assert.equal(remote.get(owner).payload.tasks.length, seed.tasks.length);
assert.equal(remote.get(authB.session.user.id).payload.userProfile.name, 'Same name');

// A legacy cloud field is scrubbed and uploaded against the same revision.
const legacyRemote = remote.get(authB.session.user.id);
legacyRemote.payload.userProfile.studentId = 'retired-id';
syncB.meta.pending = false;
await syncB.retry();
if (syncB.running) await syncB.running;
assert.equal(syncB.status, 'saved');
assert.equal('studentId' in dbB.data.userProfile, false);
assert.equal('studentId' in remote.get(authB.session.user.id).payload.userProfile, false);
assert.equal(remote.size, 2);
assert.deepEqual(remote.get(authB.session.user.id).payload.subjects, seed.subjects);

// Missing established credentials must not mint a replacement anonymous identity.
authA.session = null;
await syncA.retry();
assert.equal(syncA.status, 'retry');
assert.equal(nextId, 2);
assert.match(syncA.message, /session is unavailable/);
console.log('Cloud sync: idempotent migration, offline/reopen recovery, equal-name identities, in-flight edits, stale revisions, lost-session protection passed (simulated transport).');

// Independent edits in two tabs merge automatically, including explicit deletions.
const mergeStore = store();
const mergeAuth = { session: { user: { id: 'merge-owner', is_anonymous: true } } };
const base = { ...seed, tasks: [{ id: 'keep', title: 'Original' }, { id: 'delete' }] };
remote.set('merge-owner', { revision: 1, payload: clone(base) });
const mergeDB = workspace(mergeStore, { ...base, __axiomCloud: { uid: 'merge-owner', revision: 1, pending: false } });
const merging = new CloudSync(mergeDB, mergeStore, async () => ({ visitor: client(mergeAuth) }));
merging.rememberBase(base, 1);
mergeDB.data.tasks = [{ id: 'keep', title: 'Local edit' }];
mergeDB.save();
remote.set('merge-owner', { revision: 2, payload: { ...base, tasks: [...base.tasks, { id: 'new', title: 'Remote addition' }] } });
await merging.retry();
for (let attempt = 0; attempt < 5 && merging.running; attempt++) await merging.running;
assert.equal(merging.status, 'saved');
assert.deepEqual(clone(remote.get('merge-owner').payload.tasks), [{ id: 'keep', title: 'Local edit' }, { id: 'new', title: 'Remote addition' }]);
const concurrentBase = clone(mergeDB.data);
mergeDB.data.tasks[0].title = 'Local overlap'; mergeDB.save();
remote.set('merge-owner', { revision: merging.meta.revision + 1, payload: { ...concurrentBase, tasks: [{ id: 'keep', title: 'Cloud overlap' }, concurrentBase.tasks[1]] } });
await merging.retry();
assert.equal(merging.status, 'conflict');
await merging.resolveConflict('remote');
if (merging.running) await merging.running;
assert.equal(merging.status, 'saved');
assert.equal(mergeDB.data.tasks[0].title, 'Cloud overlap');
console.log('Cross-tab merge, deletion preservation, overlap review and legacy conflict recovery passed.');
