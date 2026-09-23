-- Relo OS — MVP item 10 and spec section 8: invoices matched back to the
-- relocation, service and budget, with the difference flagged.
--
-- Trail: budget → estimate → agreed (chosen provider) → work order → booking
--        → invoice → variance. Matching happens in the database when an invoice
-- is recorded, so the stored result can't be edited by whoever submitted it.

-- Invoices can be uploaded as documents too.
alter table public.documents drop constraint documents_kind_check;
alter table public.documents add constraint documents_kind_check
  check (kind in ('booking', 'visa', 'identity', 'school', 'housing', 'invoice', 'other'));

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  rmc_tenant_id uuid not null,
  assignment_id uuid not null,
  service_id uuid not null references public.plan_services (id) on delete cascade,
  work_order_id uuid not null references public.work_orders (id) on delete cascade,
  vendor_id uuid not null,
  invoice_number text not null check (length(invoice_number) between 1 and 60),
  invoice_date date not null,
  amount numeric(14, 2) not null check (amount > 0 and amount <= 100000000),
  currency text not null default 'INR' check (currency = 'INR'),
  source text not null check (source in ('portal', 'staff')),
  document_id uuid references public.documents (id) on delete set null,
  -- The match, worked out when the invoice arrived
  agreed_amount numeric(14, 2) not null,
  invoiced_to_date numeric(14, 2) not null,       -- this and earlier invoices on the work order
  variance_amount numeric(14, 2) not null,        -- invoiced_to_date - agreed_amount
  variance_pct numeric(7, 2) not null,
  tolerance_pct numeric(5, 2) not null,
  budget_amount numeric(14, 2) not null,
  budget_remaining_after numeric(14, 2) not null,
  flags text[] not null default '{}'
    check (flags <@ array['over_agreed_rate', 'over_budget', 'duplicate_number']::text[]),
  status text not null check (status in ('matched', 'flagged', 'approved', 'disputed')),
  decision_note text check (length(decision_note) <= 1000),
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  recorded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (assignment_id, rmc_tenant_id) references public.assignments (id, rmc_tenant_id) on delete cascade,
  foreign key (vendor_id, rmc_tenant_id) references public.vendors (id, rmc_tenant_id)
);
create index on public.invoices (assignment_id);
create index on public.invoices (rmc_tenant_id);
create index on public.invoices (work_order_id);
create index on public.invoices (vendor_id, invoice_number);

alter table public.invoices enable row level security;
revoke all on public.invoices from anon;
revoke insert, update, delete, truncate on public.invoices from authenticated;
grant select on public.invoices to authenticated;

create policy "costed plan viewers see invoices" on public.invoices
  for select to authenticated using (private.can_view_costed_plan(assignment_id));
create policy "vendor sees own invoices" on public.invoices
  for select to authenticated
  using ((select private.my_role()) = 'vendor' and vendor_id = (select private.my_vendor()));

-- ------------------------------------------------------------- matching

-- Money already spoken for on a relocation, per service: what's been invoiced
-- (not disputed) if anything, otherwise the agreed price of a live work order.
create function private.relocation_spend(a_id uuid) returns numeric
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(
    case
      when inv.total is not null then inv.total
      when w.status in ('sent', 'accepted', 'booked', 'completed') then w.agreed_cost
      else 0
    end), 0)
  from public.plan_services s
  left join lateral (
    select wo.status, wo.agreed_cost from public.work_orders wo
    where wo.service_id = s.id order by wo.sent_at desc limit 1
  ) w on true
  left join lateral (
    select sum(i.amount) as total from public.invoices i
    where i.service_id = s.id and i.status <> 'disputed'
  ) inv on true
  where s.assignment_id = a_id
$$;

-- Records an invoice against a work order and works out the match.
create function private.record_invoice(
  p_work_order_id uuid, p_invoice_number text, p_invoice_date date, p_amount numeric,
  p_source text, p_document_id uuid, p_recorded_by uuid
) returns public.invoices
language plpgsql security definer set search_path = ''
as $$
declare
  wo public.work_orders;
  budget numeric;
  tolerance numeric;
  earlier numeric;
  to_date numeric;
  variance numeric;
  pct numeric;
  remaining numeric;
  flag_list text[] := '{}';
  inv public.invoices;
