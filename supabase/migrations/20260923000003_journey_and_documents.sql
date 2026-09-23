-- Relo OS — MVP items 6 and 7: the employee's journey and documents in one place.
-- New tables: journey_tasks, documents. New private storage bucket for files.
-- Employees never read plan_services directly; journey_services() gives them
-- titles, dates and provider names without any money.

-- ------------------------------------------------------------- helpers

-- Journey viewers: everyone who sees the costed plan, plus the employee themselves.
create function private.can_view_journey(a_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.can_view_costed_plan(a_id)
    or exists (
      select 1 from public.assignments a
      join public.profiles p on p.id = auth.uid()
      where a.id = a_id and p.role = 'employee' and a.employee_profile_id = p.id
    )
$$;

-- Storage paths are "<assignment id>/<random name>". True when the caller may
-- see that relocation's files.
create function private.can_access_file_path(object_name text) returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  first_part text := split_part(object_name, '/', 1);
begin
  if first_part !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return false;
  end if;
  return private.can_view_journey(first_part::uuid);
end
$$;

revoke all on function private.can_view_journey(uuid) from public, anon;
revoke all on function private.can_access_file_path(text) from public, anon;
grant execute on function private.can_view_journey(uuid) to authenticated;
grant execute on function private.can_access_file_path(text) to authenticated;

-- ---------------------------------------------------------------- tables

create table public.journey_tasks (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null,
  rmc_tenant_id uuid not null,
  service_key text,
  title text not null check (length(title) between 1 and 200),
  due_date date not null,
  status text not null default 'todo' check (status in ('todo', 'done')),
  completed_at timestamptz,
  completed_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (assignment_id, service_key, title),
  foreign key (assignment_id, rmc_tenant_id)
    references public.assignments (id, rmc_tenant_id) on delete cascade
);
create index on public.journey_tasks (rmc_tenant_id);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null,
  rmc_tenant_id uuid not null,
  service_id uuid references public.plan_services (id) on delete set null,
  kind text not null check (kind in ('booking', 'visa', 'identity', 'school', 'housing', 'other')),
  file_name text not null check (length(file_name) between 1 and 200),
  storage_path text not null unique check (length(storage_path) <= 300),
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes int not null check (size_bytes between 1 and 4194304),
  uploaded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (assignment_id, rmc_tenant_id)
    references public.assignments (id, rmc_tenant_id) on delete cascade
);
create index on public.documents (assignment_id);
create index on public.documents (rmc_tenant_id);

alter table public.journey_tasks enable row level security;
alter table public.documents enable row level security;
revoke all on public.journey_tasks, public.documents from anon;
revoke insert, update, delete, truncate on public.journey_tasks, public.documents from authenticated;
grant select on public.journey_tasks, public.documents to authenticated;

create policy "journey viewers see tasks" on public.journey_tasks
  for select to authenticated using (private.can_view_journey(assignment_id));

create policy "journey viewers see documents" on public.documents
  for select to authenticated using (private.can_view_journey(assignment_id));

-- ------------------------------------------------------------- storage

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('relocation-documents', 'relocation-documents', false, 4194304,
        array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

create policy "journey viewers read relocation files" on storage.objects
  for select to authenticated
  using (bucket_id = 'relocation-documents' and private.can_access_file_path(name));

create policy "journey viewers upload relocation files" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'relocation-documents' and private.can_access_file_path(name));

-- Lets the uploader tidy up a file that never got registered as a document.
create policy "uploader removes unregistered files" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'relocation-documents'
    and owner_id = (select auth.uid())::text
    and not exists (select 1 from public.documents d where d.storage_path = storage.objects.name)
  );

-- --------------------------------------------------------- journey tasks

-- Standard to-dos for the employee, created from the plan's services.
create function private.create_journey_tasks(a_id uuid) returns void
language sql security definer set search_path = ''
as $$
  insert into public.journey_tasks (assignment_id, rmc_tenant_id, service_key, title, due_date)
  select s.assignment_id, s.rmc_tenant_id, s.service_key, t.title,
         coalesce(s.start_date, a.move_date) + t.offset_days
  from public.plan_services s
  join public.assignments a on a.id = s.assignment_id
  join (values
    ('immigration',       'Upload passport copies and photos for each family member', 7),
    ('flights',           'Confirm travel dates and the names on each passport', 0),
    ('household_goods',   'Book the pre-move survey of your home', 0),
    ('household_goods',   'List the items you are not shipping', 7),
    ('temporary_housing', 'Share your arrival time with the apartment', -7),
    ('school_search',     'Share your children''s latest school reports', 7),
    ('settling_in',       'Book your orientation day', 0),
    ('other',             'Review this service with your consultant', 0)
  ) as t(category, title, offset_days) on t.category = s.category
  where s.assignment_id = a_id
  on conflict (assignment_id, service_key, title) do nothing
$$;
revoke all on function private.create_journey_tasks(uuid) from public, anon, authenticated;

-- save_relocation_plan now also creates the employee's to-dos. Body otherwise unchanged.
create or replace function public.save_relocation_plan(p_assignment_id uuid, p_plan jsonb, p_model text)
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

  perform private.create_journey_tasks(p_assignment_id);

  update public.relocation_plans
  set status = 'ready', summary = left(p_plan ->> 'summary', 2000), model = left(p_model, 100),
      error_message = null, attempts = attempts + 1, generated_at = now(), updated_at = now()
  where assignment_id = p_assignment_id;

  update public.assignments set status = 'planned'
  where id = p_assignment_id and status = 'requested';
