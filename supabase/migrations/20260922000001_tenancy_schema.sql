-- Relo OS — tenancy schema (spec sections 2 and 3)
-- RMC tenant -> client companies -> assignments. Every row belongs to one tenant.
-- Writes are not granted to app users yet; they arrive with the features that need them.

create type public.user_role as enum ('rmc_admin', 'consultant', 'hr_user', 'employee', 'vendor');

-- ---------------------------------------------------------------- tables

create table public.rmc_tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 200),
  created_at timestamptz not null default now()
);

create table public.client_companies (
  id uuid primary key default gen_random_uuid(),
  rmc_tenant_id uuid not null references public.rmc_tenants (id) on delete restrict,
  name text not null check (length(name) between 1 and 200),
  created_at timestamptz not null default now(),
  unique (id, rmc_tenant_id)
);
create index on public.client_companies (rmc_tenant_id);

-- One row per login. The role lives here, not in user-editable auth metadata.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  rmc_tenant_id uuid not null references public.rmc_tenants (id) on delete restrict,
  role public.user_role not null,
  full_name text not null check (length(full_name) between 1 and 200),
  email text not null,
  client_company_id uuid,
  created_at timestamptz not null default now(),
  foreign key (client_company_id, rmc_tenant_id)
    references public.client_companies (id, rmc_tenant_id),
  -- HR users and employees must belong to a client company; other roles must not.
  check (
    (role in ('hr_user', 'employee') and client_company_id is not null)
    or (role in ('rmc_admin', 'consultant', 'vendor') and client_company_id is null)
  )
);
create index on public.profiles (rmc_tenant_id);
create index on public.profiles (client_company_id);

