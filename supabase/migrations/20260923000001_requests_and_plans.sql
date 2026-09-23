-- Relo OS — MVP items 1 and 2: HR relocation requests and the AI relocation plan.
-- New tables: rmc_policies, relocation_plans, plan_services, plan_milestones.
-- App users still cannot write tables directly; the three functions at the end
-- are the only write paths and each checks who is calling.

-- A tenant flag so automated tests can create and clear their own data
-- without ever touching the demo tenant.
alter table public.rmc_tenants add column is_test_tenant boolean not null default false;

-- ---------------------------------------------------------------- tables

-- The RMC's relocation policy, fed to the planner and used to double-check its flags.
create table public.rmc_policies (
  rmc_tenant_id uuid primary key references public.rmc_tenants (id) on delete cascade,
  config jsonb not null check (jsonb_typeof(config) = 'object'),
  updated_at timestamptz not null default now()
);

-- One plan per relocation. Starts 'pending'; becomes 'ready' or 'failed'.
create table public.relocation_plans (
  assignment_id uuid primary key,
  rmc_tenant_id uuid not null,
  status text not null default 'pending' check (status in ('pending', 'ready', 'failed')),
  summary text check (length(summary) <= 2000),
  model text check (length(model) <= 100),
  error_message text check (length(error_message) <= 500),
  attempts int not null default 0 check (attempts >= 0),
  generated_at timestamptz,
  updated_at timestamptz not null default now(),
  foreign key (assignment_id, rmc_tenant_id)
    references public.assignments (id, rmc_tenant_id) on delete cascade
);
create index on public.relocation_plans (rmc_tenant_id);

create table public.plan_services (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null,
  rmc_tenant_id uuid not null,
  service_key text not null check (service_key ~ '^[a-z0-9_]{1,40}$'),
  category text not null check (category in (
    'immigration', 'flights', 'temporary_housing', 'household_goods',
    'school_search', 'settling_in', 'other')),
  title text not null check (length(title) between 1 and 200),
  description text not null default '' check (length(description) <= 2000),
  sequence int not null check (sequence between 1 and 50),
  depends_on text[] not null default '{}',
  start_date date,
  due_date date,
  estimated_cost numeric(14, 2) not null check (estimated_cost >= 0),
  policy_status text not null check (policy_status in ('within_policy', 'needs_review', 'out_of_policy')),
  policy_note text not null default '' check (length(policy_note) <= 1000),
  approval_required boolean not null default false,
  approval_reason text not null default '' check (length(approval_reason) <= 1000),
  created_at timestamptz not null default now(),
  unique (assignment_id, service_key),
  foreign key (assignment_id, rmc_tenant_id)
    references public.assignments (id, rmc_tenant_id) on delete cascade
);
create index on public.plan_services (rmc_tenant_id);

-- Milestones carry no money, so employees may see their own.
create table public.plan_milestones (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null,
  rmc_tenant_id uuid not null,
  title text not null check (length(title) between 1 and 200),
  due_date date not null,
  sequence int not null check (sequence between 1 and 50),
  related_service_keys text[] not null default '{}',
  created_at timestamptz not null default now(),
  foreign key (assignment_id, rmc_tenant_id)
    references public.assignments (id, rmc_tenant_id) on delete cascade
);
create index on public.plan_milestones (assignment_id);
create index on public.plan_milestones (rmc_tenant_id);

-- ------------------------------------------------------------- helpers

-- True when the caller may see the full (costed) plan for this relocation:
-- the RMC admin, the allocated consultant, or HR at the client company.
create function private.can_view_costed_plan(a_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.assignments a
    join public.profiles p on p.id = auth.uid()
    where a.id = a_id
      and a.rmc_tenant_id = p.rmc_tenant_id
      and (
        p.role = 'rmc_admin'
        or (p.role = 'hr_user' and a.client_company_id = p.client_company_id)
        or (p.role = 'consultant' and exists (
          select 1 from public.assignment_consultants ac
          where ac.assignment_id = a.id and ac.consultant_id = p.id))
      )
  )
$$;

revoke all on function private.can_view_costed_plan(uuid) from public, anon;
grant execute on function private.can_view_costed_plan(uuid) to authenticated;

-- ------------------------------------------------------------------ RLS

alter table public.rmc_policies enable row level security;
alter table public.relocation_plans enable row level security;
alter table public.plan_services enable row level security;
alter table public.plan_milestones enable row level security;

