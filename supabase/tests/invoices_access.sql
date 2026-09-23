-- Invoices and reconciliation (Session 6). Uses the demo relocation's booked
-- flights and shipment work orders plus a second RMC, then rolls everything back.
-- Every row must have pass = true. Needs pg_temp.run from work_orders_access.sql
-- (redefined here so this file runs on its own).

create or replace function pg_temp.run(uid uuid, stmt text) returns text language plpgsql as $$
declare v text;
begin
  if uid is null then
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    perform set_config('role', 'anon', true);
  else
    perform set_config('request.jwt.claims', jsonb_build_object('sub', uid, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
  end if;
  if stmt ~* '^\s*select' then execute stmt into v; else execute stmt; end if;
  execute 'reset role';
  return coalesce(nullif(v, ''), 'ok');
exception when others then
  return sqlstate;
end $$;

create or replace function pg_temp.invoices_access()
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
  t2 uuid := 'f0000000-0000-0000-0000-000000000001';
  c3 uuid := 'f0000000-0000-0000-0000-000000000003';
  a4 uuid := 'f0000000-0000-0000-0000-000000000014';
  other_admin uuid := 'f0000000-0000-0000-0000-000000000021';
  vx uuid := 'f0000000-0000-0000-0000-000000000031';
  svc_x uuid := 'f0000000-0000-0000-0000-000000000045';
  wo_x uuid := 'f0000000-0000-0000-0000-000000000061';
  tok text := 'test-token-invoice-0123456789abcdefghijklmnop';
  wo_f uuid; wo_g uuid; wo_h uuid; svc_h uuid;
  inv_1 uuid; inv_2 uuid;
  results jsonb := '[]';
  who text;
  got text;
  users jsonb := jsonb_build_object('rmc_admin', admin, 'consultant', consultant, 'hr_user', hr,
    'employee', employee, 'vendor', vendor, 'other_rmc_admin', other_admin);
  -- invoices visible out of FX-1 (demo relocation, Skyline) and FX-OTHER (other RMC)
  expect jsonb := jsonb_build_object('rmc_admin', '1', 'consultant', '1', 'hr_user', '1',
    'employee', '0', 'vendor', '1', 'other_rmc_admin', '1');
begin
  select w.id into wo_f from public.work_orders w join public.plan_services s on s.id = w.service_id
    where s.assignment_id = a1 and s.service_key = 'flights' and w.status = 'booked';
  select w.id into wo_g from public.work_orders w join public.plan_services s on s.id = w.service_id
    where s.assignment_id = a1 and s.service_key = 'household_goods' and w.status = 'booked';
  select id into svc_h from public.plan_services where assignment_id = a1 and service_key = 'temp_housing';
  if wo_f is null or wo_g is null then
    raise exception 'Demo work orders for flights and household goods are missing: run the seed first';
  end if;

  begin
    -- Clean slate for invoices on the demo relocation (undone at the end)
    delete from public.invoices where assignment_id = a1;

    -- Second RMC with one invoice of its own
    insert into public.rmc_tenants (id, name) values (t2, 'Other Test RMC (fixture)');
    insert into public.client_companies (id, rmc_tenant_id, name) values (c3, t2, 'Other RMC Company (fixture)');
    insert into auth.users (id, aud, role, email) values (other_admin, 'authenticated', 'authenticated', 'other-admin@fixture.relo-os.test');
    insert into public.profiles (id, rmc_tenant_id, role, full_name, email) values
      (other_admin, t2, 'rmc_admin', 'Other Admin (fixture)', 'other-admin@fixture.relo-os.test');
    insert into public.assignments (id, rmc_tenant_id, client_company_id, employee_name, family_size, origin, destination, move_date)
      values (a4, t2, c3, 'Other RMC Person (fixture)', 1, 'Mumbai', 'Berlin', '2026-12-01');
    insert into public.assignment_budgets (assignment_id, rmc_tenant_id, amount) values (a4, t2, 100000);
    insert into public.vendors (id, rmc_tenant_id, name, contact_email) values (vx, t2, 'Other Vendor (fixture)', 'vx@fixture.relo-os.test');
    insert into public.plan_services (id, assignment_id, rmc_tenant_id, service_key, category, title, sequence, estimated_cost, policy_status, selected_vendor_id, agreed_cost)
      values (svc_x, a4, t2, 'fx_x', 'flights', 'FX flights', 1, 10, 'within_policy', vx, 10);
    insert into public.work_orders (id, service_id, assignment_id, rmc_tenant_id, vendor_id, agreed_cost, details, status, token_hash, token_expires_at)
      values (wo_x, svc_x, a4, t2, vx, 10, '{}', 'booked', repeat('a', 64), now() + interval '1 day');
    perform private.record_invoice(wo_x, 'FX-OTHER', current_date, 10, 'staff', null, null);

    -- A work order that has only been sent, not booked
    update public.plan_services set selected_vendor_id = '50000000-0000-0000-0000-000000000003', agreed_cost = 330000 where id = svc_h;
    insert into public.work_orders (service_id, assignment_id, rmc_tenant_id, vendor_id, agreed_cost, details, status, token_hash, token_expires_at)
      values (svc_h, a1, t1, '50000000-0000-0000-0000-000000000003', 330000, '{}', 'sent', repeat('b', 64), now() + interval '1 day')
      returning id into wo_h;

    -- The spec's demo case: 8% over the agreed ₹1,08,000
    got := pg_temp.run(consultant, format('select public.record_invoice(%L, %L, current_date, 116640) is not null', wo_f, 'FX-1'));
    results := results || jsonb_build_object('c', 'allocated consultant records an invoice', 'e', 'true', 'a', got);
    select id, status || ' ' || array_to_string(flags, ',') || ' ' || variance_amount || ' ' || variance_pct
      into inv_1, got from public.invoices where invoice_number = 'FX-1';
    results := results || jsonb_build_object('c', 'invoice 8% over the agreed rate is flagged with the difference',
      'e', 'flagged over_agreed_rate 8640.00 8.00', 'a', got);
    select agreed_amount || ' ' || tolerance_pct || ' ' || budget_amount into got from public.invoices where id = inv_1;
    results := results || jsonb_build_object('c', 'invoice is matched to the agreed price, tolerance and budget', 'e', '108000.00 2.00 1500000.00', 'a', got);

    -- Within the 2% tolerance: matched
    got := pg_temp.run(consultant, format('select public.record_invoice(%L, %L, current_date, 372000) is not null', wo_g, 'FX-2'));
    select status || ' ' || variance_pct into got from public.invoices where invoice_number = 'FX-2';
    results := results || jsonb_build_object('c', 'invoice 1.9% over (inside the 2% tolerance) is matched', 'e', 'matched 1.92', 'a', got);

    -- Same number again from the same vendor
    perform pg_temp.run(admin, format('select public.record_invoice(%L, %L, current_date, 1)', wo_f, 'fx-1'));
    select (flags @> array['duplicate_number'])::text into got from public.invoices where invoice_number = 'fx-1';
    results := results || jsonb_build_object('c', 'a repeated invoice number is flagged', 'e', 'true', 'a', got);
    select invoiced_to_date::text into got from public.invoices where invoice_number = 'fx-1';
    results := results || jsonb_build_object('c', 'second invoice counts what was already invoiced', 'e', '116641.00', 'a', got);

    -- Only booked or completed work can be invoiced
    got := pg_temp.run(admin, format('select public.record_invoice(%L, %L, current_date, 100)', wo_h, 'FX-3'));
    results := results || jsonb_build_object('c', 'work that is not booked cannot be invoiced', 'e', '55000', 'a', got);
    got := pg_temp.run(admin, format('select public.record_invoice(%L, %L, current_date, 0)', wo_g, 'FX-4'));
    results := results || jsonb_build_object('c', 'a zero amount is refused', 'e', '22023', 'a', got);
    got := pg_temp.run(admin, format('select public.record_invoice(%L, %L, current_date + 400, 10)', wo_g, 'FX-5'));
    results := results || jsonb_build_object('c', 'an invoice dated far in the future is refused', 'e', '22023', 'a', got);

    -- Who may record and decide
    foreach who in array array['hr_user', 'employee', 'vendor', 'other_rmc_admin'] loop
      got := pg_temp.run((users ->> who)::uuid, format('select public.record_invoice(%L, %L, current_date, 10)', wo_g, 'FX-X'));
      results := results || jsonb_build_object('c', who || ' cannot record invoices', 'e', '42501', 'a', got);
    end loop;
    foreach who in array array['consultant', 'hr_user', 'employee', 'vendor', 'other_rmc_admin'] loop
      got := pg_temp.run((users ->> who)::uuid, format('select public.decide_invoice(%L, %L, %L)', inv_1, 'approve', 'looks fine'));
      results := results || jsonb_build_object('c', who || ' cannot decide on invoices', 'e', '42501', 'a', got);
    end loop;
    got := pg_temp.run(admin, format('select public.decide_invoice(%L, %L, %L)', inv_1, 'approve', ''));
    results := results || jsonb_build_object('c', 'a decision needs a note', 'e', '22023', 'a', got);

    -- Visibility (before decisions): demo relocation has FX-1, FX-2, fx-1; other RMC has FX-OTHER
    for who in select jsonb_object_keys(users) loop
      got := pg_temp.run((users ->> who)::uuid,
        format('select count(*) from public.invoices where invoice_number in (%L, %L)', 'FX-1', 'FX-OTHER'));
      results := results || jsonb_build_object('c', who || ' sees invoices', 'e', expect ->> who, 'a', got);
      got := pg_temp.run((users ->> who)::uuid, format('update public.invoices set status = %L where id = %L', 'approved', inv_1));
      results := results || jsonb_build_object('c', who || ' cannot edit invoices directly', 'e', '42501', 'a', got);
      got := pg_temp.run((users ->> who)::uuid, format(
        'insert into public.invoices (rmc_tenant_id, assignment_id, service_id, work_order_id, vendor_id, invoice_number, invoice_date, amount, source, agreed_amount, invoiced_to_date, variance_amount, variance_pct, tolerance_pct, budget_amount, budget_remaining_after, status) select rmc_tenant_id, assignment_id, service_id, work_order_id, vendor_id, %L, current_date, 1, %L, 1, 1, 0, 0, 2, 1, 1, %L from public.invoices where id = %L',
        'FAKE', 'staff', 'matched', inv_1));
      results := results || jsonb_build_object('c', who || ' cannot write invoices directly', 'e', '42501', 'a', got);
    end loop;
    got := pg_temp.run(null, 'select count(*) from public.invoices');
    results := results || jsonb_build_object('c', 'logged-out visitor cannot read invoices', 'e', '42501', 'a', got);

    -- The RMC admin decides; disputed invoices stop counting
    got := pg_temp.run(admin, format('select public.decide_invoice(%L, %L, %L)', inv_1, 'dispute', 'Fare rose after booking; agreed fare stands'));
    select status || ' ' || coalesce(decision_note, '') into got from public.invoices where id = inv_1;
    results := results || jsonb_build_object('c', 'RMC admin disputes the 8% invoice with a note', 'e', 'disputed Fare rose after booking; agreed fare stands', 'a', got);
    got := pg_temp.run(admin, format('select public.decide_invoice(%L, %L, %L)', inv_1, 'approve', 'changed my mind'));
    results := results || jsonb_build_object('c', 'a decided invoice cannot be decided again', 'e', '55000', 'a', got);
    select id into inv_2 from public.invoices where invoice_number = 'fx-1';
    perform pg_temp.run(admin, format('select public.decide_invoice(%L, %L, %L)', inv_2, 'dispute', 'Duplicate'));
    perform pg_temp.run(consultant, format('select public.record_invoice(%L, %L, current_date, 108000)', wo_f, 'FX-6'));
    select status || ' ' || invoiced_to_date || ' ' || variance_amount into got from public.invoices where invoice_number = 'FX-6';
    results := results || jsonb_build_object('c', 'a corrected invoice after disputes matches exactly', 'e', 'matched 108000.00 0.00', 'a', got);
    select count(*)::text into got from public.work_order_events where work_order_id = wo_f and event = 'invoice_disputed';
    results := results || jsonb_build_object('c', 'decisions are kept in the work order history', 'e', '2', 'a', got);

    -- Over budget
    update public.assignment_budgets set amount = 400000 where assignment_id = a1;
    perform pg_temp.run(consultant, format('select public.record_invoice(%L, %L, current_date, 50000)', wo_g, 'FX-7'));
    select (flags @> array['over_budget'])::text || ' ' || budget_remaining_after into got from public.invoices where invoice_number = 'FX-7';
    results := results || jsonb_build_object('c', 'an invoice that takes the relocation over budget is flagged',
      'e', 'true -460000.00', 'a', got);

    -- Through the provider portal, with no account
    update public.work_orders set token_hash = encode(extensions.digest(convert_to(tok, 'UTF8'), 'sha256'), 'hex') where id = wo_g;
    insert into storage.objects (bucket_id, name)
      values ('relocation-documents', a1 || '/portal/' || encode(extensions.digest(convert_to(tok, 'UTF8'), 'sha256'), 'hex') || '/fx-invoice.pdf');
    got := pg_temp.run(null, format('select public.portal_submit_invoice(%L, %L, current_date, 1000, %L, %L, %L, 100)',
      tok, 'FX-PORTAL', a1 || '/portal/' || encode(extensions.digest(convert_to(tok, 'UTF8'), 'sha256'), 'hex') || '/fx-invoice.pdf', 'FX invoice.pdf', 'application/pdf'));
    results := results || jsonb_build_object('c', 'provider sends an invoice through the portal (checked straight away)', 'e', 'flagged', 'a', got);
    select source || ' ' || (document_id is not null)::text into got from public.invoices where invoice_number = 'FX-PORTAL';
    results := results || jsonb_build_object('c', 'portal invoice is linked to its PDF', 'e', 'portal true', 'a', got);
    got := pg_temp.run(null, format('select public.portal_submit_invoice(%L, %L, current_date, 1000, %L, %L, %L, 100)',
      tok || 'x', 'FX-PORTAL-2', a1 || '/portal/x/fx.pdf', 'FX', 'application/pdf'));
    results := results || jsonb_build_object('c', 'a wrong link cannot send invoices', 'e', 'P0002', 'a', got);
    got := pg_temp.run(employee, 'select count(*) from public.documents where file_name = ''FX invoice.pdf''');
    results := results || jsonb_build_object('c', 'employee cannot see the invoice document', 'e', '0', 'a', got);
    got := pg_temp.run(vendor, 'select count(*) from public.invoices where invoice_number = ''FX-PORTAL''');
    results := results || jsonb_build_object('c', 'vendor sees its own portal invoice when logged in', 'e', '1', 'a', got);

    raise exception 'rollback fixtures' using errcode = 'ZZ001';
  exception when sqlstate 'ZZ001' then
    null; -- fixtures undone
  end;

  return query
    select r ->> 'c', r ->> 'e', r ->> 'a', (r ->> 'e') = (r ->> 'a')
    from jsonb_array_elements(results) r;
end
$fn$;

select * from pg_temp.invoices_access();
