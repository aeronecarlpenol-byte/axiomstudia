-- Run in the Supabase SQL editor as the database owner.
begin;
create schema if not exists axiom_private;
revoke all on schema axiom_private from public, anon, authenticated;

create table axiom_private.admin_account (
  singleton boolean primary key default true check (singleton),
  user_id uuid not null references auth.users(id)
);
revoke all on axiom_private.admin_account from public, anon, authenticated;

create function public.is_axiom_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from axiom_private.admin_account a
    join auth.users u on u.id = a.user_id
    join auth.sessions s on s.user_id = u.id
    where u.id = auth.uid() and u.email_confirmed_at is not null
      and u.is_anonymous = false
      and s.id::text = (auth.jwt() ->> 'session_id')
      and (s.not_after is null or s.not_after > now())
  );
$$;
revoke all on function public.is_axiom_admin() from public, anon;
grant execute on function public.is_axiom_admin() to authenticated;

create table public.workspaces (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null,
  revision bigint not null default 1
);
alter table public.workspaces enable row level security;
revoke all on public.workspaces from anon, authenticated;
grant select on public.workspaces to authenticated;
create policy own_workspace on public.workspaces for select to authenticated
  using (user_id = (select auth.uid()) and (select auth.jwt()->>'is_anonymous') = 'true');

create table public.visitors (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  first_visit timestamptz not null default now(),
  last_active timestamptz not null default now()
);
alter table public.visitors enable row level security;
revoke all on public.visitors from anon, authenticated;
grant select on public.visitors to authenticated;
create policy admin_visitors on public.visitors for select to authenticated
  using ((select public.is_axiom_admin()));

-- Count anonymous identities even if their first workspace save is interrupted.
create function axiom_private.register_visitor() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.is_anonymous then
    insert into public.visitors(user_id, first_visit, last_active)
      values (new.id, coalesce(new.created_at, now()), now()) on conflict do nothing;
  end if;
  return new;
end;
$$;
revoke all on function axiom_private.register_visitor() from public, anon, authenticated;
create trigger axiom_register_visitor after insert on auth.users
  for each row execute function axiom_private.register_visitor();
insert into public.visitors(user_id, first_visit, last_active)
  select id, coalesce(created_at, now()), coalesce(created_at, now())
  from auth.users where is_anonymous on conflict do nothing;

create function public.save_workspace(document jsonb, expected_revision bigint) returns bigint
language plpgsql security definer set search_path = '' as $$
declare next_revision bigint;
begin
  if auth.uid() is null or coalesce(auth.jwt()->>'is_anonymous', 'false') <> 'true' then
    raise exception 'Anonymous authentication required' using errcode = '42501';
  end if;
  if jsonb_typeof(document) <> 'object'
    or jsonb_typeof(document->'subjects') is distinct from 'array'
    or jsonb_typeof(document->'tasks') is distinct from 'array'
    or octet_length(document::text) > 10000000 then
    raise exception 'Invalid workspace';
  end if;
  if expected_revision = 0 then
    insert into public.workspaces(user_id, payload) values (auth.uid(), document)
      on conflict (user_id) do nothing returning revision into next_revision;
  else
    update public.workspaces set payload = document, revision = revision + 1
      where user_id = auth.uid() and revision = expected_revision
      returning revision into next_revision;
  end if;
  if next_revision is null then
    raise exception 'Cloud copy changed; local work retained. Retry.' using errcode = '40001';
  end if;
  insert into public.visitors(user_id, display_name)
    values (auth.uid(), left(coalesce(document->'userProfile'->>'name',''), 200))
    on conflict(user_id) do update set display_name = excluded.display_name,
      last_active = now();
  return next_revision;
end;
$$;
revoke all on function public.save_workspace(jsonb, bigint) from public, anon;
grant execute on function public.save_workspace(jsonb, bigint) to authenticated;

create function public.touch_visitor() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or coalesce(auth.jwt()->>'is_anonymous', 'false') <> 'true' then
    raise exception 'Anonymous authentication required' using errcode = '42501';
  end if;
  update public.visitors set last_active = now()
    where user_id = auth.uid() and last_active < now() - interval '5 minutes';
end;
$$;
revoke all on function public.touch_visitor() from public, anon;
grant execute on function public.touch_visitor() to authenticated;

create function public.admin_overview(page_offset integer default 0)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  if not public.is_axiom_admin() then
    raise exception 'Admin authorization required' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'total', (select count(*) from public.visitors),
    'visitors', coalesce((select jsonb_agg(to_jsonb(v)) from (
      select user_id, display_name, first_visit, last_active from public.visitors
      order by first_visit desc, user_id limit 100 offset greatest(page_offset, 0)
    ) v), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;
revoke all on function public.admin_overview(integer) from public, anon;
grant execute on function public.admin_overview(integer) to authenticated;
commit;
