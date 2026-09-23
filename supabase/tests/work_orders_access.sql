-- Work orders, approvals and the provider portal (Session 5).
-- Uses the demo relocation's sample plan plus a second RMC as fixtures, then
-- rolls everything back. Every row must have pass = true.

create or replace function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

create or replace function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('role', 'anon', true);
end $$;

-- Runs a statement as someone; returns 'ok', the SQL error code, or the single value it returns.
create or replace function pg_temp.run(uid uuid, stmt text) returns text language plpgsql as $$
declare v text;
begin
  if uid is null then perform pg_temp.as_anon(); else perform pg_temp.as_user(uid); end if;
  if stmt ~* '^\s*select' then
    execute stmt into v;
  else
    execute stmt;
  end if;
  execute 'reset role';
  return coalesce(nullif(v, ''), 'ok');
exception when others then
  return sqlstate;
end $$;

create or replace function pg_temp.work_orders_access()
returns table (check_name text, expected text, actual text, pass boolean)
language plpgsql as $fn$
declare
  t1 uuid := '10000000-0000-0000-0000-000000000001';
  a1 uuid := '40000000-0000-0000-0000-000000000001';
  admin uuid := '30000000-0000-0000-0000-000000000001';
  consultant uuid := '30000000-0000-0000-0000-000000000002';
  hr uuid := '30000000-0000-0000-0000-000000000003';
  employee uuid := '30000000-0000-0000-0000-000000000004';
  vendor uuid := '30000000-0000-0000-0000-000000000005';
  skyline uuid := '50000000-0000-0000-0000-000000000002';
  palm uuid := '50000000-0000-0000-0000-000000000003';
  falcon uuid := '50000000-0000-0000-0000-000000000001';
  t2 uuid := 'f0000000-0000-0000-0000-000000000001';
  c3 uuid := 'f0000000-0000-0000-0000-000000000003';
  a4 uuid := 'f0000000-0000-0000-0000-000000000014';
  other_admin uuid := 'f0000000-0000-0000-0000-000000000021';
  vx uuid := 'f0000000-0000-0000-0000-000000000031';
  svc_x uuid := 'f0000000-0000-0000-0000-000000000045';
  wo_x uuid := 'f0000000-0000-0000-0000-000000000061';
  tok_a text := 'test-token-flights-0123456789abcdefghijklmnop';
  tok_b text := 'test-token-housing-0123456789abcdefghijklmnop';
  hash_a text;
  hash_b text;
  svc_f uuid; svc_h uuid; svc_s uuid; wo_h uuid;
  wo_ids text;
  results jsonb := '[]';
  who text;
  got text;
  users jsonb := jsonb_build_object('rmc_admin', admin, 'consultant', consultant, 'hr_user', hr,
    'employee', employee, 'vendor', vendor, 'other_rmc_admin', other_admin);
  -- expected rows: work_orders, work_order_events
  expect jsonb := jsonb_build_object('rmc_admin', '[2, 2]', 'consultant', '[2, 2]', 'hr_user', '[2, 2]',
    'employee', '[0, 0]', 'vendor', '[1, 0]', 'other_rmc_admin', '[1, 1]');
