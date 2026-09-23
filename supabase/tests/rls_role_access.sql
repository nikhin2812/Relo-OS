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

-- A save_relocation_plan call signed the way the app's server signs it
-- (see supabase/migrations/20260925000001_plan_signing.sql). p_age_ms makes an old signature.
create or replace function pg_temp.signed_save(a uuid, plan text, p_age_ms bigint default 0) returns text
language plpgsql as $$
declare
  k text;
  ts bigint := (extract(epoch from now()) * 1000)::bigint - p_age_ms;
begin
  select secret into k from private.plan_signing_key;
  return format('select public.save_relocation_plan(%L, %L, %L, %s, %L)', a, plan, 'test', ts,
    encode(extensions.hmac(convert_to(a::text || '.' || ts || '.test.' || plan, 'UTF8'),
      convert_to(k, 'UTF8'), 'sha256'), 'hex'));
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
  skyline uuid := '50000000-0000-0000-0000-000000000002';
  falcon uuid := '50000000-0000-0000-0000-000000000001';
  vx uuid := 'f0000000-0000-0000-0000-000000000031'; -- other RMC's vendor
  vy uuid := 'f0000000-0000-0000-0000-000000000032'; -- demo RMC, chosen for a1
  vz uuid := 'f0000000-0000-0000-0000-000000000033'; -- demo RMC, not chosen
  svc_one uuid := 'f0000000-0000-0000-0000-000000000041';
  svc_three uuid := 'f0000000-0000-0000-0000-000000000043';
  svc_imm uuid := 'f0000000-0000-0000-0000-000000000044';
  vendor_ids text;
  task_a1 uuid := 'f0000000-0000-0000-0000-000000000051';
  task_a3 uuid := 'f0000000-0000-0000-0000-000000000053';
  users jsonb;
  ids text := format('(%L::uuid, %L::uuid, %L::uuid, %L::uuid)', a1, a2, a3, a4);
  -- query per table, limited to rows this test controls
  queries jsonb;
  -- expected rows per role, in the order of `tbl_names`
  expect jsonb := jsonb_build_object(
    'rmc_admin',       '[1, 2, 5, 3, 3, 1, 1, 3, 5, 3, 2, 2, 3, 2, 4]',
    'consultant',      '[1, 1, 1, 1, 1, 1, 1, 1, 3, 1, 2, 2, 2, 1, 3]',
    'hr_user',         '[1, 1, 1, 2, 2, 0, 1, 2, 4, 2, 1, 0, 2, 1, 3]',
    'employee',        '[1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 0, 0, 2, 1, 3]',
    'vendor',          '[1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]',
    'other_rmc_admin', '[1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1]');
  tbl_names text[] := array['rmc_tenants', 'client_companies', 'profiles', 'assignments',
    'assignment_budgets', 'assignment_consultants', 'rmc_policies', 'relocation_plans',
    'plan_services', 'plan_milestones', 'vendors', 'vendor_rates', 'journey_tasks', 'documents',
    'stored_files'];
  good_plan text := '{"summary":"Fixture plan","services":[{"key":"fx_a","category":"immigration","title":"FX visa","sequence":1,"depends_on":[],"start_date":"2026-12-01","due_date":"2026-12-10","estimated_cost":1000,"policy_status":"within_policy","approval_required":false}],"milestones":[{"title":"FX done","due_date":"2026-12-10","sequence":1,"related_service_keys":["fx_a"]}]}';
  bad_plan text := '{"summary":"Bad","services":[{"key":"fx_b","category":"flights","title":"FX flight","sequence":2,"depends_on":["missing"],"estimated_cost":10,"policy_status":"within_policy"}],"milestones":[]}';
  results jsonb := '[]';
  who text;
  uid uuid;
  i int;
  got text;
