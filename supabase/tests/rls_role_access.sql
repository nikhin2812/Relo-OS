-- Role access tests for the tenancy tables (spec section 3).
-- Adds temporary fixtures (a second RMC, a second company, unallocated
-- assignments), checks what each role can see, then rolls everything back.
-- Returns one row per check; every row must have pass = true.

create or replace function pg_temp.rls_role_access()
returns table (check_name text, expected int, actual int, pass boolean)
language plpgsql as $fn$
declare
  t1 uuid := '10000000-0000-0000-0000-000000000001';
  c1 uuid := '20000000-0000-0000-0000-000000000001';
  a1 uuid := '40000000-0000-0000-0000-000000000001';
  t2 uuid := 'f0000000-0000-0000-0000-000000000001';
  c2 uuid := 'f0000000-0000-0000-0000-000000000002';
  c3 uuid := 'f0000000-0000-0000-0000-000000000003';
  a2 uuid := 'f0000000-0000-0000-0000-000000000012';
  a3 uuid := 'f0000000-0000-0000-0000-000000000013';
  a4 uuid := 'f0000000-0000-0000-0000-000000000014';
  other_admin uuid := 'f0000000-0000-0000-0000-000000000021';
  users jsonb := jsonb_build_object(
    'rmc_admin',   '30000000-0000-0000-0000-000000000001',
    'consultant',  '30000000-0000-0000-0000-000000000002',
    'hr_user',     '30000000-0000-0000-0000-000000000003',
    'employee',    '30000000-0000-0000-0000-000000000004',
    'vendor',      '30000000-0000-0000-0000-000000000005',
    'other_rmc_admin', other_admin);
  -- expected visible rows: tenants, companies, profiles, assignments, budgets, allocations
  expect jsonb := jsonb_build_object(
    'rmc_admin',       '[1, 2, 5, 3, 3, 1]',
    'consultant',      '[1, 1, 1, 1, 1, 1]',
    'hr_user',         '[1, 1, 1, 2, 2, 0]',
    'employee',        '[1, 1, 1, 1, 0, 0]',
    'vendor',          '[1, 0, 1, 0, 0, 0]',
    'other_rmc_admin', '[1, 1, 1, 1, 1, 0]');
  tbls text[] := array['rmc_tenants', 'client_companies', 'profiles',
                       'assignments', 'assignment_budgets', 'assignment_consultants'];
  results jsonb := '[]';
  who text;
  i int;
  n int;
  blocked boolean;
begin
  begin
    -- Fixtures
    insert into public.rmc_tenants (id, name) values (t2, 'Other Test RMC (fixture)');
    insert into public.client_companies (id, rmc_tenant_id, name) values
      (c2, t1, 'Second Company (fixture)'), (c3, t2, 'Other RMC Company (fixture)');
    insert into auth.users (id, aud, role, email) values
      (other_admin, 'authenticated', 'authenticated', 'other-admin@fixture.relo-os.test');
    insert into public.profiles (id, rmc_tenant_id, role, full_name, email) values
      (other_admin, t2, 'rmc_admin', 'Other Admin (fixture)', 'other-admin@fixture.relo-os.test');
    insert into public.assignments (id, rmc_tenant_id, client_company_id, employee_name,
      family_size, origin, destination, move_date) values
      (a2, t1, c1, 'Unallocated Person (fixture)', 1, 'Pune', 'Singapore', '2026-12-01'),
      (a3, t1, c2, 'Other Company Person (fixture)', 2, 'Delhi', 'London', '2026-12-01'),
      (a4, t2, c3, 'Other RMC Person (fixture)', 1, 'Mumbai', 'Berlin', '2026-12-01');
    insert into public.assignment_budgets (assignment_id, rmc_tenant_id, amount) values
      (a2, t1, 100000), (a3, t1, 200000), (a4, t2, 300000);

    -- Visibility per role
    for who in select jsonb_object_keys(users) loop
      perform set_config('request.jwt.claims',
        jsonb_build_object('sub', users->>who, 'role', 'authenticated')::text, true);
      set local role authenticated;
      for i in 1 .. array_length(tbls, 1) loop
        execute format('select count(*) from public.%I', tbls[i]) into n;
        results := results || jsonb_build_object('c', who || ' sees ' || tbls[i],
          'e', (expect->>who)::jsonb->>(i - 1), 'a', n);
      end loop;

      -- Nobody logged in may write directly (writes come later, via reviewed paths).
      blocked := false;
      begin
        update public.assignments set status = 'cancelled' where id = a1;
      exception when insufficient_privilege then blocked := true;
      end;
      results := results || jsonb_build_object('c', who || ' cannot edit assignments',
        'e', 1, 'a', blocked::int);
      reset role;
    end loop;

    -- Cross-tenant spot checks
    perform set_config('request.jwt.claims',
      jsonb_build_object('sub', users->>'rmc_admin', 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into n from public.assignments where id = a4;
    results := results || jsonb_build_object('c', 'rmc_admin cannot see other RMC assignment', 'e', 0, 'a', n);
    reset role;

    perform set_config('request.jwt.claims',
      jsonb_build_object('sub', other_admin, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into n from public.assignments where id = a1;
    results := results || jsonb_build_object('c', 'other RMC admin cannot see demo assignment', 'e', 0, 'a', n);
    reset role;

    -- Logged-out visitors are refused outright.
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    set local role anon;
    foreach who in array tbls loop
      blocked := false;
      begin
        execute format('select count(*) from public.%I', who) into n;
      exception when insufficient_privilege then blocked := true;
      end;
      results := results || jsonb_build_object('c', 'logged-out visitor blocked from ' || who, 'e', 1, 'a', blocked::int);
    end loop;
    reset role;

    raise exception 'rollback fixtures' using errcode = 'ZZ001';
  exception when sqlstate 'ZZ001' then
    null; -- fixtures undone
  end;

  return query
    select r->>'c', (r->>'e')::int, (r->>'a')::int, (r->>'e')::int = (r->>'a')::int
    from jsonb_array_elements(results) r;
end
$fn$;

select * from pg_temp.rls_role_access();
