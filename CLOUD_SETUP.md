# Axiom Studia cloud setup

The Axiom Studia project (`khrzpwwpnjgoyrhcbrvc`) is connected. Its database schema,
row-level access rules, and anonymous sign-ins were installed and verified on
October 31, 2026. The public URL and publishable key are in `js/cloudConfig.js`.
The owner's confirmed application account was added as the sole admin in the
private UUID allowlist on November 3, 2026. Its identity and credentials are kept
out of frontend configuration and this public repository. A Supabase dashboard
login is separate from an application's Authentication user.

GitHub Pages can still host the app; Supabase provides the authenticated API and
Postgres database server. Existing browser data is retained as the recovery copy.
The instructions below document setup for a new project; do not rerun the first
migration in this already-configured project.

1. Create a Supabase project at https://supabase.com/dashboard. Enable anonymous
   sign-ins under Authentication settings and keep new user signups enabled so
   new anonymous visitors can be created. This app has no visitor signup form;
   any other registered accounts are still denied owner privileges by the private
   UUID allowlist.
2. Run `supabase/migrations/202610310001_cloud.sql` once in the SQL editor, followed
   by `202610310002_conflict_http_status.sql`. The second migration also upgrades
   older installations to return HTTP 409 for revision conflicts instead of a
   serialization code that can cause PostgREST retry loops.
3. Create your owner account in Supabase Authentication using a strong password
   and verify its email. Copy its UUID from Authentication → Users. In the SQL
   editor, run the following with that actual UUID:

   ```sql
   insert into axiom_private.admin_account(singleton, user_id)
   values (true, 'YOUR-VERIFIED-ACCOUNT-UUID')
   on conflict (singleton) do update set user_id = excluded.user_id;
   ```

   The private table allows exactly one owner and cannot be read or changed by
   browser API clients. Unverified and anonymous accounts are always rejected.
4. Fill `url` and `publishableKey` in `js/cloudConfig.js` using the project URL and
   public publishable key from project settings. The legacy public anon key also
   works. **Never use a service-role/secret key, database password, or admin
   password in this file or anywhere in the frontend.** No privileged key is
   needed by this app: privileged operations execute inside guarded SQL functions.
5. Publish the updated static files to your existing HTTPS host. The pinned
   Supabase SDK loads from `esm.sh`; allow it in any host Content Security Policy.
   Existing users must visit on the same origin to migrate their local storage.
6. Press Ctrl+Shift+A to open the hidden admin login. The newer interface replaced
   the branding button with this keyboard shortcut. This opens `#admin`, which
   displays login only until the SQL API verifies
   your account. Admin sessions use separate tab-scoped storage; signing out uses
   local scope and never signs out the persistent anonymous visitor session.

## Data and recovery

Each anonymous auth UUID owns one JSON workspace row containing the existing
profile, academic settings, subjects (including grades), tasks, resource references,
focus sessions, and other study data. Legacy reading progress, bookmarks, and last
study activity are copied into the workspace; original local keys and IndexedDB
PDF files are retained. PDF binary uploads remain device-local. Names, sections,
and programs are display labels only; they never select or authenticate a
workspace. Settings edits update the same UUID-owned workspace.

Student ID numbers are no longer collected or displayed. Readable local profiles
and legacy workspace copies are scrubbed in place without changing entity IDs.
When an older cloud profile is restored, its retired field is removed and the
sanitized workspace is saved against that same cloud revision. Inactive cloud
profiles are cleaned when their browser next syncs; no database schema change is
required. Unreadable recovery copies are kept intact to avoid losing study data.

The welcome screen appears only when name, section, or program is missing. A
complete profile can reopen from its local recovery copy while cloud changes are
queued. Startup waits at most 12 seconds for cloud restoration, then opens local
data; the sync banner exposes connection failures and Retry. The welcome screen
and Settings explain that clearing browser data or changing devices may remove
access and entering the same name cannot recover a workspace.

Migration writes a whole snapshot with the existing entity IDs and a revision
comparison. Retrying a request, including after a lost response, cannot append
duplicate records. Local storage remains the durable outbox. Failed requests retry
after 30 seconds, on returning online, on returning to the tab, and via Retry.
Edits during a request stay pending. If two tabs edit the same base revision,
the stale tab stops with a conflict and retains its local data instead of replacing
the newer cloud copy. Keep that tab open for manual recovery; do not clear browser
data. A lost/invalid established anonymous session is never silently replaced.
There is no cross-device recovery without the original anonymous credentials.

The owner dashboard reads names and server-generated first/last activity times,
with a count of distinct anonymous UUIDs. Heartbeats are throttled to five minutes.
No page history, IP addresses, or user agents are stored in application tables.
Supabase infrastructure may maintain its own operational logs.

## Verification

Install the test-only dependency with `pnpm install`, then run `pnpm test`.
This includes real embedded PostgreSQL (PGlite) tests of the migration, grants,
RLS, admin checks, session revocation, and revision conflicts using an auth schema
fixture. These passed during implementation. They do not exercise hosted Supabase
Auth token issuance or its deployed REST gateway.

Run the existing Playwright browser tests, plus
`tests/cloud-sync.mjs` and `tests/cloud-settings.cjs`. Browser tests use Playwright
and Edge. `tests/cloud-sync.mjs` exercises a simulated transport; it does not prove
live Supabase access rules.

After deploying the schema to a **test project**, run
`supabase/tests/access.sql` in the SQL editor. It uses a rollback transaction and
temporary test identities to exercise actual Postgres roles, row isolation,
spoofed admin metadata, admin authorization, revocation, and idempotent revisions.
Then test on your deployed app with two separate browser profiles:

- Create records, refresh, fully close/reopen the browser, and check the same UUID
  and records return. Use the same display name in both profiles; their records
  must remain separate.
- Disconnect the network, edit records, reload, reconnect, and Retry. Verify the
  cloud copy receives the queued changes exactly once.
- Attempt `#admin` while signed out and with a different verified account. Both
  must be unable to retrieve visitor information; test direct REST requests too.
- Sign in with the allowlisted owner. Check pagination, names, first/last times,
  count labels, and sign-out without changing the anonymous workspace.

The opt-in `tests/live-cloud.mjs` was run against the hosted project and passed:
anonymous signup, equal-name identity separation, saves, per-user record isolation,
hidden visitor metadata, denied admin APIs, denied direct writes, HTTP 409 on
duplicate migration, session refresh, and recovered grades/reading progress.
Run it with `AXIOM_LIVE_CLOUD_TEST=yes`; it uses only the public key and retains
test tokens under ignored `.venv/axiom-cloud-qa.json` for reusable QA identities.
These QA identities are included in the anonymous-user count. No existing visitor
data was changed. The saved QA identities were refreshed and their cloud data
recovered again on November 3, 2026. Interactive owner sign-in was also verified
against the live database: the dashboard displayed private visitor metrics only
after owner authorization. Signing out hid the list, a refreshed admin URL showed
only login, and the visible anonymous workspace settings remained unchanged.

References: [Anonymous sign-ins](https://supabase.com/docs/guides/auth/auth-anonymous),
[Row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security).
