-- Role access tests (spec section 3) for every table and write function.
-- Adds temporary fixtures (a second RMC, a second company, unallocated
-- relocations, plans), checks what each role can see and do, then rolls
-- everything back. Counts only look at fixture rows and the seeded demo
-- relocation, so using the demo app doesn't break the test.
-- Returns one row per check; every row must have pass = true.

-- Runs a statement as a user; returns 'ok' or the SQL error code.
create or replace function pg_temp.try_as(uid uuid, stmt text) returns text
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  execute stmt;
  execute 'reset role';
  return 'ok';
exception when others then
  return sqlstate;
end $$;

-- Runs a count query as a user.
create or replace function pg_temp.count_as(uid uuid, stmt text) returns int
language plpgsql as $$
declare n int;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  execute stmt into n;
  execute 'reset role';
  return n;
end $$;

create or replace function pg_temp.rls_role_access()
returns table (check_name text, expected text, actual text, pass boolean)
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
  admin uuid := '30000000-0000-0000-0000-000000000001';
  consultant uuid := '30000000-0000-0000-0000-000000000002';
  hr uuid := '30000000-0000-0000-0000-000000000003';
  employee uuid := '30000000-0000-0000-0000-000000000004';
  vendor uuid := '30000000-0000-0000-0000-000000000005';
  other_admin uuid := 'f0000000-0000-0000-0000-000000000021';
  users jsonb;
  ids text := format('(%L::uuid, %L::uuid, %L::uuid, %L::uuid)', a1, a2, a3, a4);
  -- query per table, limited to rows this test controls
  queries jsonb;
  -- expected rows per role, in the order of `tbl_names`
  expect jsonb := jsonb_build_object(
    'rmc_admin',       '[1, 2, 5, 3, 3, 1, 1, 3, 4, 3]',
    'consultant',      '[1, 1, 1, 1, 1, 1, 1, 1, 2, 1]',
    'hr_user',         '[1, 1, 1, 2, 2, 0, 1, 2, 3, 2]',
    'employee',        '[1, 1, 1, 1, 0, 0, 0, 0, 0, 1]',
    'vendor',          '[1, 0, 1, 0, 0, 0, 0, 0, 0, 0]',
    'other_rmc_admin', '[1, 1, 1, 1, 1, 0, 1, 1, 1, 1]');
  tbl_names text[] := array['rmc_tenants', 'client_companies', 'profiles', 'assignments',
    'assignment_budgets', 'assignment_consultants', 'rmc_policies', 'relocation_plans',
    'plan_services', 'plan_milestones'];
  good_plan text := '{"summary":"Fixture plan","services":[{"key":"fx_a","category":"immigration","title":"FX visa","sequence":1,"depends_on":[],"start_date":"2026-12-01","due_date":"2026-12-10","estimated_cost":1000,"policy_status":"within_policy","approval_required":false}],"milestones":[{"title":"FX done","due_date":"2026-12-10","sequence":1,"related_service_keys":["fx_a"]}]}';
  bad_plan text := '{"summary":"Bad","services":[{"key":"fx_b","category":"flights","title":"FX flight","sequence":2,"depends_on":["missing"],"estimated_cost":10,"policy_status":"within_policy"}],"milestones":[]}';
  results jsonb := '[]';
  who text;
  uid uuid;
  i int;
  got text;
