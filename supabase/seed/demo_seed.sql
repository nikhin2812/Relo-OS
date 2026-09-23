-- Demo data from spec section 9. All names are fictional.
-- The password is never stored here: the placeholder is filled in at run time
-- (scripts/render-seed.mjs reads DEMO_PASSWORD from the environment).
-- Safe to re-run: every insert skips rows that already exist.

create extension if not exists pgcrypto with schema extensions;

insert into public.rmc_tenants (id, name) values
  ('10000000-0000-0000-0000-000000000001', 'Demo Mobility Partners')
on conflict (id) do nothing;

insert into public.client_companies (id, rmc_tenant_id, name) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Fictional Tech Pvt Ltd (Demo)')
on conflict (id) do nothing;

-- One login per role.
with demo_users (id, email, full_name) as (values
  ('30000000-0000-0000-0000-000000000001'::uuid, 'admin@demo.relo-os.test',      'Asha Admin (Demo)'),
  ('30000000-0000-0000-0000-000000000002'::uuid, 'consultant@demo.relo-os.test', 'Carl Consultant (Demo)'),
  ('30000000-0000-0000-0000-000000000003'::uuid, 'hr@demo.relo-os.test',         'Hema HR (Demo)'),
  ('30000000-0000-0000-0000-000000000004'::uuid, 'employee@demo.relo-os.test',   'Eshan Employee (Demo)'),
  ('30000000-0000-0000-0000-000000000005'::uuid, 'vendor@demo.relo-os.test',     'Vikram Vendor (Demo)')
), ins_users as (
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token
  )
  select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', email,
    extensions.crypt('{{DEMO_PASSWORD}}', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', full_name),
    now(), now(), '', '', '', '', '', '', '', ''
  from demo_users
  on conflict (id) do nothing
  returning id, email
)
insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), id, id::text, 'email',
  jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true), now(), now(), now()
from ins_users;

insert into public.profiles (id, rmc_tenant_id, role, full_name, email, client_company_id) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'rmc_admin',  'Asha Admin (Demo)',      'admin@demo.relo-os.test',      null),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'consultant', 'Carl Consultant (Demo)', 'consultant@demo.relo-os.test', null),
  ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'hr_user',    'Hema HR (Demo)',         'hr@demo.relo-os.test',         '20000000-0000-0000-0000-000000000001'),
  ('30000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'employee',   'Eshan Employee (Demo)',  'employee@demo.relo-os.test',   '20000000-0000-0000-0000-000000000001'),
  ('30000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', 'vendor',     'Vikram Vendor (Demo)',   'vendor@demo.relo-os.test',     null)
on conflict (id) do nothing;

-- The demo relocation: family of three, Bengaluru to Dubai, 15 November, budget ₹15 lakh.
insert into public.assignments (id, rmc_tenant_id, client_company_id, employee_profile_id,
  employee_name, family_size, origin, destination, move_date, status) values
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
   '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000004',
   'Eshan Employee (Demo)', 3, 'Bengaluru, India', 'Dubai, UAE', '2026-11-15', 'requested')
on conflict (id) do nothing;

insert into public.assignment_budgets (assignment_id, rmc_tenant_id, amount, currency) values
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 1500000.00, 'INR')
on conflict (assignment_id) do nothing;

insert into public.assignment_consultants (assignment_id, consultant_id, rmc_tenant_id) values
  ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001')
on conflict do nothing;

-- ---------------------------------------------------------------- Session 2

-- Demo relocation policy (fictional), used by the AI planner and policy checks.
insert into public.rmc_policies (rmc_tenant_id, config) values
  ('10000000-0000-0000-0000-000000000001', '{
    "currency": "INR",
    "services": {
      "immigration":       {"covered": true, "max_cost": 150000, "note": "Work and dependant visas for the whole family"},
      "flights":           {"covered": true, "max_cost_per_person": 45000, "cabin": "economy", "note": "One-way economy for each family member"},
      "temporary_housing": {"covered": true, "max_days": 30, "max_cost": 350000, "note": "Serviced apartment on arrival"},
      "household_goods":   {"covered": true, "max_cost": 400000, "max_volume_cbm": 20, "note": "Door-to-door sea freight"},
      "school_search":     {"covered": true, "max_cost": 60000, "note": "Only when children are relocating"},
      "settling_in":       {"covered": true, "max_cost": 80000, "note": "Orientation, bank account, utilities, local registration"}
    },
    "approval_rules": [
      "Any service estimated above its policy cap needs RMC admin approval",
      "Any service not listed in this policy needs RMC admin approval",
      "A plan whose total exceeds the relocation budget needs HR approval"
    ]
  }')