begin
  select * into wo from public.work_orders where id = p_work_order_id for update;
  if wo.id is null then
    raise exception 'Work order not found' using errcode = 'P0002';
  end if;
  if wo.status not in ('booked', 'completed') then
    raise exception 'Only booked or completed work can be invoiced' using errcode = '55000';
  end if;

  p_invoice_number := btrim(p_invoice_number);
  if coalesce(length(p_invoice_number), 0) not between 1 and 60 then
    raise exception 'Enter the invoice number' using errcode = '22023';
  end if;
  if p_invoice_date is null or p_invoice_date < current_date - 730 or p_invoice_date > current_date + 30 then
    raise exception 'Enter a sensible invoice date' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 100000000 then
    raise exception 'Enter the invoice amount' using errcode = '22023';
  end if;
  p_amount := round(p_amount, 2);

  select amount into budget from public.assignment_budgets where assignment_id = wo.assignment_id;
  select coalesce((config ->> 'invoice_tolerance_pct')::numeric, 2) into tolerance
  from public.rmc_policies where rmc_tenant_id = wo.rmc_tenant_id;
  tolerance := coalesce(tolerance, 2);

  -- Price check: everything invoiced on this work order (not disputed) against the agreed price
  select coalesce(sum(amount), 0) into earlier from public.invoices
  where work_order_id = wo.id and status <> 'disputed';
  to_date := earlier + p_amount;
  variance := to_date - wo.agreed_cost;
  pct := case when wo.agreed_cost > 0 then round(variance * 100 / wo.agreed_cost, 2) else 100 end;
  if variance > wo.agreed_cost * tolerance / 100 then
    flag_list := array_append(flag_list, 'over_agreed_rate');
  end if;

  -- Budget check: spend on the whole relocation once this invoice counts
  remaining := coalesce(budget, 0) - (private.relocation_spend(wo.assignment_id)
    - (case when earlier > 0 then earlier else wo.agreed_cost end) + to_date);
  if remaining < 0 then
    flag_list := array_append(flag_list, 'over_budget');
  end if;

  -- Same invoice number from the same vendor already on file
  if exists (select 1 from public.invoices
             where vendor_id = wo.vendor_id and lower(invoice_number) = lower(p_invoice_number)) then
    flag_list := array_append(flag_list, 'duplicate_number');
  end if;

  insert into public.invoices (rmc_tenant_id, assignment_id, service_id, work_order_id, vendor_id,
    invoice_number, invoice_date, amount, source, document_id,
    agreed_amount, invoiced_to_date, variance_amount, variance_pct, tolerance_pct,
    budget_amount, budget_remaining_after, flags, status, recorded_by)
  values (wo.rmc_tenant_id, wo.assignment_id, wo.service_id, wo.id, wo.vendor_id,
    p_invoice_number, p_invoice_date, p_amount, p_source, p_document_id,
    wo.agreed_cost, to_date, variance, pct, tolerance,
    coalesce(budget, 0), remaining, flag_list,
    case when cardinality(flag_list) = 0 then 'matched' else 'flagged' end, p_recorded_by)
  returning * into inv;

  insert into public.work_order_events (work_order_id, rmc_tenant_id, event, note, actor, actor_profile_id)
  values (wo.id, wo.rmc_tenant_id, 'invoice',
    'Invoice ' || p_invoice_number || ' ' || inv.status, case when p_source = 'portal' then 'vendor_portal' else 'staff' end,
    p_recorded_by);
  return inv;
end
$$;
revoke all on function private.record_invoice(uuid, text, date, numeric, text, uuid, uuid) from public, anon, authenticated;
revoke all on function private.relocation_spend(uuid) from public, anon, authenticated;

alter table public.work_order_events drop constraint work_order_events_event_check;
alter table public.work_order_events add constraint work_order_events_event_check
  check (event in ('sent', 'link_renewed', 'accepted', 'declined', 'booked', 'completed', 'document',
                   'invoice', 'invoice_approved', 'invoice_disputed'));

-- --------------------------------------------------------- entry points

-- RMC staff record an invoice that arrived another way (e.g. by email).
create function public.record_invoice(p_work_order_id uuid, p_invoice_number text, p_invoice_date date, p_amount numeric)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  wo public.work_orders;
  inv public.invoices;
