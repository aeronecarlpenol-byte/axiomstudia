import assert from 'node:assert/strict';
import { cloudConfig } from '../js/cloudConfig.js';
import fs from 'node:fs';

// Explicit opt-in: this creates two real anonymous QA identities and workspaces.
// Never prints tokens and never uses a privileged key or existing visitor data.
if (process.env.AXIOM_LIVE_CLOUD_TEST !== 'yes') {
  console.log('Skipped live cloud checks. Set AXIOM_LIVE_CLOUD_TEST=yes to create two QA visitor identities.');
  process.exit(0);
}
const { url, publishableKey } = cloudConfig;
const sessionFile = new URL('../.venv/axiom-cloud-qa.json', import.meta.url);
let sessions;
try {
  const saved = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
  if (saved.url === url) sessions = saved.sessions;
} catch {}
function keepSessions() {
  fs.mkdirSync(new URL('../.venv/', import.meta.url), { recursive: true });
  fs.writeFileSync(sessionFile, JSON.stringify({ url, sessions }));
}
async function request(path, token, body, method = body === undefined ? 'GET' : 'POST') {
  console.log(`Live check: ${method} ${path.split('?')[0]}`);
  const response = await fetch(url + path, {
    method,
    headers: { apikey: publishableKey, 'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30000)
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { ok: response.ok, status: response.status, data };
}
const signin = async () => {
  const result = await request('/auth/v1/signup', null, { data: {} });
  assert.ok(result.ok, `Anonymous sign-in failed (${result.status}): ${result.data?.msg || result.data?.message || 'unknown error'}`);
  assert.equal(result.data.user.is_anonymous, true);
  return result.data;
};
if (!sessions) { sessions = []; keepSessions(); }
while (sessions.length < 2) { sessions.push(await signin()); keepSessions(); }
// QA sessions persist between runs; renew expired access tokens without creating
// replacement identities, just as the browser client does when reopened later.
for (let index = 0; index < sessions.length; index++) {
  const renewed = await request('/auth/v1/token?grant_type=refresh_token', null,
    { refresh_token: sessions[index].refresh_token });
  assert.ok(renewed.ok, `QA session renewal failed (${renewed.status}); keep the saved identity for recovery.`);
  assert.equal(renewed.data.user.id, sessions[index].user.id);
  sessions[index] = renewed.data;
  keepSessions();
}
const [a, b] = sessions;
assert.notEqual(a.user.id, b.user.id);
const seed = marker => ({ version: 16, userProfile: { name: 'Axiom cloud verification' },
  subjects: [{ id: marker, grades: { prelim: 8.25 } }], tasks: [], resources: [],
  pdfProgress: { 'qa-notes.pdf': { page: 12 } } });
for (const [session, marker] of [[a, 'qa-owner-a'], [b, 'qa-owner-b']]) {
  const existing = await request('/rest/v1/workspaces?select=payload,revision', session.access_token);
  assert.ok(existing.ok);
  if (existing.data.length) {
    assert.equal(existing.data[0].payload.subjects[0].id, marker);
    continue;
  }
  const result = await request('/rest/v1/rpc/save_workspace', session.access_token, { document: seed(marker), expected_revision: 0 });
  assert.ok(result.ok, `Workspace save failed (${result.status}): ${result.data?.message || 'unknown error'}`);
  assert.equal(result.data, 1);
}
const own = await request('/rest/v1/workspaces?select=user_id,payload,revision', a.access_token);
assert.ok(own.ok);
assert.equal(own.data.length, 1);
assert.equal(own.data[0].user_id, a.user.id);
assert.equal(own.data[0].payload.subjects[0].id, 'qa-owner-a');
const other = await request(`/rest/v1/workspaces?select=user_id&user_id=eq.${b.user.id}`, a.access_token);
assert.ok(other.ok); assert.deepEqual(other.data, []);
const visitors = await request('/rest/v1/visitors?select=user_id,display_name', a.access_token);
assert.ok(visitors.ok); assert.deepEqual(visitors.data, []);
const admin = await request('/rest/v1/rpc/admin_overview', a.access_token, { page_offset: 0 });
assert.equal(admin.ok, false);
assert.ok([401, 403].includes(admin.status));
const loggedOutAdmin = await request('/rest/v1/rpc/admin_overview', null, { page_offset: 0 });
assert.equal(loggedOutAdmin.ok, false);
const directWrite = await request(`/rest/v1/workspaces?user_id=eq.${b.user.id}`, a.access_token,
  { payload: seed('forged') }, 'PATCH');
assert.equal(directWrite.ok, false);
const retry = await request('/rest/v1/rpc/save_workspace', a.access_token,
  { document: seed('qa-owner-a'), expected_revision: 0 });
assert.equal(retry.ok, false);
assert.equal(retry.status, 409, 'Revision conflicts must return promptly as HTTP 409');
const after = await request('/rest/v1/workspaces?select=user_id,payload,revision', a.access_token);
assert.equal(after.data.length, 1); assert.equal(after.data[0].revision, 1);
const refreshed = await request('/auth/v1/token?grant_type=refresh_token', null, { refresh_token: a.refresh_token });
assert.ok(refreshed.ok); assert.equal(refreshed.data.user.id, a.user.id);
sessions[0] = refreshed.data; keepSessions();
const recovered = await request('/rest/v1/workspaces?select=payload', refreshed.data.access_token);
assert.equal(recovered.data[0].payload.subjects[0].grades.prelim, 8.25);
assert.equal(recovered.data[0].payload.pdfProgress['qa-notes.pdf'].page, 12);
console.log('LIVE Supabase passed: anonymous sign-in, distinct equal-name identities, cloud saves, record isolation, hidden visitor metadata, denied admin APIs, denied direct writes, duplicate-free retry, refresh-token identity continuity, and recovered grades/progress.');
console.log('Verified two named QA visitor workspaces; no existing visitor data was modified.');
