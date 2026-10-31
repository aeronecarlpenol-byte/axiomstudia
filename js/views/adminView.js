import { getCloudClients } from '../cloudClient.js';

// The route and gesture reveal only a login shell. Every data request is authorized
// independently by Postgres against the private, verified account allowlist.
export function renderAdmin(container) {
  let disposed = false;
  let offset = 0;
  let unsubscribe;
  let busy = false;
  let generation = 0;
  container.innerHTML = `
    <div class="tasks-toolbar"><h2>Admin Dashboard</h2></div>
    <div class="card" style="max-width:800px">
      <p id="admin-status" role="status" aria-live="polite">Sign in with the owner's verified account.</p>
      <form id="admin-login">
        <div class="form-group"><label class="form-label" for="admin-email">Email</label><input id="admin-email" type="email" autocomplete="username" required></div>
        <div class="form-group"><label class="form-label" for="admin-password">Password</label><input id="admin-password" type="password" autocomplete="current-password" required></div>
        <button class="btn btn-primary" type="submit">Sign in</button>
      </form>
      <div id="admin-content" hidden></div>
      <button id="admin-refresh" class="btn btn-secondary" hidden>Refresh</button>
      <button id="admin-signout" class="btn btn-ghost" hidden>Sign out</button>
    </div>`;
  const status = container.querySelector('#admin-status');
  const form = container.querySelector('form');
  const content = container.querySelector('#admin-content');
  const signout = container.querySelector('#admin-signout');
  const refresh = container.querySelector('#admin-refresh');
  function hideData() { content.replaceChildren(); content.hidden = true; refresh.hidden = true; }
  async function load() {
    if (disposed || busy) return;
    busy = true;
    const ticket = ++generation;
    hideData();
    try {
      const { admin } = await getCloudClients();
      const session = await admin.auth.getSession();
      if (session.error) throw session.error;
      if (!session.data.session) { form.hidden = false; signout.hidden = true; return; }
      signout.hidden = false;
      const { data, error } = await admin.rpc('admin_overview', { page_offset: offset });
      if (disposed || ticket !== generation) return;
      if (error) throw new Error('Access denied or unavailable. Only the verified owner account can view this dashboard.');
      form.hidden = true;
      status.textContent = 'Owner access verified.';
      const total = document.createElement('h3');
      total.textContent = `${data.total} unique anonymous users`;
      const note = document.createElement('p');
      note.textContent = 'Anonymous browser identities; this is not a count of verified people. Activity times are approximate.';
      const table = document.createElement('table');
      table.style.width = '100%';
      table.innerHTML = '<thead><tr><th>Entered name</th><th>First visit</th><th>Last active</th></tr></thead>';
      const body = table.createTBody();
      for (const visitor of data.visitors) {
        const row = body.insertRow();
        for (const value of [visitor.display_name || 'Unnamed visitor', new Date(visitor.first_visit).toLocaleString(), new Date(visitor.last_active).toLocaleString()]) {
          row.insertCell().textContent = value;
        }
      }
      const controls = document.createElement('div');
      for (const [label, delta] of [['Previous', -100], ['Next', 100]]) {
        const button = document.createElement('button');
        button.className = 'btn btn-ghost'; button.textContent = label;
        button.disabled = delta < 0 ? offset === 0 : offset + 100 >= Number(data.total);
        button.onclick = () => { offset += delta; load(); };
        controls.append(button);
      }
      const tableScroll = document.createElement('div');
      tableScroll.style.overflowX = 'auto';
      tableScroll.append(table);
      content.append(total, note, tableScroll, controls);
      content.hidden = false; refresh.hidden = false;
    } catch (error) {
      if (!disposed && ticket === generation) { hideData(); status.textContent = error.message; form.hidden = false; }
    } finally {
      busy = false;
      if (!disposed && ticket !== generation && document.visibilityState === 'visible') setTimeout(load, 0);
    }
  }
  form.onsubmit = async event => {
    event.preventDefault(); hideData();
    const button = form.querySelector('button'); button.disabled = true;
    try {
      const { admin } = await getCloudClients();
      const result = await admin.auth.signInWithPassword({
        email: form.querySelector('#admin-email').value,
        password: form.querySelector('#admin-password').value
      });
      form.querySelector('#admin-password').value = '';
      if (result.error) throw new Error('Sign-in failed. Check your credentials.');
      await load();
    } catch (error) { if (!disposed) status.textContent = error.message; }
    finally { button.disabled = false; }
  };
  signout.onclick = async () => {
    generation++;
    hideData();
    try {
      const { admin } = await getCloudClients();
      const { error } = await admin.auth.signOut({ scope: 'local' });
      if (error) throw error;
      form.hidden = false; signout.hidden = true; status.textContent = 'Signed out.';
    } catch { status.textContent = 'Sign-out failed. Retry before leaving this device.'; }
  };
  refresh.onclick = load;
  const onVisible = () => { generation++; hideData(); if (document.visibilityState === 'visible') load(); };
  document.addEventListener('visibilitychange', onVisible);
  // Recheck authorization periodically and on auth revocation / expiry.
  const interval = setInterval(load, 60000);
  getCloudClients().then(({ admin }) => {
    if (disposed) return;
    unsubscribe = admin.auth.onAuthStateChange(() => { generation++; hideData(); setTimeout(load, 0); }).data.subscription;
    load();
  }).catch(error => { if (!disposed) status.textContent = error.message; });
  return () => { disposed = true; hideData(); unsubscribe?.unsubscribe(); clearInterval(interval); document.removeEventListener('visibilitychange', onVisible); };
}