on conflict (rmc_tenant_id) do nothing;

-- The demo relocation starts with no plan; "Generate plan" creates it.
insert into public.relocation_plans (assignment_id, rmc_tenant_id, status) values
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'pending')
on conflict (assignment_id) do nothing;

-- Separate tenant used only by automated tests, so they never touch the demo.
insert into public.rmc_tenants (id, name, is_test_tenant) values
  ('1e000000-0000-0000-0000-000000000001', 'Automated Test RMC', true)
on conflict (id) do nothing;

insert into public.client_companies (id, rmc_tenant_id, name) values
  ('2e000000-0000-0000-0000-000000000001', '1e000000-0000-0000-0000-000000000001', 'Automated Test Company')
on conflict (id) do nothing;

insert into public.rmc_policies (rmc_tenant_id, config)
select '1e000000-0000-0000-0000-000000000001', config from public.rmc_policies
where rmc_tenant_id = '10000000-0000-0000-0000-000000000001'
on conflict (rmc_tenant_id) do nothing;

with test_users (id, email, full_name) as (values
  ('3e000000-0000-0000-0000-000000000003'::uuid, 'e2e-hr@test.relo-os.test', 'Test HR (Automated)')
), ins_users as (
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token
  )
  select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', email,
    extensions.crypt('{{DEMO_PASSWORD}}', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', full_name),
    now(), now(), '', '', '', '', '', '', '', ''
  from test_users
  on conflict (id) do nothing
  returning id, email
)
insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), id, id::text, 'email',
  jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true), now(), now(), now()
from ins_users;

insert into public.profiles (id, rmc_tenant_id, role, full_name, email, client_company_id) values
  ('3e000000-0000-0000-0000-000000000003', '1e000000-0000-0000-0000-000000000001', 'hr_user',
   'Test HR (Automated)', 'e2e-hr@test.relo-os.test', '2e000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

-- ---------------------------------------------------------------- Session 3

-- Three fictional demo vendors (spec section 9) with agreed rates.
insert into public.vendors (id, rmc_tenant_id, name, contact_email, city) values
  ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Falcon Relocation Services (Demo)', 'ops@falcon-demo.relo-os.test', 'Dubai'),
  ('50000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Skyline Moves & Travel (Demo)', 'bookings@skyline-demo.relo-os.test', 'Bengaluru'),
  ('50000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'Palm Stay Apartments (Demo)', 'stays@palmstay-demo.relo-os.test', 'Dubai'),
  -- Same network for the test-only RMC
  ('5e000000-0000-0000-0000-000000000001', '1e000000-0000-0000-0000-000000000001', 'Falcon Relocation Services (Test)', 'ops@falcon-test.relo-os.test', 'Dubai'),
  ('5e000000-0000-0000-0000-000000000002', '1e000000-0000-0000-0000-000000000001', 'Skyline Moves & Travel (Test)', 'bookings@skyline-test.relo-os.test', 'Bengaluru'),
  ('5e000000-0000-0000-0000-000000000003', '1e000000-0000-0000-0000-000000000001', 'Palm Stay Apartments (Test)', 'stays@palmstay-test.relo-os.test', 'Dubai')
on conflict (id) do nothing;

insert into public.vendor_rates (vendor_id, rmc_tenant_id, category, rate, rate_basis, description)
select v.id, v.rmc_tenant_id, r.category, r.rate, r.basis, r.description
from public.vendors v
join (values
  ('Falcon',  'immigration',       110000, 'per_family', 'Work visa plus dependant visas'),
  ('Falcon',  'flights',            41000, 'per_person', 'Economy, flexible fare'),
  ('Falcon',  'temporary_housing', 390000, 'per_family', '45 nights, 2-bedroom serviced apartment'),
  ('Falcon',  'school_search',      50000, 'per_family', 'Up to 5 school visits and applications'),
  ('Falcon',  'settling_in',        72000, 'per_family', 'Two-day orientation and admin support'),
  ('Skyline', 'flights',            36000, 'per_person', 'Economy, standard fare'),
  ('Skyline', 'household_goods',   365000, 'per_family', '20ft container, door to door'),
  ('Palm',    'temporary_housing', 330000, 'per_family', '30 nights, 2-bedroom serviced apartment'),
  ('Palm',    'settling_in',        65000, 'per_family', 'Orientation and utilities set-up')
) as r(prefix, category, rate, basis, description) on v.name like r.prefix || '%'
on conflict (vendor_id, category) do nothing;

-- The demo vendor login works for Skyline Moves & Travel.
update public.profiles set vendor_id = '50000000-0000-0000-0000-000000000002'
where id = '30000000-0000-0000-0000-000000000005' and vendor_id is null;

-- An RMC admin for the test-only RMC, used by tests that pick providers.
with test_users (id, email, full_name) as (values
  ('3e000000-0000-0000-0000-000000000001'::uuid, 'e2e-admin@test.relo-os.test', 'Test Admin (Automated)')
), ins_users as (
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token
  )
  select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', email,
    extensions.crypt('{{DEMO_PASSWORD}}', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', full_name),
    now(), now(), '', '', '', '', '', '', '', ''
  from test_users
  on conflict (id) do nothing
  returning id, email
)
insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), id, id::text, 'email',
  jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true), now(), now(), now()
