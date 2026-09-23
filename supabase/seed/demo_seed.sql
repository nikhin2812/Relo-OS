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