begin
  hash_a := encode(extensions.digest(convert_to(tok_a, 'UTF8'), 'sha256'), 'hex');
  hash_b := encode(extensions.digest(convert_to(tok_b, 'UTF8'), 'sha256'), 'hex');
  select id into svc_f from public.plan_services where assignment_id = a1 and service_key = 'flights';
  select id into svc_h from public.plan_services where assignment_id = a1 and service_key = 'temp_housing';
  select id into svc_s from public.plan_services where assignment_id = a1 and service_key = 'settling_in';

  begin
    -- A clean slate on the demo relocation's services (undone at the end)
    delete from public.work_orders where assignment_id = a1;
    update public.plan_services set selected_vendor_id = null, agreed_cost = null, agreed_over_cap = false,
      approved_at = null, approved_by = null where assignment_id = a1;

    -- Second RMC with one work order of its own
    insert into public.rmc_tenants (id, name) values (t2, 'Other Test RMC (fixture)');
    insert into public.client_companies (id, rmc_tenant_id, name) values (c3, t2, 'Other RMC Company (fixture)');
    insert into auth.users (id, aud, role, email) values (other_admin, 'authenticated', 'authenticated', 'other-admin@fixture.relo-os.test');
    insert into public.profiles (id, rmc_tenant_id, role, full_name, email) values
      (other_admin, t2, 'rmc_admin', 'Other Admin (fixture)', 'other-admin@fixture.relo-os.test');
    insert into public.assignments (id, rmc_tenant_id, client_company_id, employee_name, family_size, origin, destination, move_date)
      values (a4, t2, c3, 'Other RMC Person (fixture)', 1, 'Mumbai', 'Berlin', '2026-12-01');
    insert into public.vendors (id, rmc_tenant_id, name, contact_email) values (vx, t2, 'Other Vendor (fixture)', 'vx@fixture.relo-os.test');
    insert into public.plan_services (id, assignment_id, rmc_tenant_id, service_key, category, title, sequence, estimated_cost, policy_status, selected_vendor_id, agreed_cost)
      values (svc_x, a4, t2, 'fx_x', 'flights', 'FX flights', 1, 10, 'within_policy', vx, 10);
    insert into public.work_orders (id, service_id, assignment_id, rmc_tenant_id, vendor_id, agreed_cost, details, token_hash, token_expires_at)
      values (wo_x, svc_x, a4, t2, vx, 10, '{}', repeat('a', 64), now() + interval '1 day');
    insert into public.work_order_events (work_order_id, rmc_tenant_id, event, actor) values (wo_x, t2, 'sent', 'staff');

    -- Sending work orders
    got := pg_temp.run(hr, format('select public.select_service_provider(%L, %L)', svc_f, skyline));
    results := results || jsonb_build_object('c', 'hr_user cannot choose providers', 'e', '42501', 'a', got);
    got := pg_temp.run(consultant, format('select public.create_work_order(%L, %L)', svc_f, hash_a));
    results := results || jsonb_build_object('c', 'no work order before a provider is chosen', 'e', '55000', 'a', got);
    perform pg_temp.run(consultant, format('select public.select_service_provider(%L, %L)', svc_f, skyline));
    got := pg_temp.run(consultant, format('select left(public.create_work_order(%L, %L), 3)', svc_f, hash_a));
    results := results || jsonb_build_object('c', 'allocated consultant sends a work order', 'e', 'WO-', 'a', got);
    got := pg_temp.run(consultant, format('select public.create_work_order(%L, %L)', svc_f, repeat('c', 64)));
    results := results || jsonb_build_object('c', 'only one live work order per service', 'e', '55000', 'a', got);
    got := pg_temp.run(consultant, format('select public.select_service_provider(%L, %L)', svc_f, falcon));
    results := results || jsonb_build_object('c', 'provider cannot change while a work order is out', 'e', '55000', 'a', got);
    got := pg_temp.run(consultant, format('select public.create_work_order(%L, %L)', svc_s, 'not-a-hash'));
    results := results || jsonb_build_object('c', 'a malformed link hash is refused', 'e', '22023', 'a', got);
    foreach who in array array['hr_user', 'employee', 'vendor', 'other_rmc_admin'] loop
      got := pg_temp.run((users ->> who)::uuid, format('select public.create_work_order(%L, %L)', svc_s, repeat('d', 64)));
      results := results || jsonb_build_object('c', who || ' cannot send work orders', 'e', '42501', 'a', got);
    end loop;

    -- Approval before a work order goes out
    perform pg_temp.run(consultant, format('select public.select_service_provider(%L, %L)', svc_h, palm));
    got := pg_temp.run(consultant, format('select public.create_work_order(%L, %L)', svc_h, hash_b));
    results := results || jsonb_build_object('c', 'a service needing approval cannot be ordered unapproved', 'e', '55000', 'a', got);
    foreach who in array array['consultant', 'hr_user', 'employee', 'vendor', 'other_rmc_admin'] loop
      got := pg_temp.run((users ->> who)::uuid, format('select public.approve_service(%L)', svc_h));
      results := results || jsonb_build_object('c', who || ' cannot approve', 'e', '42501', 'a', got);
    end loop;
    got := pg_temp.run(admin, format('select public.approve_service(%L)', svc_h));
    results := results || jsonb_build_object('c', 'RMC admin approves', 'e', 'ok', 'a', got);
    perform pg_temp.run(consultant, format('select public.select_service_provider(%L, %L)', svc_h, falcon));
    select coalesce(approved_at::text, 'cleared') into got from public.plan_services where id = svc_h;
    results := results || jsonb_build_object('c', 'changing provider clears the approval', 'e', 'cleared', 'a', got);
    perform pg_temp.run(consultant, format('select public.select_service_provider(%L, %L)', svc_h, palm));
    perform pg_temp.run(admin, format('select public.approve_service(%L)', svc_h));
    got := pg_temp.run(consultant, format('select left(public.create_work_order(%L, %L), 3)', svc_h, hash_b));
    results := results || jsonb_build_object('c', 'approved service can be ordered', 'e', 'WO-', 'a', got);

    -- Who sees work orders and their history
    wo_ids := format('(select id from public.work_orders where assignment_id in (%L, %L))', a1, a4);
    for who in select jsonb_object_keys(users) loop
      got := pg_temp.run((users ->> who)::uuid, format('select count(*) from public.work_orders where id in %s', wo_ids));
      results := results || jsonb_build_object('c', who || ' sees work_orders', 'e', (expect ->> who)::jsonb ->> 0, 'a', got);
      got := pg_temp.run((users ->> who)::uuid, format('select count(*) from public.work_order_events where work_order_id in %s', wo_ids));
      results := results || jsonb_build_object('c', who || ' sees work_order_events', 'e', (expect ->> who)::jsonb ->> 1, 'a', got);
      got := pg_temp.run((users ->> who)::uuid, 'select count(token_hash) from public.work_orders');
      results := results || jsonb_build_object('c', who || ' cannot read link hashes', 'e', '42501', 'a', got);
      got := pg_temp.run((users ->> who)::uuid, format('update public.work_orders set status = %L where service_id = %L', 'booked', svc_f));
      results := results || jsonb_build_object('c', who || ' cannot edit work orders directly', 'e', '42501', 'a', got);
    end loop;
    got := pg_temp.run(vendor, format('select count(*) from public.work_orders where vendor_id = %L', palm));
    results := results || jsonb_build_object('c', 'vendor cannot see another vendor''s work orders', 'e', '0', 'a', got);
    got := pg_temp.run(null, 'select count(*) from public.work_orders');
    results := results || jsonb_build_object('c', 'logged-out visitor cannot read work orders', 'e', '42501', 'a', got);

    -- The portal, with no account
    got := pg_temp.run(null, format('select public.portal_get_work_order(%L) ->> %L', tok_a, 'vendor_name'));
    results := results || jsonb_build_object('c', 'portal opens with the right link', 'e', 'Skyline Moves & Travel (Demo)', 'a', got);
    got := pg_temp.run(null, format('select public.portal_get_work_order(%L) ? %L', tok_a, 'token_hash'));
    results := results || jsonb_build_object('c', 'portal never returns the link hash', 'e', 'false', 'a', got);
    got := pg_temp.run(null, format('select public.portal_get_work_order(%L)', tok_a || 'x'));
    results := results || jsonb_build_object('c', 'a wrong link opens nothing', 'e', 'P0002', 'a', got);
    got := pg_temp.run(null, 'select public.portal_get_work_order(''short'')');
    results := results || jsonb_build_object('c', 'a too-short link opens nothing', 'e', 'P0002', 'a', got);
    got := pg_temp.run(null, format('select public.portal_get_work_order(%L)', hash_a));
    results := results || jsonb_build_object('c', 'the hash itself does not work as a link', 'e', 'P0002', 'a', got);
    got := pg_temp.run(null, format('select public.portal_update_work_order(%L, %L)', tok_a, 'complete'));
    results := results || jsonb_build_object('c', 'cannot complete before booking', 'e', '55000', 'a', got);
    got := pg_temp.run(null, format('select public.portal_update_work_order(%L, %L)', tok_a, 'accept'));
    results := results || jsonb_build_object('c', 'provider accepts', 'e', 'accepted', 'a', got);
    got := pg_temp.run(null, format('select public.portal_update_work_order(%L, %L, %L, %L)', tok_a, 'book', '  ', current_date + 30));
    results := results || jsonb_build_object('c', 'booking needs a reference', 'e', '22023', 'a', got);
    got := pg_temp.run(null, format('select public.portal_update_work_order(%L, %L, %L, %L, %L)', tok_a, 'book', 'SKY-TEST-1', current_date + 30, 'Seats confirmed'));
    results := results || jsonb_build_object('c', 'provider books', 'e', 'booked', 'a', got);
    got := pg_temp.run(null, format('select public.portal_update_work_order(%L, %L)', tok_a, 'decline'));
    results := results || jsonb_build_object('c', 'a booked job cannot be declined', 'e', '55000', 'a', got);
    got := pg_temp.run(employee, format('select work_status || %L || booking_reference from public.journey_services(%L) where id = %L', ' ', a1, svc_f));
    results := results || jsonb_build_object('c', 'employee journey shows the booking', 'e', 'booked SKY-TEST-1', 'a', got);

    -- Portal uploads: only into the folder matching the link
    got := pg_temp.run(null, format('insert into storage.objects (bucket_id, name) values (%L, %L) ', 'relocation-documents', a1 || '/portal/' || hash_a || '/fx-booking.pdf'));
    results := results || jsonb_build_object('c', 'portal upload with a matching link folder', 'e', 'ok', 'a', got);
    got := pg_temp.run(null, format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'relocation-documents', a1 || '/portal/' || repeat('e', 64) || '/fx.pdf'));
    results := results || jsonb_build_object('c', 'portal upload into a made-up folder is refused', 'e', '42501', 'a', got);
    got := pg_temp.run(null, format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'relocation-documents', a1 || '/fx-anon.pdf'));
    results := results || jsonb_build_object('c', 'logged-out upload outside the portal is refused', 'e', '42501', 'a', got);
    got := pg_temp.run(employee, format('insert into storage.objects (bucket_id, name, owner_id) values (%L, %L, %L)', 'relocation-documents', a1 || '/portal/x/fx.pdf', employee));
    results := results || jsonb_build_object('c', 'employee cannot write into portal folders', 'e', '42501', 'a', got);
    got := pg_temp.run(null, format('select public.portal_register_document(%L, %L, %L, %L, 100) is not null', tok_a, a1 || '/portal/' || hash_a || '/fx-booking.pdf', 'FX booking.pdf', 'application/pdf'));
    results := results || jsonb_build_object('c', 'provider registers the uploaded document', 'e', 'true', 'a', got);
    got := pg_temp.run(null, format('select public.portal_register_document(%L, %L, %L, %L, 100)', tok_a, a1 || '/fx-other.pdf', 'FX', 'application/pdf'));
    results := results || jsonb_build_object('c', 'provider cannot register files outside its folder', 'e', '22023', 'a', got);
    got := pg_temp.run(hr, 'select count(*) from public.documents where file_name = ''FX booking.pdf''');
    results := results || jsonb_build_object('c', 'HR sees the provider''s document', 'e', '1', 'a', got);
    got := pg_temp.run(employee, 'select count(*) from public.documents where file_name = ''FX booking.pdf''');
    results := results || jsonb_build_object('c', 'employee does not see provider documents (may show prices)', 'e', '0', 'a', got);
    got := pg_temp.run(employee, format('select count(*) from storage.objects where name = %L', a1 || '/portal/' || hash_a || '/fx-booking.pdf'));
    results := results || jsonb_build_object('c', 'employee cannot open the provider''s file', 'e', '0', 'a', got);
    got := pg_temp.run(hr, format('select count(*) from storage.objects where name = %L', a1 || '/portal/' || hash_a || '/fx-booking.pdf'));
    results := results || jsonb_build_object('c', 'HR can open the provider''s file', 'e', '1', 'a', got);

    -- Expired and renewed links
    select id into wo_h from public.work_orders where token_hash = hash_b;
    update public.work_orders set token_expires_at = now() - interval '1 minute' where id = wo_h;
    got := pg_temp.run(null, format('select public.portal_get_work_order(%L)', tok_b));
    results := results || jsonb_build_object('c', 'an expired link opens nothing', 'e', 'P0002', 'a', got);
    got := pg_temp.run(consultant, format('select public.renew_work_order_link(%L, %L)', wo_h, repeat('f', 64)));
    results := results || jsonb_build_object('c', 'consultant renews the link', 'e', 'ok', 'a', got);
    got := pg_temp.run(vendor, format('select public.renew_work_order_link(%L, %L)', wo_h, repeat('b', 64)));
    results := results || jsonb_build_object('c', 'vendor cannot renew links', 'e', '42501', 'a', got);

    raise exception 'rollback fixtures' using errcode = 'ZZ001';
  exception when sqlstate 'ZZ001' then
    null; -- fixtures undone
  end;

  return query
    select r ->> 'c', r ->> 'e', r ->> 'a', (r ->> 'e') = (r ->> 'a')
    from jsonb_array_elements(results) r;
end
$fn$;

select * from pg_temp.work_orders_access();