create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  rmc_tenant_id uuid not null references public.rmc_tenants (id) on delete restrict,
  client_company_id uuid not null,
  employee_profile_id uuid references public.profiles (id) on delete set null,
  employee_name text not null check (length(employee_name) between 1 and 200),
  family_size int not null check (family_size between 1 and 20),
  origin text not null check (length(origin) between 1 and 200),
  destination text not null check (length(destination) between 1 and 200),
  move_date date not null,
  status text not null default 'requested'
    check (status in ('requested', 'planned', 'in_progress', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  foreign key (client_company_id, rmc_tenant_id)
    references public.client_companies (id, rmc_tenant_id),
  unique (id, rmc_tenant_id)
);
create index on public.assignments (rmc_tenant_id);
create index on public.assignments (client_company_id);
create index on public.assignments (employee_profile_id);

-- Budget is kept apart from the assignment so employees can never read it.
create table public.assignment_budgets (
  assignment_id uuid primary key,
  rmc_tenant_id uuid not null,
  amount numeric(14, 2) not null check (amount >= 0),
  currency text not null default 'INR' check (currency = 'INR'),
  foreign key (assignment_id, rmc_tenant_id)
    references public.assignments (id, rmc_tenant_id) on delete cascade
);
create index on public.assignment_budgets (rmc_tenant_id);

-- Which consultants are allocated to which assignments.
create table public.assignment_consultants (
  assignment_id uuid not null,
  consultant_id uuid not null references public.profiles (id) on delete cascade,
  rmc_tenant_id uuid not null,
  primary key (assignment_id, consultant_id),
  foreign key (assignment_id, rmc_tenant_id)
    references public.assignments (id, rmc_tenant_id) on delete cascade
);
create index on public.assignment_consultants (consultant_id);
create index on public.assignment_consultants (rmc_tenant_id);

-- -------------------------------------------------- helper functions
-- Kept in a schema the API does not expose. SECURITY DEFINER so policies can
-- read profiles without recursing through profiles' own policies.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create function private.my_role() returns public.user_role
language sql stable security definer set search_path = ''
as $$ select role from public.profiles where id = auth.uid() $$;

create function private.my_tenant() returns uuid
language sql stable security definer set search_path = ''
as $$ select rmc_tenant_id from public.profiles where id = auth.uid() $$;

create function private.my_company() returns uuid
language sql stable security definer set search_path = ''
as $$ select client_company_id from public.profiles where id = auth.uid() $$;

create function private.is_my_consultant_assignment(a_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.assignment_consultants
    where assignment_id = a_id and consultant_id = auth.uid()
  )
$$;

revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;

-- ------------------------------------------------------------- RLS

alter table public.rmc_tenants enable row level security;
alter table public.client_companies enable row level security;
alter table public.profiles enable row level security;
alter table public.assignments enable row level security;
alter table public.assignment_budgets enable row level security;
alter table public.assignment_consultants enable row level security;

-- Anonymous visitors get nothing.
revoke all on public.rmc_tenants, public.client_companies, public.profiles,
  public.assignments, public.assignment_budgets, public.assignment_consultants from anon;
-- Logged-in users may only read, and only what the policies below allow.
revoke insert, update, delete, truncate on public.rmc_tenants, public.client_companies,
  public.profiles, public.assignments, public.assignment_budgets,
  public.assignment_consultants from authenticated;
grant select on public.rmc_tenants, public.client_companies, public.profiles,
  public.assignments, public.assignment_budgets, public.assignment_consultants to authenticated;

-- Everyone sees the RMC they belong to (for branding).
create policy "members see own tenant" on public.rmc_tenants
  for select to authenticated
  using (id = (select private.my_tenant()));

-- Client companies
create policy "rmc_admin sees tenant companies" on public.client_companies
  for select to authenticated
  using ((select private.my_role()) = 'rmc_admin' and rmc_tenant_id = (select private.my_tenant()));

create policy "hr and employee see own company" on public.client_companies
  for select to authenticated
  using ((select private.my_role()) in ('hr_user', 'employee') and id = (select private.my_company()));

create policy "consultant sees companies of allocated assignments" on public.client_companies
  for select to authenticated
  using (
    (select private.my_role()) = 'consultant'
    and exists (
      select 1 from public.assignments a
      where a.client_company_id = client_companies.id
        and private.is_my_consultant_assignment(a.id)
    )
  );

-- Profiles
create policy "users see own profile" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

create policy "rmc_admin sees tenant profiles" on public.profiles
  for select to authenticated
  using ((select private.my_role()) = 'rmc_admin' and rmc_tenant_id = (select private.my_tenant()));

-- Assignments
create policy "rmc_admin sees tenant assignments" on public.assignments
  for select to authenticated
  using ((select private.my_role()) = 'rmc_admin' and rmc_tenant_id = (select private.my_tenant()));

create policy "consultant sees allocated assignments" on public.assignments
  for select to authenticated
  using ((select private.my_role()) = 'consultant' and private.is_my_consultant_assignment(id));

create policy "hr_user sees own company assignments" on public.assignments
  for select to authenticated
  using ((select private.my_role()) = 'hr_user' and client_company_id = (select private.my_company()));

create policy "employee sees own assignment" on public.assignments
  for select to authenticated
  using ((select private.my_role()) = 'employee' and employee_profile_id = (select auth.uid()));

-- Budgets: never employees, never vendors.
create policy "rmc_admin sees tenant budgets" on public.assignment_budgets
  for select to authenticated
  using ((select private.my_role()) = 'rmc_admin' and rmc_tenant_id = (select private.my_tenant()));

create policy "consultant sees allocated budgets" on public.assignment_budgets
  for select to authenticated
  using ((select private.my_role()) = 'consultant' and private.is_my_consultant_assignment(assignment_id));

create policy "hr_user sees own company budgets" on public.assignment_budgets
  for select to authenticated
  using (
    (select private.my_role()) = 'hr_user'
    and exists (
      select 1 from public.assignments a
      where a.id = assignment_budgets.assignment_id
        and a.client_company_id = (select private.my_company())
    )
  );

-- Consultant allocations
create policy "rmc_admin sees tenant allocations" on public.assignment_consultants
  for select to authenticated
  using ((select private.my_role()) = 'rmc_admin' and rmc_tenant_id = (select private.my_tenant()));

create policy "consultant sees own allocations" on public.assignment_consultants
  for select to authenticated
  using (consultant_id = (select auth.uid()));
