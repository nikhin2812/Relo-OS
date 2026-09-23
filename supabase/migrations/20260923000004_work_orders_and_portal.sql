-- Relo OS — MVP items 8 and 9, spec section 7: approvals, work orders, the
-- account-free provider portal, and what HR needs for progress and committed budget.
--
-- Work order links: the app creates a random token, emails/shows it once and
-- sends the database only its SHA-256 hash. The token itself is never stored.

create extension if not exists pgcrypto with schema extensions;

-- ------------------------------------------------------------- approvals

alter table public.plan_services
  add column approved_by uuid references public.profiles (id) on delete set null,
  add column approved_at timestamptz;

-- ------------------------------------------------------------ work orders

create table public.work_orders (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default ('WO-' || upper(substr(md5(gen_random_uuid()::text), 1, 8))),
  service_id uuid not null references public.plan_services (id) on delete cascade,
  assignment_id uuid not null,
  rmc_tenant_id uuid not null,
  vendor_id uuid not null,
  agreed_cost numeric(14, 2) not null check (agreed_cost >= 0),
  -- What the vendor needs to do the job, copied when the order is sent.
  details jsonb not null check (jsonb_typeof(details) = 'object'),
  status text not null default 'sent'
    check (status in ('sent', 'accepted', 'declined', 'booked', 'completed', 'cancelled')),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  token_expires_at timestamptz not null,
  booking_reference text check (length(booking_reference) between 1 and 100),
  booked_for date,
  vendor_note text check (length(vendor_note) <= 1000),
  sent_by uuid references public.profiles (id) on delete set null,
  sent_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (assignment_id, rmc_tenant_id) references public.assignments (id, rmc_tenant_id) on delete cascade,
  foreign key (vendor_id, rmc_tenant_id) references public.vendors (id, rmc_tenant_id)
);
-- At most one live work order per service; a declined or cancelled one can be replaced.
create unique index work_orders_one_active_per_service on public.work_orders (service_id)
  where status not in ('declined', 'cancelled');
create index on public.work_orders (assignment_id);
create index on public.work_orders (rmc_tenant_id);
create index on public.work_orders (vendor_id);