begin
  select * into wo from public.work_orders where id = p_work_order_id;
  if wo.id is null or not private.is_rmc_staff_for(wo.assignment_id) then
    raise exception 'Not allowed to record invoices for this relocation' using errcode = '42501';
  end if;
  inv := private.record_invoice(p_work_order_id, p_invoice_number, p_invoice_date, p_amount, 'staff', null, auth.uid());
  return inv.id;
end
$$;

-- The provider submits an invoice (with its PDF) through the work order link.
create function public.portal_submit_invoice(
  p_token text, p_invoice_number text, p_invoice_date date, p_amount numeric,
  p_storage_path text, p_file_name text, p_mime_type text, p_size_bytes int
) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  wo public.work_orders := private.work_order_for_token(p_token);
  doc_id uuid;
  inv public.invoices;
begin
  if wo.status not in ('booked', 'completed') then
    raise exception 'Mark the work as booked before sending an invoice' using errcode = '55000';
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
  values (wo.assignment_id, wo.rmc_tenant_id, wo.service_id, wo.id, 'invoice', btrim(p_file_name),
    p_storage_path, p_mime_type, p_size_bytes, 'portal')
  returning id into doc_id;

  inv := private.record_invoice(wo.id, p_invoice_number, p_invoice_date, p_amount, 'portal', doc_id, null);
  return inv.status;
end
$$;

-- A person decides on an invoice: approve (pay as invoiced) or dispute. RMC admin only; a note is required.
create function public.decide_invoice(p_invoice_id uuid, p_decision text, p_note text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  me public.profiles;
  inv public.invoices;
begin
  select * into me from public.profiles where id = auth.uid();
  select * into inv from public.invoices where id = p_invoice_id for update;
  if me.id is null or inv.id is null or me.role <> 'rmc_admin' or me.rmc_tenant_id <> inv.rmc_tenant_id then
    raise exception 'Only the RMC admin can decide on invoices' using errcode = '42501';
  end if;
  if p_decision not in ('approve', 'dispute') then
    raise exception 'Unknown decision' using errcode = '22023';
  end if;
  p_note := btrim(p_note);
  if coalesce(length(p_note), 0) not between 3 and 1000 then
    raise exception 'Add a short note explaining the decision' using errcode = '22023';
  end if;
  if inv.status not in ('matched', 'flagged') then
    raise exception 'This invoice has already been decided' using errcode = '55000';
  end if;
  update public.invoices
  set status = case when p_decision = 'approve' then 'approved' else 'disputed' end,
      decision_note = p_note, decided_by = me.id, decided_at = now()
  where id = inv.id;
  insert into public.work_order_events (work_order_id, rmc_tenant_id, event, note, actor, actor_profile_id)
  values (inv.work_order_id, inv.rmc_tenant_id,
    case when p_decision = 'approve' then 'invoice_approved' else 'invoice_disputed' end,
    inv.invoice_number || ': ' || p_note, 'staff', me.id);
end
$$;

-- The portal shows the provider its own invoices on this work order.
create or replace function public.portal_get_work_order(p_token text)
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
      from public.documents d where d.work_order_id = wo.id), '[]'::jsonb),
    'invoices', coalesce((
      select jsonb_agg(jsonb_build_object('invoice_number', i.invoice_number, 'amount', i.amount,
        'invoice_date', i.invoice_date, 'status', i.status) order by i.created_at)
      from public.invoices i where i.work_order_id = wo.id), '[]'::jsonb));
end
$$;

-- Portal uploads are also allowed once the work is completed (for invoices).
create or replace function private.portal_upload_path_ok(object_name text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select split_part(object_name, '/', 2) = 'portal'
    and exists (
      select 1 from public.work_orders w
      where w.token_hash = split_part(object_name, '/', 3)
        and w.assignment_id::text = split_part(object_name, '/', 1)
        and w.token_expires_at > now()
        and w.status in ('sent', 'accepted', 'booked', 'completed')
    )
$$;

revoke all on function public.record_invoice(uuid, text, date, numeric) from public, anon;
revoke all on function public.decide_invoice(uuid, text, text) from public, anon;
revoke all on function public.portal_submit_invoice(text, text, date, numeric, text, text, text, int) from public;
grant execute on function public.record_invoice(uuid, text, date, numeric) to authenticated;
grant execute on function public.decide_invoice(uuid, text, text) to authenticated;
grant execute on function public.portal_submit_invoice(text, text, date, numeric, text, text, text, int) to anon, authenticated;