revoke all on public.rmc_policies, public.relocation_plans,
  public.plan_services, public.plan_milestones from anon;
revoke insert, update, delete, truncate on public.rmc_policies, public.relocation_plans,
  public.plan_services, public.plan_milestones from authenticated;
grant select on public.rmc_policies, public.relocation_plans,
  public.plan_services, public.plan_milestones to authenticated;

create policy "rmc staff and hr see tenant policy" on public.rmc_policies
  for select to authenticated
  using (
    (select private.my_role()) in ('rmc_admin', 'consultant', 'hr_user')
    and rmc_tenant_id = (select private.my_tenant())
  );

create policy "costed plan viewers see plan status" on public.relocation_plans
  for select to authenticated
  using (private.can_view_costed_plan(assignment_id));

create policy "costed plan viewers see services" on public.plan_services
  for select to authenticated
  using (private.can_view_costed_plan(assignment_id));

create policy "costed plan viewers see milestones" on public.plan_milestones
  for select to authenticated
  using (private.can_view_costed_plan(assignment_id));

create policy "employee sees own milestones" on public.plan_milestones
  for select to authenticated
  using (
    (select private.my_role()) = 'employee'
    and exists (
      select 1 from public.assignments a
      where a.id = plan_milestones.assignment_id
        and a.employee_profile_id = (select auth.uid())
    )
  );

-- --------------------------------------------------------- write paths

