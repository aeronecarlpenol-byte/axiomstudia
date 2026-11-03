-- PostgREST must return a business conflict, not retry a serialization failure.
-- This upgrades already-installed projects without changing data or privileges.
do $$
declare definition text;
begin
  select pg_get_functiondef('public.save_workspace(jsonb,bigint)'::regprocedure) into definition;
  if position('''40001''' in definition) > 0 then
    execute replace(definition, '''40001''', '''PT409''');
  end if;
end;
$$;
notify pgrst, 'reload schema';