-- Audit trail of everything that happens to a work order.
create table public.work_order_events (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders (id) on delete cascade,
  rmc_tenant_id uuid not null,
  event text not null check (event in ('sent', 'link_renewed', 'accepted', 'declined', 'booked', 'completed', 'document')),
  note text check (length(note) <= 1000),
  actor text not null check (actor in ('staff', 'vendor_portal')),
  actor_profile_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index on public.work_order_events (work_order_id);
create index on public.work_order_events (rmc_tenant_id);

-- Documents uploaded through the portal are marked, and hidden from employees
-- (a booking confirmation can carry prices).
alter table public.documents
  add column work_order_id uuid references public.work_orders (id) on delete set null,
  add column source text not null default 'app' check (source in ('app', 'portal'));

alter table public.work_orders enable row level security;
alter table public.work_order_events enable row level security;
revoke all on public.work_orders, public.work_order_events from anon;
revoke all on public.work_orders from authenticated;
revoke insert, update, delete, truncate on public.work_order_events from authenticated;
-- Every column except token_hash: nobody reads link hashes through the API.
grant select (id, reference, service_id, assignment_id, rmc_tenant_id, vendor_id, agreed_cost, details,
  status, token_expires_at, booking_reference, booked_for, vendor_note, sent_by, sent_at, updated_at)
  on public.work_orders to authenticated;
grant select on public.work_order_events to authenticated;

create policy "costed plan viewers see work orders" on public.work_orders
  for select to authenticated using (private.can_view_costed_plan(assignment_id));
create policy "vendor sees work orders sent to it" on public.work_orders
  for select to authenticated
  using ((select private.my_role()) = 'vendor' and vendor_id = (select private.my_vendor()));

create policy "costed plan viewers see work order history" on public.work_order_events
  for select to authenticated
  using (exists (select 1 from public.work_orders w
                 where w.id = work_order_events.work_order_id and private.can_view_costed_plan(w.assignment_id)));

-- Employees no longer see portal uploads.
drop policy "journey viewers see documents" on public.documents;
create policy "costed plan viewers see documents" on public.documents
  for select to authenticated using (private.can_view_costed_plan(assignment_id));
create policy "employee sees own non-portal documents" on public.documents
  for select to authenticated
  using (source = 'app' and private.can_view_journey(assignment_id));

-- ------------------------------------------------------------ storage paths
-- "<assignment>/<file>"                 app uploads: journey viewers
-- "<assignment>/portal/<hash>/<file>"   portal uploads: costed plan viewers only

create or replace function private.can_access_file_path(object_name text) returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  first_part text := split_part(object_name, '/', 1);
begin
  if first_part !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return false;
  end if;
  if split_part(object_name, '/', 2) = 'portal' then
    return private.can_view_costed_plan(first_part::uuid);
  end if;
  return private.can_view_journey(first_part::uuid);
end
$$;

-- A portal upload path is valid only for a live work order whose link hash matches.
create function private.portal_upload_path_ok(object_name text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select split_part(object_name, '/', 2) = 'portal'
    and exists (
      select 1 from public.work_orders w
      where w.token_hash = split_part(object_name, '/', 3)
        and w.assignment_id::text = split_part(object_name, '/', 1)
        and w.token_expires_at > now()
        and w.status in ('sent', 'accepted', 'booked')
    )
$$;
revoke all on function private.portal_upload_path_ok(text) from public;
grant usage on schema private to anon;
grant execute on function private.portal_upload_path_ok(text) to anon, authenticated;

-- Staff and employees may not write into the portal folders through the normal policy.
drop policy "journey viewers upload relocation files" on storage.objects;
create policy "journey viewers upload relocation files" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'relocation-documents'
    and split_part(name, '/', 2) <> 'portal'
    and private.can_access_file_path(name)
  );
create policy "portal uploads with a valid work order link" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'relocation-documents' and private.portal_upload_path_ok(name));

-- ------------------------------------------------------------------ helpers

create function private.needs_approval(s public.plan_services) returns boolean
language sql immutable
as $$ select s.approval_required or s.agreed_over_cap $$;

create function private.is_rmc_staff_for(a_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.assignments a
    join public.profiles p on p.id = auth.uid()
    where a.id = a_id and a.rmc_tenant_id = p.rmc_tenant_id
      and (p.role = 'rmc_admin'
           or (p.role = 'consultant' and exists (
             select 1 from public.assignment_consultants ac
             where ac.assignment_id = a.id and ac.consultant_id = p.id)))
  )
$$;
revoke all on function private.is_rmc_staff_for(uuid) from public, anon;
grant execute on function private.is_rmc_staff_for(uuid) to authenticated;

create function private.token_hash(p_token text) returns text
language sql immutable set search_path = ''
as $$ select encode(extensions.digest(convert_to(coalesce(p_token, ''), 'UTF8'), 'sha256'), 'hex') $$;

-- ---------------------------------------------------- staff write paths