begin
  vendor_ids := format('(%L::uuid, %L::uuid, %L::uuid)', vx, vy, vz);
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
    'plan_milestones', 'select count(*) from public.plan_milestones where title like ''FX %''',
    'vendors', 'select count(*) from public.vendors where id in ' || vendor_ids,
    'vendor_rates', 'select count(*) from public.vendor_rates where vendor_id in ' || vendor_ids,
    'journey_tasks', 'select count(*) from public.journey_tasks where title like ''FX %''',
    'documents', 'select count(*) from public.documents where file_name like ''FX %''',
    'stored_files', 'select count(*) from storage.objects where bucket_id = ''relocation-documents'' and name like ''%/fx-%''');

  begin
    -- A signing key for this run if the database has none yet (rolled back at the end)
    insert into private.plan_signing_key (id, secret) values (true, repeat('t', 64)) on conflict (id) do nothing;
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
    insert into public.vendors (id, rmc_tenant_id, name, contact_email) values
      (vx, t2, 'Other RMC Vendor (fixture)', 'vx@fixture.relo-os.test'),
      (vy, t1, 'Chosen Vendor (fixture)', 'vy@fixture.relo-os.test'),
      (vz, t1, 'Unchosen Vendor (fixture)', 'vz@fixture.relo-os.test');
    insert into public.vendor_rates (vendor_id, rmc_tenant_id, category, rate, rate_basis) values
      (vx, t2, 'flights', 1000, 'per_person'),
      (vy, t1, 'flights', 20000, 'per_person'),
      (vz, t1, 'flights', 50000, 'per_person');
    insert into public.plan_services (id, assignment_id, rmc_tenant_id, service_key, category, title,
      sequence, estimated_cost, policy_status, selected_vendor_id, agreed_cost) values
      (svc_one, a1, t1, 'fx_one', 'flights', 'FX 1', 1, 10, 'within_policy', vy, 60000),
      (gen_random_uuid(), a1, t1, 'fx_two', 'flights', 'FX 2', 2, 10, 'within_policy', null, null),
      (svc_imm, a1, t1, 'fx_imm', 'immigration', 'FX imm', 1, 10, 'within_policy', null, null),
      (svc_three, a3, t1, 'fx_three', 'flights', 'FX 3', 1, 10, 'within_policy', null, null),
      (gen_random_uuid(), a4, t2, 'fx_four', 'flights', 'FX 4', 1, 10, 'within_policy', null, null);
    insert into public.plan_milestones (assignment_id, rmc_tenant_id, title, due_date, sequence) values
      (a1, t1, 'FX m1', '2026-11-15', 1), (a3, t1, 'FX m3', '2026-12-01', 1), (a4, t2, 'FX m4', '2026-12-01', 1);
    insert into public.journey_tasks (id, assignment_id, rmc_tenant_id, service_key, title, due_date) values
      (task_a1, a1, t1, 'fx_one', 'FX task 1', '2026-11-01'),
      (gen_random_uuid(), a1, t1, 'fx_one', 'FX task 2', '2026-11-02'),
      (task_a3, a3, t1, 'fx_three', 'FX task 3', '2026-11-01'),
      (gen_random_uuid(), a4, t2, 'fx_four', 'FX task 4', '2026-11-01');
    insert into storage.objects (bucket_id, name, owner_id) values
      ('relocation-documents', a1 || '/fx-1.pdf', admin::text),
      ('relocation-documents', a3 || '/fx-3.pdf', admin::text),
      ('relocation-documents', a4 || '/fx-4.pdf', other_admin::text),
      ('relocation-documents', a1 || '/fx-employee.pdf', employee::text),
      ('relocation-documents', a1 || '/fx-hr.pdf', hr::text);
    insert into public.documents (assignment_id, rmc_tenant_id, kind, file_name, storage_path, mime_type, size_bytes) values
      (a1, t1, 'visa', 'FX doc 1', a1 || '/fx-1.pdf', 'application/pdf', 100),
      (a3, t1, 'visa', 'FX doc 3', a3 || '/fx-3.pdf', 'application/pdf', 100),
      (a4, t2, 'visa', 'FX doc 4', a4 || '/fx-4.pdf', 'application/pdf', 100);

    -- a2 gets its plan through the real save function, run as HR
    insert into public.relocation_plans (assignment_id, rmc_tenant_id, status) values (a2, t1, 'pending');

    got := pg_temp.try_as(hr, format('select public.save_relocation_plan(%L, %L, %L, %s, %L)', a2, good_plan, 'test',
      (extract(epoch from now()) * 1000)::bigint, repeat('0', 64)));
    results := results || jsonb_build_object('c', 'hr_user cannot save a hand-written (unsigned) plan', 'e', '42501', 'a', got);
    got := pg_temp.try_as(hr, pg_temp.signed_save(a2, good_plan, 20 * 60000));
    results := results || jsonb_build_object('c', 'a plan signed 20 minutes ago is refused', 'e', '42501', 'a', got);
    got := pg_temp.try_as(hr, replace(pg_temp.signed_save(a2, good_plan), 'FX visa', 'FX visa (edited)'));
    results := results || jsonb_build_object('c', 'a signed plan changed afterwards is refused', 'e', '42501', 'a', got);
    got := pg_temp.try_as(hr, pg_temp.signed_save(a2, good_plan));
    results := results || jsonb_build_object('c', 'hr_user can save a server-signed plan for own company', 'e', 'ok', 'a', got);
    foreach who in array array['rmc_admin', 'consultant', 'hr_user', 'employee', 'vendor'] loop
      got := pg_temp.try_as((users ->> who)::uuid, 'select count(*) from private.plan_signing_key');
      results := results || jsonb_build_object('c', who || ' cannot read the plan signing secret', 'e', '42501', 'a', got);
      got := pg_temp.try_as((users ->> who)::uuid, 'select private.new_plan_signing_secret()');
      results := results || jsonb_build_object('c', who || ' cannot make a new signing secret', 'e', '42501', 'a', got);
    end loop;

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

    -- The employee journey: no money in the services list, only own relocation
    select count(*)::text into got from pg_proc p, unnest(p.proargnames) n
      where p.proname = 'journey_services' and n ~* '(cost|budget|rate|price|policy|approval)';
    results := results || jsonb_build_object('c', 'journey_services returns no money or policy fields', 'e', '0', 'a', got);
    got := pg_temp.try_as(employee, format('select * from public.journey_services(%L)', a1));
    results := results || jsonb_build_object('c', 'employee can read own journey services', 'e', 'ok', 'a', got);
    got := pg_temp.count_as(employee, format('select count(*) from public.journey_services(%L) where service_key like %L', a1, 'fx\_%'))::text;
    results := results || jsonb_build_object('c', 'employee journey lists own services', 'e', '3', 'a', got);
    foreach who in array array['employee', 'vendor'] loop
      got := pg_temp.try_as((users ->> who)::uuid, format('select * from public.journey_services(%L)', a3));
      results := results || jsonb_build_object('c', who || ' cannot read another relocation''s journey', 'e', '42501', 'a', got);
    end loop;
    got := pg_temp.try_as(vendor, format('select * from public.journey_services(%L)', a1));
    results := results || jsonb_build_object('c', 'vendor cannot read the demo journey', 'e', '42501', 'a', got);

    -- To-dos: employee ticks own; nobody touches another relocation's
    got := pg_temp.try_as(employee, format('select public.set_journey_task_done(%L, true)', task_a1));
    results := results || jsonb_build_object('c', 'employee can tick off own to-do', 'e', 'ok', 'a', got);
    select status into got from public.journey_tasks where id = task_a1;
    results := results || jsonb_build_object('c', 'ticked to-do is done', 'e', 'done', 'a', got);
    got := pg_temp.try_as(employee, format('select public.set_journey_task_done(%L, true)', task_a3));
    results := results || jsonb_build_object('c', 'employee cannot tick another relocation''s to-do', 'e', '42501', 'a', got);
    foreach who in array array['vendor', 'other_rmc_admin'] loop
      got := pg_temp.try_as((users ->> who)::uuid, format('select public.set_journey_task_done(%L, false)', task_a1));
      results := results || jsonb_build_object('c', who || ' cannot change the demo to-dos', 'e', '42501', 'a', got);
    end loop;
    got := pg_temp.try_as(employee, format('update public.journey_tasks set status = %L where id = %L', 'todo', task_a1));
    results := results || jsonb_build_object('c', 'to-dos cannot be edited directly', 'e', '42501', 'a', got);

    -- Documents: upload into own relocation only; register only own uploaded files
    got := pg_temp.try_as(employee, format('insert into storage.objects (bucket_id, name, owner_id) values (%L, %L, %L)', 'relocation-documents', a3 || '/fx-sneaky.pdf', employee));
    results := results || jsonb_build_object('c', 'employee cannot upload into another relocation', 'e', '42501', 'a', got);
    got := pg_temp.try_as(vendor, format('insert into storage.objects (bucket_id, name, owner_id) values (%L, %L, %L)', 'relocation-documents', a1 || '/fx-vendor.pdf', vendor));
    results := results || jsonb_build_object('c', 'vendor cannot upload into the demo relocation', 'e', '42501', 'a', got);
    got := pg_temp.try_as(employee, format('select public.register_document(%L, null, %L, %L, %L, %L, 10)', a1, 'identity', 'FX passport', a1 || '/fx-employee.pdf', 'application/pdf'));
    results := results || jsonb_build_object('c', 'employee can register own uploaded file', 'e', 'ok', 'a', got);
    got := pg_temp.try_as(employee, format('select public.register_document(%L, null, %L, %L, %L, %L, 10)', a1, 'identity', 'FX not mine', a1 || '/fx-hr.pdf', 'application/pdf'));
    results := results || jsonb_build_object('c', 'employee cannot register a file someone else uploaded', 'e', '22023', 'a', got);
    got := pg_temp.try_as(employee, format('select public.register_document(%L, null, %L, %L, %L, %L, 10)', a1, 'identity', 'FX missing', a1 || '/fx-missing.pdf', 'application/pdf'));
    results := results || jsonb_build_object('c', 'a file that was never uploaded cannot be registered', 'e', '22023', 'a', got);
    got := pg_temp.try_as(employee, format('select public.register_document(%L, null, %L, %L, %L, %L, 10)', a1, 'identity', 'FX wrong place', a3 || '/fx-3.pdf', 'application/pdf'));
    results := results || jsonb_build_object('c', 'a file stored under another relocation cannot be registered', 'e', '22023', 'a', got);
    got := pg_temp.try_as(employee, format('select public.register_document(%L, null, %L, %L, %L, %L, 10)', a3, 'identity', 'FX other', a3 || '/fx-3.pdf', 'application/pdf'));
    results := results || jsonb_build_object('c', 'employee cannot add documents to another relocation', 'e', '42501', 'a', got);
    got := pg_temp.try_as(vendor, format('select public.register_document(%L, null, %L, %L, %L, %L, 10)', a1, 'other', 'FX vendor', a1 || '/fx-1.pdf', 'application/pdf'));
    results := results || jsonb_build_object('c', 'vendor cannot add documents to the demo relocation', 'e', '42501', 'a', got);
    got := pg_temp.try_as(employee, format('delete from public.documents where storage_path = %L', a1 || '/fx-1.pdf'));
    results := results || jsonb_build_object('c', 'documents cannot be deleted directly', 'e', '42501', 'a', got);

    -- HR can link a relocation to an employee at its own company only
    got := pg_temp.try_as(hr, 'select public.create_relocation_request(''Linked (fixture)'', 1, ''Pune'', ''Doha'', current_date + 30, 1000, ''EMPLOYEE@demo.relo-os.test'')');
    results := results || jsonb_build_object('c', 'hr_user can link an employee at own company', 'e', 'ok', 'a', got);
    select count(*)::text into got from public.assignments where employee_name = 'Linked (fixture)' and employee_profile_id = employee;
    results := results || jsonb_build_object('c', 'linked relocation belongs to that employee', 'e', '1', 'a', got);
    got := pg_temp.try_as(hr, 'select public.create_relocation_request(''Linked (fixture)'', 1, ''Pune'', ''Doha'', current_date + 30, 1000, ''e2e-employee@test.relo-os.test'')');
    results := results || jsonb_build_object('c', 'hr_user cannot link an employee from another company', 'e', '22023', 'a', got);
    got := pg_temp.try_as(hr, 'select public.create_relocation_request(''Linked (fixture)'', 1, ''Pune'', ''Doha'', current_date + 30, 1000, ''consultant@demo.relo-os.test'')');
    results := results || jsonb_build_object('c', 'hr_user cannot link a non-employee login', 'e', '22023', 'a', got);

    -- Vendors see their own company only
    got := pg_temp.count_as(vendor, format('select count(*) from public.vendors where id = %L', skyline))::text;
    results := results || jsonb_build_object('c', 'vendor sees own vendor company', 'e', '1', 'a', got);
    got := pg_temp.count_as(vendor, format('select count(*) from public.vendors where id = %L', falcon))::text;
    results := results || jsonb_build_object('c', 'vendor cannot see other vendors', 'e', '0', 'a', got);

    -- Picking providers: RMC admin or allocated consultant; price comes from the rate card
    got := pg_temp.try_as(consultant, format('select public.select_service_provider(%L, %L)', svc_one, vz));
    results := results || jsonb_build_object('c', 'allocated consultant can choose a provider', 'e', 'ok', 'a', got);
    select agreed_cost::text || ' ' || agreed_over_cap::text into got from public.plan_services where id = svc_one;
    results := results || jsonb_build_object('c', 'agreed cost is rate x family and flagged over the cap', 'e', '150000.00 true', 'a', got);
    got := pg_temp.try_as(admin, format('select public.select_service_provider(%L, %L)', svc_one, vy));
    select agreed_cost::text || ' ' || agreed_over_cap::text into got from public.plan_services where id = svc_one;
    results := results || jsonb_build_object('c', 'changing to a cheaper provider clears the over-cap flag', 'e', '60000.00 false', 'a', got);
    got := pg_temp.try_as(consultant, format('select public.select_service_provider(%L, %L)', svc_three, vy));
    results := results || jsonb_build_object('c', 'consultant cannot choose for an unallocated relocation', 'e', '42501', 'a', got);
    foreach who in array array['hr_user', 'employee', 'vendor', 'other_rmc_admin'] loop
      got := pg_temp.try_as((users ->> who)::uuid, format('select public.select_service_provider(%L, %L)', svc_one, vz));
      results := results || jsonb_build_object('c', who || ' cannot choose providers', 'e', '42501', 'a', got);
    end loop;
    got := pg_temp.try_as(admin, format('select public.select_service_provider(%L, %L)', svc_one, vx));
    results := results || jsonb_build_object('c', 'another RMC''s vendor cannot be chosen', 'e', '22023', 'a', got);
    got := pg_temp.try_as(admin, format('select public.select_service_provider(%L, %L)', svc_imm, skyline));
    results := results || jsonb_build_object('c', 'a vendor without a rate for the service cannot be chosen', 'e', '22023', 'a', got);
    got := pg_temp.try_as(admin, format('update public.plan_services set agreed_cost = 1 where id = %L', svc_one));
    results := results || jsonb_build_object('c', 'agreed cost cannot be edited directly', 'e', '42501', 'a', got);

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
    got := pg_temp.try_as(hr, pg_temp.signed_save(a2, good_plan));
    results := results || jsonb_build_object('c', 'a ready plan cannot be overwritten', 'e', '55000', 'a', got);
    foreach who in array array['employee', 'vendor', 'other_rmc_admin'] loop
      got := pg_temp.try_as((users ->> who)::uuid, pg_temp.signed_save(a1, good_plan));
      results := results || jsonb_build_object('c', who || ' cannot save a plan for the demo relocation', 'e', '42501', 'a', got);
      got := pg_temp.try_as((users ->> who)::uuid, format('select public.record_plan_failure(%L, %L)', a1, 'x'));
      results := results || jsonb_build_object('c', who || ' cannot mark the demo plan as failed', 'e', '42501', 'a', got);
    end loop;
    got := pg_temp.try_as(consultant, pg_temp.signed_save(a3, good_plan));
    results := results || jsonb_build_object('c', 'consultant cannot save a plan for an unallocated relocation', 'e', '42501', 'a', got);
    got := pg_temp.try_as(hr, pg_temp.signed_save(a3, good_plan));
    results := results || jsonb_build_object('c', 'hr_user cannot save a plan for another company', 'e', '42501', 'a', got);
    got := pg_temp.try_as(admin, pg_temp.signed_save(a3, bad_plan));
    results := results || jsonb_build_object('c', 'a plan with an unknown dependency is rejected', 'e', '22023', 'a', got);
    select count(*)::text into got from public.plan_services where assignment_id = a3 and service_key = 'fx_b';
    results := results || jsonb_build_object('c', 'a rejected plan leaves nothing behind', 'e', '0', 'a', got);

    -- Logged-out visitors are refused outright.
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    foreach who in array array_remove(tbl_names, 'stored_files') loop
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
    begin
      perform set_config('role', 'anon', true);
      select count(*)::text into got from storage.objects where bucket_id = 'relocation-documents';
    exception when others then
      got := sqlstate;
    end;
    execute 'reset role';
    results := results || jsonb_build_object('c', 'logged-out visitor sees no stored files', 'e', '0', 'a', got);

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