begin
  users := jsonb_build_object('rmc_admin', admin, 'consultant', consultant, 'hr_user', hr,
    'employee', employee, 'vendor', vendor, 'other_rmc_admin', other_admin);
  queries := jsonb_build_object(
    'rmc_tenants', format('select count(*) from public.rmc_tenants where id in (%L, %L)', t1, t2),
    'client_companies', format('select count(*) from public.client_companies where id in (%L, %L, %L)', c1, c2, c3),
    'profiles', 'select count(*) from public.profiles where email not like ''%@test.relo-os.test''',
    'assignments', 'select count(*) from public.assignments where id in ' || ids,
    'assignment_budgets', 'select count(*) from public.assignment_budgets where assignment_id in ' || ids,
    'assignment_consultants', 'select count(*) from public.assignment_consultants where assignment_id in ' || ids,
    'rmc_policies', format('select count(*) from public.rmc_policies where rmc_tenant_id in (%L, %L)', t1, t2),
    'relocation_plans', 'select count(*) from public.relocation_plans where assignment_id in ' || ids,
    'plan_services', 'select count(*) from public.plan_services where service_key like ''fx\_%''',
    'plan_milestones', 'select count(*) from public.plan_milestones where title like ''FX %''');

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
    insert into public.rmc_policies (rmc_tenant_id, config) values (t2, '{}');
    insert into public.relocation_plans (assignment_id, rmc_tenant_id, status)
      values (a1, t1, 'pending') on conflict (assignment_id) do nothing;
    insert into public.relocation_plans (assignment_id, rmc_tenant_id, status) values
      (a3, t1, 'pending'), (a4, t2, 'pending');
    insert into public.plan_services (assignment_id, rmc_tenant_id, service_key, category, title,
      sequence, estimated_cost, policy_status) values
      (a1, t1, 'fx_one', 'flights', 'FX 1', 1, 10, 'within_policy'),
      (a1, t1, 'fx_two', 'flights', 'FX 2', 2, 10, 'within_policy'),
      (a3, t1, 'fx_three', 'flights', 'FX 3', 1, 10, 'within_policy'),
      (a4, t2, 'fx_four', 'flights', 'FX 4', 1, 10, 'within_policy');
    insert into public.plan_milestones (assignment_id, rmc_tenant_id, title, due_date, sequence) values
      (a1, t1, 'FX m1', '2026-11-15', 1), (a3, t1, 'FX m3', '2026-12-01', 1), (a4, t2, 'FX m4', '2026-12-01', 1);

    -- a2 gets its plan through the real save function, run as HR
    insert into public.relocation_plans (assignment_id, rmc_tenant_id, status) values (a2, t1, 'pending');

    got := pg_temp.try_as(hr, format('select public.save_relocation_plan(%L, %L::jsonb, %L)', a2, good_plan, 'test'));
    results := results || jsonb_build_object('c', 'hr_user can save a plan for own company', 'e', 'ok', 'a', got);

    -- Visibility per role
    for who in select jsonb_object_keys(users) loop
      uid := (users ->> who)::uuid;
      for i in 1 .. array_length(tbl_names, 1) loop
        got := pg_temp.count_as(uid, queries ->> tbl_names[i])::text;
        results := results || jsonb_build_object('c', who || ' sees ' || tbl_names[i],
          'e', (expect ->> who)::jsonb ->> (i - 1), 'a', got);
      end loop;
      got := pg_temp.try_as(uid, format('update public.assignments set status = %L where id = %L', 'cancelled', a1));
      results := results || jsonb_build_object('c', who || ' cannot edit assignments directly', 'e', '42501', 'a', got);
      got := pg_temp.try_as(uid, format('insert into public.plan_services (assignment_id, rmc_tenant_id, service_key, category, title, sequence, estimated_cost, policy_status) values (%L, %L, %L, %L, %L, 1, 1, %L)', a1, t1, 'fx_hack', 'other', 'hack', 'within_policy'));
      results := results || jsonb_build_object('c', who || ' cannot insert services directly', 'e', '42501', 'a', got);
      got := pg_temp.try_as(uid, 'select public.reset_test_tenant_data()');
      results := results || jsonb_build_object('c', who || ' cannot wipe a non-test tenant', 'e', '42501', 'a', got);
    end loop;

    -- Cross-tenant spot checks
    got := pg_temp.count_as(admin, format('select count(*) from public.plan_services where assignment_id = %L', a4))::text;
    results := results || jsonb_build_object('c', 'rmc_admin cannot see other RMC services', 'e', '0', 'a', got);
    got := pg_temp.count_as(other_admin, format('select count(*) from public.assignments where id = %L', a1))::text;
    results := results || jsonb_build_object('c', 'other RMC admin cannot see demo assignment', 'e', '0', 'a', got);

    -- Creating requests: HR only, always into HR's own company, inputs checked
    foreach who in array array['rmc_admin', 'consultant', 'employee', 'vendor'] loop
      got := pg_temp.try_as((users ->> who)::uuid, 'select public.create_relocation_request(''X (fixture)'', 1, ''A'', ''B'', current_date + 30, 1000)');
      results := results || jsonb_build_object('c', who || ' cannot create a relocation request', 'e', '42501', 'a', got);
    end loop;
    got := pg_temp.try_as(hr, 'select public.create_relocation_request(''X (fixture)'', 0, ''A'', ''B'', current_date + 30, 1000)');
    results := results || jsonb_build_object('c', 'request with family size 0 is rejected', 'e', '22023', 'a', got);
    got := pg_temp.try_as(hr, 'select public.create_relocation_request(''X (fixture)'', 1, ''A'', ''B'', current_date - 1, 1000)');
    results := results || jsonb_build_object('c', 'request with past move date is rejected', 'e', '22023', 'a', got);
    got := pg_temp.try_as(hr, 'select public.create_relocation_request(''X (fixture)'', 1, ''Pune'', ''pune'', current_date + 30, 1000)');
    results := results || jsonb_build_object('c', 'request with same origin and destination is rejected', 'e', '22023', 'a', got);
    got := pg_temp.try_as(hr, 'select public.create_relocation_request(''New Person (fixture)'', 2, ''Chennai'', ''Doha'', current_date + 60, 900000)');
    results := results || jsonb_build_object('c', 'hr_user can create a request', 'e', 'ok', 'a', got);
    select count(*)::text into got from public.assignments a
      join public.assignment_budgets b on b.assignment_id = a.id
      join public.relocation_plans p on p.assignment_id = a.id
      where a.employee_name = 'New Person (fixture)' and a.client_company_id = c1 and a.rmc_tenant_id = t1
        and b.amount = 900000 and p.status = 'pending';
    results := results || jsonb_build_object('c', 'new request lands in HR''s company with budget and pending plan', 'e', '1', 'a', got);

    -- Saving plans: only people who can see the costed plan, never twice, never half-saved
    got := pg_temp.try_as(hr, format('select public.save_relocation_plan(%L, %L::jsonb, %L)', a2, good_plan, 'test'));
    results := results || jsonb_build_object('c', 'a ready plan cannot be overwritten', 'e', '55000', 'a', got);
    foreach who in array array['employee', 'vendor', 'other_rmc_admin'] loop
      got := pg_temp.try_as((users ->> who)::uuid, format('select public.save_relocation_plan(%L, %L::jsonb, %L)', a1, good_plan, 'test'));
      results := results || jsonb_build_object('c', who || ' cannot save a plan for the demo relocation', 'e', '42501', 'a', got);
      got := pg_temp.try_as((users ->> who)::uuid, format('select public.record_plan_failure(%L, %L)', a1, 'x'));
      results := results || jsonb_build_object('c', who || ' cannot mark the demo plan as failed', 'e', '42501', 'a', got);
    end loop;
    got := pg_temp.try_as(consultant, format('select public.save_relocation_plan(%L, %L::jsonb, %L)', a3, good_plan, 'test'));
    results := results || jsonb_build_object('c', 'consultant cannot save a plan for an unallocated relocation', 'e', '42501', 'a', got);
    got := pg_temp.try_as(hr, format('select public.save_relocation_plan(%L, %L::jsonb, %L)', a3, good_plan, 'test'));
    results := results || jsonb_build_object('c', 'hr_user cannot save a plan for another company', 'e', '42501', 'a', got);
    got := pg_temp.try_as(admin, format('select public.save_relocation_plan(%L, %L::jsonb, %L)', a3, bad_plan, 'test'));
    results := results || jsonb_build_object('c', 'a plan with an unknown dependency is rejected', 'e', '22023', 'a', got);
    select count(*)::text into got from public.plan_services where assignment_id = a3 and service_key = 'fx_b';
    results := results || jsonb_build_object('c', 'a rejected plan leaves nothing behind', 'e', '0', 'a', got);

    -- Logged-out visitors are refused outright.
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    foreach who in array tbl_names loop
      begin
        perform set_config('role', 'anon', true);
        execute format('select count(*) from public.%I', who);
        got := 'ok';
      exception when others then
        got := sqlstate;
      end;
      execute 'reset role';
      results := results || jsonb_build_object('c', 'logged-out visitor blocked from ' || who, 'e', '42501', 'a', got);
    end loop;
    begin
      perform set_config('role', 'anon', true);
      perform public.create_relocation_request('X', 1, 'A', 'B', current_date + 30, 1000);
      got := 'ok';
    exception when others then
      got := sqlstate;
    end;
    execute 'reset role';
    results := results || jsonb_build_object('c', 'logged-out visitor cannot create requests', 'e', '42501', 'a', got);

    raise exception 'rollback fixtures' using errcode = 'ZZ001';
  exception when sqlstate 'ZZ001' then
    null; -- fixtures undone
  end;

  return query
    select r ->> 'c', r ->> 'e', r ->> 'a', (r ->> 'e') = (r ->> 'a')
    from jsonb_array_elements(results) r;
end
$fn$;

select * from pg_temp.rls_role_access();