-- MVP item 1: HR creates a relocation request for their own company.
create function public.create_relocation_request(
  p_employee_name text,
  p_family_size int,
  p_origin text,
  p_destination text,
  p_move_date date,
  p_budget numeric
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  me public.profiles;
  new_id uuid;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.id is null or me.role <> 'hr_user' then
    raise exception 'Only HR users can create relocation requests' using errcode = '42501';
  end if;

  p_employee_name := btrim(p_employee_name);
  p_origin := btrim(p_origin);
  p_destination := btrim(p_destination);
  if coalesce(length(p_employee_name), 0) not between 1 and 200
     or coalesce(length(p_origin), 0) not between 1 and 200
     or coalesce(length(p_destination), 0) not between 1 and 200 then
    raise exception 'Name, origin and destination are required (max 200 characters)' using errcode = '22023';
  end if;
  if lower(p_origin) = lower(p_destination) then
    raise exception 'Origin and destination must differ' using errcode = '22023';
  end if;
  if p_family_size is null or p_family_size not between 1 and 20 then
    raise exception 'Family size must be between 1 and 20' using errcode = '22023';
  end if;
  if p_move_date is null or p_move_date < current_date or p_move_date > current_date + 730 then
    raise exception 'Move date must be within the next two years' using errcode = '22023';
  end if;
  if p_budget is null or p_budget <= 0 or p_budget > 100000000 then
    raise exception 'Budget must be between ₹1 and ₹10 crore' using errcode = '22023';
  end if;

  insert into public.assignments (rmc_tenant_id, client_company_id, employee_name,
    family_size, origin, destination, move_date, status)
  values (me.rmc_tenant_id, me.client_company_id, p_employee_name,
    p_family_size, p_origin, p_destination, p_move_date, 'requested')
  returning id into new_id;

  insert into public.assignment_budgets (assignment_id, rmc_tenant_id, amount, currency)
  values (new_id, me.rmc_tenant_id, round(p_budget, 2), 'INR');

  insert into public.relocation_plans (assignment_id, rmc_tenant_id, status)
  values (new_id, me.rmc_tenant_id, 'pending');

  return new_id;
end
$$;

-- MVP item 2: store a validated AI plan. All-or-nothing; only while the plan is
-- still pending or failed, so an approved plan is never overwritten.
create function public.save_relocation_plan(p_assignment_id uuid, p_plan jsonb, p_model text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  plan_row public.relocation_plans;
  svc jsonb;
  ms jsonb;
begin
  if not private.can_view_costed_plan(p_assignment_id) then
    raise exception 'Not allowed to plan this relocation' using errcode = '42501';
  end if;

  select * into plan_row from public.relocation_plans
  where assignment_id = p_assignment_id
  for update;
  if plan_row.assignment_id is null then
    raise exception 'No plan record for this relocation' using errcode = 'P0002';
  end if;
  if plan_row.status = 'ready' then
    raise exception 'This relocation already has a plan' using errcode = '55000';
  end if;

  if jsonb_typeof(p_plan -> 'services') <> 'array'
     or jsonb_array_length(p_plan -> 'services') not between 1 and 20
     or jsonb_typeof(p_plan -> 'milestones') <> 'array'
     or jsonb_array_length(p_plan -> 'milestones') > 30 then
    raise exception 'Plan must have 1-20 services and at most 30 milestones' using errcode = '22023';
  end if;

  for svc in select * from jsonb_array_elements(p_plan -> 'services') loop
    insert into public.plan_services (assignment_id, rmc_tenant_id, service_key, category,
      title, description, sequence, depends_on, start_date, due_date, estimated_cost,
      policy_status, policy_note, approval_required, approval_reason)
    values (p_assignment_id, plan_row.rmc_tenant_id, svc ->> 'key', svc ->> 'category',
      svc ->> 'title', coalesce(svc ->> 'description', ''), (svc ->> 'sequence')::int,
      coalesce(array(select jsonb_array_elements_text(svc -> 'depends_on')), '{}'),
      (svc ->> 'start_date')::date, (svc ->> 'due_date')::date,
      (svc ->> 'estimated_cost')::numeric,
      svc ->> 'policy_status', coalesce(svc ->> 'policy_note', ''),
      coalesce((svc ->> 'approval_required')::boolean, false),
      coalesce(svc ->> 'approval_reason', ''));
  end loop;

  -- Every dependency must name a service in this plan.
  if exists (
    select 1 from public.plan_services s, unnest(s.depends_on) d
    where s.assignment_id = p_assignment_id
      and d not in (select service_key from public.plan_services where assignment_id = p_assignment_id)
  ) then
    raise exception 'A service depends on a service that is not in the plan' using errcode = '22023';
  end if;

  for ms in select * from jsonb_array_elements(p_plan -> 'milestones') loop
    insert into public.plan_milestones (assignment_id, rmc_tenant_id, title, due_date,
      sequence, related_service_keys)
    values (p_assignment_id, plan_row.rmc_tenant_id, ms ->> 'title', (ms ->> 'due_date')::date,
      (ms ->> 'sequence')::int,
      coalesce(array(select jsonb_array_elements_text(ms -> 'related_service_keys')), '{}'));
  end loop;

  update public.relocation_plans
  set status = 'ready', summary = left(p_plan ->> 'summary', 2000), model = left(p_model, 100),
      error_message = null, attempts = attempts + 1, generated_at = now(), updated_at = now()
  where assignment_id = p_assignment_id;

  update public.assignments set status = 'planned'
  where id = p_assignment_id and status = 'requested';
end
$$;

-- Records that planning failed, so HR sees a clear message and can retry.
create function public.record_plan_failure(p_assignment_id uuid, p_message text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.can_view_costed_plan(p_assignment_id) then
    raise exception 'Not allowed to plan this relocation' using errcode = '42501';
  end if;
  update public.relocation_plans
  set status = 'failed', error_message = left(p_message, 500),
      attempts = attempts + 1, updated_at = now()
  where assignment_id = p_assignment_id and status <> 'ready';
end
$$;

-- Lets automated tests clear the relocations they created. Works only for HR or
-- admin users inside a tenant flagged as a test tenant — never the demo.
create function public.reset_test_tenant_data() returns int
language plpgsql security definer set search_path = ''
as $$
declare
  me public.profiles;
  removed int;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.id is null or me.role not in ('hr_user', 'rmc_admin')
     or not exists (select 1 from public.rmc_tenants t where t.id = me.rmc_tenant_id and t.is_test_tenant) then
    raise exception 'Only available inside a test tenant' using errcode = '42501';
  end if;
  delete from public.assignments where rmc_tenant_id = me.rmc_tenant_id;
  get diagnostics removed = row_count;
  return removed;
end
$$;

revoke all on function public.create_relocation_request(text, int, text, text, date, numeric) from public, anon;
revoke all on function public.save_relocation_plan(uuid, jsonb, text) from public, anon;
revoke all on function public.record_plan_failure(uuid, text) from public, anon;
revoke all on function public.reset_test_tenant_data() from public, anon;
grant execute on function public.create_relocation_request(text, int, text, text, date, numeric) to authenticated;
grant execute on function public.save_relocation_plan(uuid, jsonb, text) to authenticated;
grant execute on function public.record_plan_failure(uuid, text) to authenticated;
grant execute on function public.reset_test_tenant_data() to authenticated;