-- Choosing a (new) provider clears any earlier approval: approval is for a price.
create or replace function public.select_service_provider(p_service_id uuid, p_vendor_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  me public.profiles;
  svc public.plan_services;
  a public.assignments;
  vr public.vendor_rates;
  rule jsonb;
  cost numeric;
  cap numeric;
begin
  select * into me from public.profiles where id = auth.uid();
  select * into svc from public.plan_services where id = p_service_id for update;
  if me.id is null or svc.id is null or not private.is_rmc_staff_for(svc.assignment_id) then
    raise exception 'Not allowed to choose a provider for this service' using errcode = '42501';
  end if;
  select * into a from public.assignments where id = svc.assignment_id;

  if exists (select 1 from public.work_orders w
             where w.service_id = p_service_id and w.status not in ('declined', 'cancelled')) then
    raise exception 'A work order is already out for this service' using errcode = '55000';
  end if;

  select * into vr from public.vendor_rates
  where vendor_id = p_vendor_id and category = svc.category and rmc_tenant_id = svc.rmc_tenant_id;
  if vr.id is null then
    raise exception 'This vendor does not offer this service' using errcode = '22023';
  end if;

  cost := case when vr.rate_basis = 'per_person' then vr.rate * a.family_size else vr.rate end;

  select config -> 'services' -> svc.category into rule
  from public.rmc_policies where rmc_tenant_id = svc.rmc_tenant_id;
  cap := case
    when rule ? 'max_cost_per_person' then (rule ->> 'max_cost_per_person')::numeric * a.family_size
    when rule ? 'max_cost' then (rule ->> 'max_cost')::numeric
    else null
  end;

  update public.plan_services
  set selected_vendor_id = p_vendor_id,
      agreed_cost = round(cost, 2),
      agreed_over_cap = coalesce(cost > cap, false),
      selected_by = me.id,
      selected_at = now(),
      approved_by = case when selected_vendor_id is distinct from p_vendor_id then null else approved_by end,
      approved_at = case when selected_vendor_id is distinct from p_vendor_id then null else approved_at end
  where id = p_service_id;
end
$$;

-- Only the RMC admin approves a service that needs approval.
create function public.approve_service(p_service_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  me public.profiles;
  svc public.plan_services;
begin
  select * into me from public.profiles where id = auth.uid();
  select * into svc from public.plan_services where id = p_service_id for update;
  if me.id is null or svc.id is null or me.role <> 'rmc_admin' or me.rmc_tenant_id <> svc.rmc_tenant_id then
    raise exception 'Only the RMC admin can approve services' using errcode = '42501';
  end if;
  if svc.selected_vendor_id is null then
    raise exception 'Choose a provider before approving' using errcode = '55000';
  end if;
  update public.plan_services set approved_by = me.id, approved_at = now() where id = p_service_id;
end
$$;

-- MVP item 9: a person sends the work order. Needs a chosen provider, and an
-- approval when the service needs one. The caller passes only the link's hash.
create function public.create_work_order(p_service_id uuid, p_token_hash text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  me public.profiles;
  svc public.plan_services;
  a public.assignments;
  wo public.work_orders;
begin
  select * into me from public.profiles where id = auth.uid();
  select * into svc from public.plan_services where id = p_service_id for update;
  if me.id is null or svc.id is null or not private.is_rmc_staff_for(svc.assignment_id) then
    raise exception 'Not allowed to send work orders for this relocation' using errcode = '42501';
  end if;
  if p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid link' using errcode = '22023';
  end if;
  if svc.selected_vendor_id is null or svc.agreed_cost is null then
    raise exception 'Choose a provider first' using errcode = '55000';
  end if;
  if private.needs_approval(svc) and svc.approved_at is null then
    raise exception 'This service needs RMC admin approval before the work order goes out' using errcode = '55000';
  end if;
  if exists (select 1 from public.work_orders w
             where w.service_id = p_service_id and w.status not in ('declined', 'cancelled')) then
    raise exception 'A work order is already out for this service' using errcode = '55000';
  end if;

  select * into a from public.assignments where id = svc.assignment_id;

  insert into public.work_orders (service_id, assignment_id, rmc_tenant_id, vendor_id, agreed_cost,
    details, token_hash, token_expires_at, sent_by)
  values (svc.id, svc.assignment_id, svc.rmc_tenant_id, svc.selected_vendor_id, svc.agreed_cost,
    jsonb_build_object(
      'service_title', svc.title, 'category', svc.category, 'description', svc.description,
      'start_date', svc.start_date, 'due_date', svc.due_date,
      'employee_name', a.employee_name, 'family_size', a.family_size,
      'origin', a.origin, 'destination', a.destination, 'move_date', a.move_date),
    p_token_hash, now() + interval '60 days', me.id)
  returning * into wo;

  insert into public.work_order_events (work_order_id, rmc_tenant_id, event, actor, actor_profile_id)
  values (wo.id, wo.rmc_tenant_id, 'sent', 'staff', me.id);

  update public.assignments set status = 'in_progress' where id = svc.assignment_id and status = 'planned';
  return wo.reference;
end
$$;

-- Issues a fresh link (the old one stops working), e.g. if the email was lost.
create function public.renew_work_order_link(p_work_order_id uuid, p_token_hash text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  wo public.work_orders;
begin
  select * into wo from public.work_orders where id = p_work_order_id for update;
  if wo.id is null or not private.is_rmc_staff_for(wo.assignment_id) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid link' using errcode = '22023';
  end if;
  if wo.status in ('declined', 'cancelled', 'completed') then
    raise exception 'This work order is closed' using errcode = '55000';
  end if;
  update public.work_orders set token_hash = p_token_hash, token_expires_at = now() + interval '60 days',
    updated_at = now() where id = wo.id;
  insert into public.work_order_events (work_order_id, rmc_tenant_id, event, actor, actor_profile_id)
  values (wo.id, wo.rmc_tenant_id, 'link_renewed', 'staff', auth.uid());
end
$$;

-- ------------------------------------------------ portal (no account, link only)

create function private.work_order_for_token(p_token text) returns public.work_orders
language plpgsql stable security definer set search_path = ''
as $$
declare
  wo public.work_orders;
begin
  if length(coalesce(p_token, '')) not between 20 and 200 then
    raise exception 'This link is not valid' using errcode = 'P0002';
  end if;
  select * into wo from public.work_orders
  where token_hash = private.token_hash(p_token) and token_expires_at > now() and status <> 'cancelled';
  if wo.id is null then
    raise exception 'This link is not valid or has expired' using errcode = 'P0002';
  end if;
  return wo;
end
$$;

create function public.portal_get_work_order(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  wo public.work_orders := private.work_order_for_token(p_token);
begin
  return jsonb_build_object(
    'reference', wo.reference,
    'assignment_id', wo.assignment_id,
    'vendor_name', (select name from public.vendors where id = wo.vendor_id),
    'rmc_name', (select name from public.rmc_tenants where id = wo.rmc_tenant_id),
    'status', wo.status,
    'details', wo.details,
    'agreed_cost', wo.agreed_cost,
    'booking_reference', wo.booking_reference,
    'booked_for', wo.booked_for,
    'vendor_note', wo.vendor_note,
    'expires_at', wo.token_expires_at,
    'documents', coalesce((
      select jsonb_agg(jsonb_build_object('file_name', d.file_name, 'created_at', d.created_at) order by d.created_at)
      from public.documents d where d.work_order_id = wo.id), '[]'::jsonb));
end
$$;

-- The provider accepts, declines, books or completes the job.
create function public.portal_update_work_order(
  p_token text, p_action text, p_booking_reference text default null,
  p_booked_for date default null, p_note text default null
) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  wo public.work_orders := private.work_order_for_token(p_token);
  next_status text;
begin
  next_status := case
    when p_action = 'accept'   and wo.status = 'sent' then 'accepted'
    when p_action = 'decline'  and wo.status in ('sent', 'accepted') then 'declined'
    when p_action = 'book'     and wo.status in ('sent', 'accepted') then 'booked'
    when p_action = 'complete' and wo.status = 'booked' then 'completed'
    else null
  end;
  if next_status is null then
    raise exception 'That update is not possible for a work order that is %', wo.status using errcode = '55000';
  end if;
  if length(p_note) > 1000 then
    raise exception 'Note is too long' using errcode = '22023';
  end if;
  if next_status = 'booked' then
    p_booking_reference := btrim(p_booking_reference);
    if coalesce(length(p_booking_reference), 0) not between 1 and 100 then
      raise exception 'Enter the booking reference' using errcode = '22023';
    end if;
    if p_booked_for is null or p_booked_for < current_date - 365 or p_booked_for > current_date + 730 then
      raise exception 'Enter the booked date' using errcode = '22023';
    end if;
  end if;

  update public.work_orders
  set status = next_status,
      booking_reference = case when next_status = 'booked' then p_booking_reference else booking_reference end,
      booked_for = case when next_status = 'booked' then p_booked_for else booked_for end,
      vendor_note = coalesce(nullif(btrim(p_note), ''), vendor_note),
      updated_at = now()
  where id = wo.id;

  insert into public.work_order_events (work_order_id, rmc_tenant_id, event, note, actor)
  values (wo.id, wo.rmc_tenant_id, next_status::text, nullif(btrim(p_note), ''), 'vendor_portal');
  return next_status;
end
$$;

-- Records a file the provider uploaded through the portal.
create function public.portal_register_document(
  p_token text, p_storage_path text, p_file_name text, p_mime_type text, p_size_bytes int
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  wo public.work_orders := private.work_order_for_token(p_token);
  new_id uuid;
begin
  if wo.status not in ('sent', 'accepted', 'booked') then
    raise exception 'This work order is closed' using errcode = '55000';
  end if;
  if p_storage_path not like wo.assignment_id::text || '/portal/' || wo.token_hash || '/%' then
    raise exception 'File is not stored under this work order' using errcode = '22023';
  end if;
  if not exists (select 1 from storage.objects o
                 where o.bucket_id = 'relocation-documents' and o.name = p_storage_path) then
    raise exception 'Uploaded file not found' using errcode = '22023';
  end if;
  insert into public.documents (assignment_id, rmc_tenant_id, service_id, work_order_id, kind, file_name,
    storage_path, mime_type, size_bytes, source)
  values (wo.assignment_id, wo.rmc_tenant_id, wo.service_id, wo.id, 'booking', btrim(p_file_name),
    p_storage_path, p_mime_type, p_size_bytes, 'portal')
  returning id into new_id;
  insert into public.work_order_events (work_order_id, rmc_tenant_id, event, note, actor)
  values (wo.id, wo.rmc_tenant_id, 'document', left(btrim(p_file_name), 1000), 'vendor_portal');
  return new_id;
end
$$;

-- ------------------------------------ the employee's journey shows booking status

drop function public.journey_services(uuid);
create function public.journey_services(p_assignment_id uuid)
returns table (id uuid, service_key text, category text, title text, description text,
               sequence int, start_date date, due_date date, provider_name text,
               work_status text, booked_for date, booking_reference text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.can_view_journey(p_assignment_id) then
    raise exception 'Not allowed to view this journey' using errcode = '42501';
  end if;
  return query
    select s.id, s.service_key, s.category, s.title, s.description, s.sequence,
           s.start_date, s.due_date, v.name,
           coalesce(w.status, 'planned'), w.booked_for, w.booking_reference
    from public.plan_services s
    left join public.vendors v on v.id = s.selected_vendor_id
    left join lateral (
      select wo.status, wo.booked_for, wo.booking_reference from public.work_orders wo
      where wo.service_id = s.id order by wo.sent_at desc limit 1
    ) w on true
    where s.assignment_id = p_assignment_id
    order by s.start_date nulls last, s.sequence;
end
$$;

-- ------------------------------------------------------------------ grants

revoke all on function public.approve_service(uuid) from public, anon;
revoke all on function public.create_work_order(uuid, text) from public, anon;
revoke all on function public.renew_work_order_link(uuid, text) from public, anon;
revoke all on function public.journey_services(uuid) from public, anon;
grant execute on function public.approve_service(uuid) to authenticated;
grant execute on function public.create_work_order(uuid, text) to authenticated;
grant execute on function public.renew_work_order_link(uuid, text) to authenticated;
grant execute on function public.journey_services(uuid) to authenticated;

-- Internal helpers: only called from the security-definer functions above.
revoke all on function private.work_order_for_token(text) from public, anon, authenticated;
revoke all on function private.token_hash(text) from public, anon, authenticated;
revoke all on function private.needs_approval(public.plan_services) from public, anon, authenticated;

-- The portal is used without an account.
revoke all on function public.portal_get_work_order(text) from public;
revoke all on function public.portal_update_work_order(text, text, text, date, text) from public;
revoke all on function public.portal_register_document(text, text, text, text, int) from public;
grant execute on function public.portal_get_work_order(text) to anon, authenticated;
grant execute on function public.portal_update_work_order(text, text, text, date, text) to anon, authenticated;
grant execute on function public.portal_register_document(text, text, text, text, int) to anon, authenticated;