from ins_users;

insert into public.profiles (id, rmc_tenant_id, role, full_name, email) values
  ('3e000000-0000-0000-0000-000000000001', '1e000000-0000-0000-0000-000000000001', 'rmc_admin',
   'Test Admin (Automated)', 'e2e-admin@test.relo-os.test')
on conflict (id) do nothing;

-- Sample plan for the demo relocation (generated by scripts/sample-plan-sql.ts).
-- Only applied while the demo plan is still pending.
with target as (
  select 1 from public.relocation_plans where assignment_id = '40000000-0000-0000-0000-000000000001' and status = 'pending'
), svc as (
  insert into public.plan_services (assignment_id, rmc_tenant_id, service_key, category, title, description,
    sequence, depends_on, start_date, due_date, estimated_cost, policy_status, policy_note, approval_required, approval_reason)
  select v.* from target, (values
    ('40000000-0000-0000-0000-000000000001'::uuid, '10000000-0000-0000-0000-000000000001'::uuid, 'immigration', 'immigration', 'Work and family visas', 'Employment visa for Eshan Employee (Demo) and dependant visas for the family.', 1, array[]::text[], '2026-09-16'::date, '2026-11-01'::date, 120000, 'within_policy', 'Within the immigration cap.', false, ''),
    ('40000000-0000-0000-0000-000000000001'::uuid, '10000000-0000-0000-0000-000000000001'::uuid, 'flights', 'flights', 'One-way flights', 'Economy flights Bengaluru, India to Dubai, UAE for 3.', 2, array['immigration']::text[], '2026-11-01'::date, '2026-11-15'::date, 114000, 'within_policy', 'Economy fares within the per-person cap.', false, ''),
    ('40000000-0000-0000-0000-000000000001'::uuid, '10000000-0000-0000-0000-000000000001'::uuid, 'household_goods', 'household_goods', 'Household goods shipment', 'Door-to-door sea freight of household goods.', 2, array['immigration']::text[], '2026-10-25'::date, '2026-12-15'::date, 380000, 'within_policy', 'Within the shipment cap.', false, ''),
    ('40000000-0000-0000-0000-000000000001'::uuid, '10000000-0000-0000-0000-000000000001'::uuid, 'temp_housing', 'temporary_housing', 'Temporary housing (45 days)', 'Serviced apartment while the family finds a long-term home.', 3, array['flights']::text[], '2026-11-15'::date, '2026-12-30'::date, 420000, 'out_of_policy', '45 days is longer than the 30-day policy limit. Estimated ₹4,20,000 is above the policy cap of ₹3,50,000.', true, 'Stay exceeds the 30-day temporary housing limit. Estimated ₹4,20,000 is above the policy cap of ₹3,50,000.'),
    ('40000000-0000-0000-0000-000000000001'::uuid, '10000000-0000-0000-0000-000000000001'::uuid, 'school_search', 'school_search', 'School search', 'Shortlist and applications for schools near the new home.', 1, array[]::text[], '2026-10-01'::date, '2026-12-06'::date, 55000, 'within_policy', 'Within the school search cap.', false, ''),
    ('40000000-0000-0000-0000-000000000001'::uuid, '10000000-0000-0000-0000-000000000001'::uuid, 'settling_in', 'settling_in', 'Settling-in support', 'Orientation, bank account, utilities and local registration.', 4, array['temp_housing']::text[], '2026-11-18'::date, '2026-12-25'::date, 70000, 'within_policy', 'Within the settling-in cap.', false, '')
  ) as v
  returning 1
), ms as (
  insert into public.plan_milestones (assignment_id, rmc_tenant_id, title, due_date, sequence, related_service_keys)
  select v.* from target, (values
    ('40000000-0000-0000-0000-000000000001'::uuid, '10000000-0000-0000-0000-000000000001'::uuid, 'Visas approved', '2026-11-01'::date, 1, array['immigration']::text[]),
    ('40000000-0000-0000-0000-000000000001'::uuid, '10000000-0000-0000-0000-000000000001'::uuid, 'Household goods collected', '2026-11-08'::date, 2, array['household_goods']::text[]),
    ('40000000-0000-0000-0000-000000000001'::uuid, '10000000-0000-0000-0000-000000000001'::uuid, 'Family arrives', '2026-11-15'::date, 3, array['flights', 'temp_housing']::text[]),
    ('40000000-0000-0000-0000-000000000001'::uuid, '10000000-0000-0000-0000-000000000001'::uuid, 'Settled in', '2026-12-25'::date, 4, array['settling_in']::text[])
  ) as v
  returning 1
)
update public.relocation_plans
set status = 'ready', summary = 'Sample plan: six services to move Eshan Employee (Demo)''s family of 3 from Bengaluru, India to Dubai, UAE. Temporary housing is above the 30-day policy limit and needs approval.',
    model = 'sample-plan', attempts = 1, generated_at = now(), updated_at = now()
