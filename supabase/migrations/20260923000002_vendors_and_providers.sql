-- Relo OS — MVP items 3-5: the RMC's vendor network and picking a provider per service.
-- New tables: vendors, vendor_rates. plan_services gains the chosen provider and agreed cost.

create table public.vendors (
  id uuid primary key default gen_random_uuid(),
  rmc_tenant_id uuid not null references public.rmc_tenants (id) on delete restrict,
  name text not null check (length(name) between 1 and 200),
  contact_email text not null check (contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(contact_email) <= 254),
  city text not null default '' check (length(city) <= 200),
  created_at timestamptz not null default now(),
  unique (id, rmc_tenant_id)
);
create index on public.vendors (rmc_tenant_id);

-- The agreed rate a vendor charges for one type of service.
create table public.vendor_rates (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null,
  rmc_tenant_id uuid not null,
  category text not null check (category in (
    'immigration', 'flights', 'temporary_housing', 'household_goods',
    'school_search', 'settling_in', 'other')),
  rate numeric(14, 2) not null check (rate >= 0 and rate <= 100000000),
  rate_basis text not null default 'per_family' check (rate_basis in ('per_family', 'per_person')),
  description text not null default '' check (length(description) <= 500),
  unique (vendor_id, category),
  foreign key (vendor_id, rmc_tenant_id) references public.vendors (id, rmc_tenant_id) on delete cascade
);
create index on public.vendor_rates (rmc_tenant_id);

-- A vendor login belongs to one vendor company.
alter table public.profiles add column vendor_id uuid;
alter table public.profiles
  add constraint profiles_vendor_fk foreign key (vendor_id, rmc_tenant_id) references public.vendors (id, rmc_tenant_id),
  add constraint profiles_vendor_only_for_vendors check (vendor_id is null or role = 'vendor');
create index on public.profiles (vendor_id);

-- The chosen provider for a service and the price agreed with them.
alter table public.plan_services
  add column selected_vendor_id uuid,
  add column agreed_cost numeric(14, 2) check (agreed_cost >= 0),
  add column agreed_over_cap boolean not null default false,
  add column selected_by uuid references public.profiles (id) on delete set null,
  add column selected_at timestamptz,
  add constraint plan_services_vendor_fk foreign key (selected_vendor_id, rmc_tenant_id)
    references public.vendors (id, rmc_tenant_id),
  add constraint plan_services_selection_complete
    check ((selected_vendor_id is null) = (agreed_cost is null));
create index on public.plan_services (selected_vendor_id);

-- ------------------------------------------------------------------ RLS

create function private.my_vendor() returns uuid
language sql stable security definer set search_path = ''
as $$ select vendor_id from public.profiles where id = auth.uid() $$;
revoke all on function private.my_vendor() from public, anon;
grant execute on function private.my_vendor() to authenticated;

alter table public.vendors enable row level security;
alter table public.vendor_rates enable row level security;

revoke all on public.vendors, public.vendor_rates from anon;
revoke insert, update, delete, truncate on public.vendors, public.vendor_rates from authenticated;
grant select on public.vendors, public.vendor_rates to authenticated;

create policy "rmc staff see tenant vendors" on public.vendors
  for select to authenticated
  using (
    (select private.my_role()) in ('rmc_admin', 'consultant')
    and rmc_tenant_id = (select private.my_tenant())
  );

-- HR sees only the vendors chosen for their own company's services.
create policy "hr sees vendors chosen for own company" on public.vendors
  for select to authenticated
  using (
    (select private.my_role()) = 'hr_user'
    and exists (
      select 1 from public.plan_services s
      join public.assignments a on a.id = s.assignment_id
      where s.selected_vendor_id = vendors.id
        and a.client_company_id = (select private.my_company())
    )
  );

create policy "vendor sees own company" on public.vendors
  for select to authenticated
  using ((select private.my_role()) = 'vendor' and id = (select private.my_vendor()));

-- Rate cards are commercial terms between the RMC and its vendors: RMC staff only.
create policy "rmc staff see tenant rates" on public.vendor_rates
  for select to authenticated
  using (
    (select private.my_role()) in ('rmc_admin', 'consultant')
    and rmc_tenant_id = (select private.my_tenant())
  );

-- --------------------------------------------------------- write path

-- MVP item 5: the RMC admin or the allocated consultant picks a provider for a
-- service. The agreed cost comes from the vendor's rate, never from the caller,
-- and is checked against the RMC's policy cap.
create function public.select_service_provider(p_service_id uuid, p_vendor_id uuid)
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
  if me.id is null or svc.id is null then
    raise exception 'Not allowed to choose a provider for this service' using errcode = '42501';
  end if;
  select * into a from public.assignments where id = svc.assignment_id;

  if not (
    (me.role = 'rmc_admin' and me.rmc_tenant_id = svc.rmc_tenant_id)
    or (me.role = 'consultant' and exists (
      select 1 from public.assignment_consultants ac
      where ac.assignment_id = svc.assignment_id and ac.consultant_id = me.id))
  ) then
    raise exception 'Not allowed to choose a provider for this service' using errcode = '42501';
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
      selected_at = now()
  where id = p_service_id;
end
$$;

revoke all on function public.select_service_provider(uuid, uuid) from public, anon;
grant execute on function public.select_service_provider(uuid, uuid) to authenticated;
