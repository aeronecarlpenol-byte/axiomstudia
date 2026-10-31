import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';

// Execute the production migration and role tests on real embedded Postgres.
// Only Supabase's auth schema/functions are fixtures; RLS, grants, functions,
// triggers and compare-and-swap behavior run as actual PostgreSQL operations.
const db = new PGlite();
try {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users (
      id uuid primary key, aud text, role text, email text, email_confirmed_at timestamptz,
      is_anonymous boolean, raw_user_meta_data jsonb, created_at timestamptz default now()
    );
    create table auth.sessions (
      id uuid primary key, user_id uuid references auth.users(id),
      created_at timestamptz, updated_at timestamptz, not_after timestamptz
    );
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
    $$;
    create function auth.uid() returns uuid language sql stable as $$
      select (auth.jwt()->>'sub')::uuid;
    $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.jwt(), auth.uid() to anon, authenticated;
  `);
  await db.exec(fs.readFileSync(new URL('../supabase/migrations/202610310001_cloud.sql', import.meta.url), 'utf8'));
  await db.exec(fs.readFileSync(new URL('../supabase/tests/access.sql', import.meta.url), 'utf8'));
  console.log('Postgres authorization passed: own-record isolation, denied direct writes, hidden visitor list, spoofed metadata denial, verified UUID allowlist, email/session revocation, unauthenticated denial, idempotent revisions.');
} finally { await db.close(); }