where assignment_id = '40000000-0000-0000-0000-000000000001' and status = 'pending' and (select count(*) from svc) > 0 and (select count(*) from ms) > 0;
update public.assignments set status = 'planned' where id = '40000000-0000-0000-0000-000000000001' and status = 'requested';

-- ---------------------------------------------------------------- Session 4

-- The demo family's to-dos, from its sample plan.
select private.create_journey_tasks('40000000-0000-0000-0000-000000000001');

-- An employee at the test-only company, used by tests of the employee journey.
with test_users (id, email, full_name) as (values
  ('3e000000-0000-0000-0000-000000000004'::uuid, 'e2e-employee@test.relo-os.test', 'Test Employee (Automated)')
), ins_users as (
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token
  )
  select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', email,
    extensions.crypt('{{DEMO_PASSWORD}}', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', full_name),
    now(), now(), '', '', '', '', '', '', '', ''
  from test_users
  on conflict (id) do nothing
  returning id, email
)
insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), id, id::text, 'email',
  jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true), now(), now(), now()
from ins_users;

insert into public.profiles (id, rmc_tenant_id, role, full_name, email, client_company_id) values
  ('3e000000-0000-0000-0000-000000000004', '1e000000-0000-0000-0000-000000000001', 'employee',
   'Test Employee (Automated)', 'e2e-employee@test.relo-os.test', '2e000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