end
$$;

-- The employee (or RMC staff / HR) ticks a to-do off, or reopens it.
create function public.set_journey_task_done(p_task_id uuid, p_done boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  t public.journey_tasks;
begin
  select * into t from public.journey_tasks where id = p_task_id for update;
  if t.id is null or not private.can_view_journey(t.assignment_id) then
    raise exception 'Not allowed to update this task' using errcode = '42501';
  end if;
  update public.journey_tasks
  set status = case when p_done then 'done' else 'todo' end,
      completed_at = case when p_done then now() else null end,
      completed_by = case when p_done then auth.uid() else null end
  where id = p_task_id;
end
$$;

-- MVP item 6: the services on a journey, without any cost, rate or policy detail.
create function public.journey_services(p_assignment_id uuid)
returns table (id uuid, service_key text, category text, title text, description text,
               sequence int, start_date date, due_date date, provider_name text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.can_view_journey(p_assignment_id) then
    raise exception 'Not allowed to view this journey' using errcode = '42501';
  end if;
  return query
    select s.id, s.service_key, s.category, s.title, s.description, s.sequence,
           s.start_date, s.due_date, v.name
    from public.plan_services s
    left join public.vendors v on v.id = s.selected_vendor_id
    where s.assignment_id = p_assignment_id
    order by s.start_date nulls last, s.sequence;
end
$$;

-- MVP item 7: record an uploaded file. The file must already be in storage under
-- "<assignment id>/..." (storage policies checked the upload) and not yet registered.
create function public.register_document(
  p_assignment_id uuid,
  p_service_id uuid,
  p_kind text,
  p_file_name text,
  p_storage_path text,
  p_mime_type text,
  p_size_bytes int
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  a public.assignments;
  new_id uuid;
begin
  if not private.can_view_journey(p_assignment_id) then
    raise exception 'Not allowed to add documents to this relocation' using errcode = '42501';
  end if;
  select * into a from public.assignments where id = p_assignment_id;

  if split_part(p_storage_path, '/', 1) <> p_assignment_id::text then
    raise exception 'File is not stored under this relocation' using errcode = '22023';
  end if;
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'relocation-documents' and o.name = p_storage_path
      and o.owner_id = auth.uid()::text
  ) then
    raise exception 'Uploaded file not found' using errcode = '22023';
  end if;
  if p_service_id is not null and not exists (
    select 1 from public.plan_services s where s.id = p_service_id and s.assignment_id = p_assignment_id
  ) then
    raise exception 'Service is not part of this relocation' using errcode = '22023';
  end if;

  insert into public.documents (assignment_id, rmc_tenant_id, service_id, kind, file_name,
    storage_path, mime_type, size_bytes, uploaded_by)
  values (p_assignment_id, a.rmc_tenant_id, p_service_id, p_kind, btrim(p_file_name),
    p_storage_path, p_mime_type, p_size_bytes, auth.uid())
  returning id into new_id;
  return new_id;
end
$$;

-- --------------------------------------- request form: link the employee

-- Adds an optional employee login email. It must belong to an employee at HR's
-- own company. Replaces the six-argument version (a function, no data involved).
drop function public.create_relocation_request(text, int, text, text, date, numeric);

create function public.create_relocation_request(
  p_employee_name text,
  p_family_size int,
  p_origin text,
  p_destination text,
  p_move_date date,
  p_budget numeric,
  p_employee_email text default null
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  me public.profiles;
  employee_id uuid;
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

  if nullif(btrim(p_employee_email), '') is not null then
    select id into employee_id from public.profiles
    where lower(email) = lower(btrim(p_employee_email))
      and role = 'employee' and client_company_id = me.client_company_id;
    if employee_id is null then
      raise exception 'No employee login with that email at your company' using errcode = '22023';
    end if;
  end if;

  insert into public.assignments (rmc_tenant_id, client_company_id, employee_profile_id, employee_name,
    family_size, origin, destination, move_date, status)
  values (me.rmc_tenant_id, me.client_company_id, employee_id, p_employee_name,
    p_family_size, p_origin, p_destination, p_move_date, 'requested')
  returning id into new_id;

  insert into public.assignment_budgets (assignment_id, rmc_tenant_id, amount, currency)
  values (new_id, me.rmc_tenant_id, round(p_budget, 2), 'INR');

  insert into public.relocation_plans (assignment_id, rmc_tenant_id, status)
  values (new_id, me.rmc_tenant_id, 'pending');

  return new_id;
end
$$;

revoke all on function public.create_relocation_request(text, int, text, text, date, numeric, text) from public, anon;
revoke all on function public.set_journey_task_done(uuid, boolean) from public, anon;
revoke all on function public.journey_services(uuid) from public, anon;
revoke all on function public.register_document(uuid, uuid, text, text, text, text, int) from public, anon;
grant execute on function public.create_relocation_request(text, int, text, text, date, numeric, text) to authenticated;
grant execute on function public.set_journey_task_done(uuid, boolean) to authenticated;
grant execute on function public.journey_services(uuid) to authenticated;
grant execute on function public.register_document(uuid, uuid, text, text, text, text, int) to authenticated;
