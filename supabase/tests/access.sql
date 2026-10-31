-- Run only in a test Supabase project, after the migration, as postgres.
-- Everything, including test auth identities, is rolled back.
begin;
insert into auth.users(id, aud, role, email, email_confirmed_at, is_anonymous, raw_user_meta_data)
values
 ('a7100000-0000-4000-8000-000000000001','authenticated','authenticated',null,null,true,'{}'),
 ('a7100000-0000-4000-8000-000000000002','authenticated','authenticated',null,null,true,'{}'),
 ('a7100000-0000-4000-8000-000000000003','authenticated','authenticated','owner@axiom.invalid',now(),false,'{}'),
 ('a7100000-0000-4000-8000-000000000004','authenticated','authenticated','other@axiom.invalid',now(),false,'{"admin":true}');
insert into auth.sessions(id, user_id, created_at, updated_at) values
 ('a7200000-0000-4000-8000-000000000003','a7100000-0000-4000-8000-000000000003',now(),now()),
 ('a7200000-0000-4000-8000-000000000004','a7100000-0000-4000-8000-000000000004',now(),now());
insert into axiom_private.admin_account(singleton,user_id)
 values (true,'a7100000-0000-4000-8000-000000000003')
 on conflict(singleton) do update set user_id=excluded.user_id;

create function pg_temp.check_true(value boolean, message text) returns void
language plpgsql as $$ begin
  if value is distinct from true then raise exception 'TEST FAILED: %',message; end if;
end $$;
create function pg_temp.denied(statement text) returns void
language plpgsql as $$ begin
  begin execute statement;
  exception when insufficient_privilege then return; end;
  raise exception 'TEST FAILED: operation was permitted: %',statement;
end $$;
create function pg_temp.conflict(statement text) returns void
language plpgsql as $$ begin
  begin execute statement;
  exception when serialization_failure then return; end;
  raise exception 'TEST FAILED: revision conflict was not rejected';
end $$;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a7100000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":true}',true);
select pg_temp.check_true(public.save_workspace('{"subjects":[{"id":"a"}],"tasks":[],"userProfile":{"name":"Same name"}}',0)=1,'First migration revision');
select pg_temp.conflict($q$select public.save_workspace('{"subjects":[],"tasks":[]}',0)$q$);
select pg_temp.check_true((select count(*)=1 from public.workspaces),'Migration retry cannot duplicate');
select pg_temp.check_true((select count(*)=0 from public.visitors),'Visitor list hidden');
select pg_temp.denied('select public.admin_overview()');
select pg_temp.denied($q$update public.workspaces set payload='{}'$q$);
select pg_temp.denied('delete from public.workspaces');
select pg_temp.denied($q$update public.visitors set display_name='forged'$q$);
select pg_temp.denied('select * from axiom_private.admin_account');

select set_config('request.jwt.claims','{"sub":"a7100000-0000-4000-8000-000000000002","role":"authenticated","is_anonymous":true,"user_metadata":{"admin":true}}',true);
select pg_temp.check_true((select count(*)=0 from public.workspaces),'Other visitor cannot read first workspace');
select public.save_workspace('{"subjects":[{"id":"b"}],"tasks":[],"userProfile":{"name":"Same name"}}',0);
select pg_temp.check_true((select count(*)=1 from public.workspaces),'Only own row is visible despite same display name');
select pg_temp.check_true((select payload->'subjects'->0->>'id'='b' from public.workspaces),'Own payload returned');
select pg_temp.denied('select public.admin_overview()');

select set_config('request.jwt.claims','{"sub":"a7100000-0000-4000-8000-000000000004","role":"authenticated","is_anonymous":false,"session_id":"a7200000-0000-4000-8000-000000000004","user_metadata":{"admin":true}}',true);
select pg_temp.denied('select public.admin_overview()');
select pg_temp.check_true(not public.is_axiom_admin(),'Other verified account denied even with spoofed metadata');
select pg_temp.denied($q$select public.save_workspace('{"subjects":[],"tasks":[]}',0)$q$);

select set_config('request.jwt.claims','{"sub":"a7100000-0000-4000-8000-000000000003","role":"authenticated","is_anonymous":false,"session_id":"a7200000-0000-4000-8000-000000000003"}',true);
select pg_temp.check_true(public.is_axiom_admin(),'Verified owner accepted');
select pg_temp.check_true(jsonb_array_length(public.admin_overview()->'visitors')>=2,'Owner can see visitors');
select pg_temp.check_true((select count(*)=0 from public.workspaces),'Owner session cannot read private workspace payloads');

reset role;
update auth.users set email_confirmed_at=null where id='a7100000-0000-4000-8000-000000000003';
set local role authenticated;
select pg_temp.denied('select public.admin_overview()');
reset role;
update auth.users set email_confirmed_at=now() where id='a7100000-0000-4000-8000-000000000003';
delete from auth.sessions where id='a7200000-0000-4000-8000-000000000003';
set local role authenticated;
select pg_temp.denied('select public.admin_overview()');

reset role;
set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);
select pg_temp.denied('select * from public.workspaces');
select pg_temp.denied('select * from public.visitors');
select pg_temp.denied('select public.admin_overview()');
select pg_temp.denied($q$select public.save_workspace('{"subjects":[],"tasks":[]}',0)$q$);
reset role;
rollback;
select 'All Axiom database authorization assertions passed.' as result;
