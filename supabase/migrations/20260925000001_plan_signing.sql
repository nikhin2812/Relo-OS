-- Only the app's server can save AI plans.
-- Before: anyone allowed to see a costed plan (e.g. HR) could call save_relocation_plan
-- directly with a hand-written plan. Now each plan must carry a signature made with a
-- secret that only the server (PLAN_SIGNING_SECRET) and this database know.
-- The secret is never in the repo: after this migration, the owner runs
--   select private.new_plan_signing_secret();
-- in the Supabase SQL editor and copies the result into the server's settings.

create table private.plan_signing_key (
  id boolean primary key default true check (id),
  secret text not null check (length(secret) >= 32),
  created_at timestamptz not null default now()
);
alter table private.plan_signing_key enable row level security;
revoke all on private.plan_signing_key from public, anon, authenticated;

-- Creates (or replaces) the secret and shows it once. Database owner only.
create function private.new_plan_signing_secret() returns text
language plpgsql security definer set search_path = ''
as $$
declare
  s text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  insert into private.plan_signing_key (id, secret) values (true, s)
  on conflict (id) do update set secret = excluded.secret, created_at = now();
  return s;
end
$$;
revoke all on function private.new_plan_signing_secret() from public, anon, authenticated;

-- Signature = hex HMAC-SHA256 of "<assignment id>.<signed at, ms>.<model>.<plan JSON text>".
-- Must match src/lib/planner/signing.ts.
create function private.plan_signature_ok(p_assignment_id uuid, p_plan text, p_model text,
  p_signed_at bigint, p_signature text) returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  k text;
begin
  select secret into k from private.plan_signing_key;
  if k is null then
    raise exception 'Plan signing is not set up on this database';
  end if;
  if p_signed_at is null or p_signature is null
     or abs(extract(epoch from now()) * 1000 - p_signed_at) > 600000 then
    return false;
  end if;
  return p_signature = encode(extensions.hmac(
    convert_to(p_assignment_id::text || '.' || p_signed_at || '.' || p_model || '.' || p_plan, 'UTF8'),
    convert_to(k, 'UTF8'), 'sha256'), 'hex');
end
$$;
revoke all on function private.plan_signature_ok(uuid, text, text, bigint, text) from public, anon, authenticated;

drop function public.save_relocation_plan(uuid, jsonb, text);

create function public.save_relocation_plan(p_assignment_id uuid, p_plan text, p_model text,
  p_signed_at bigint, p_signature text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  plan jsonb;
  plan_row public.relocation_plans;
  svc jsonb;
  ms jsonb;
begin
  if not private.can_view_costed_plan(p_assignment_id) then
    raise exception 'Not allowed to plan this relocation' using errcode = '42501';
  end if;
  if length(p_plan) > 200000
     or not private.plan_signature_ok(p_assignment_id, p_plan, p_model, p_signed_at, p_signature) then
    raise exception 'Plans can only be saved by the Relo OS planner' using errcode = '42501';
  end if;
  plan := p_plan::jsonb;

  select * into plan_row from public.relocation_plans
  where assignment_id = p_assignment_id
  for update;
  if plan_row.assignment_id is null then
    raise exception 'No plan record for this relocation' using errcode = 'P0002';
  end if;
  if plan_row.status = 'ready' then
    raise exception 'This relocation already has a plan' using errcode = '55000';
  end if;

  if jsonb_typeof(plan -> 'services') is distinct from 'array'
     or jsonb_array_length(plan -> 'services') not between 1 and 20
     or jsonb_typeof(plan -> 'milestones') is distinct from 'array'
     or jsonb_array_length(plan -> 'milestones') > 30 then
    raise exception 'Plan must have 1-20 services and at most 30 milestones' using errcode = '22023';
  end if;

  for svc in select * from jsonb_array_elements(plan -> 'services') loop
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

  for ms in select * from jsonb_array_elements(plan -> 'milestones') loop
    insert into public.plan_milestones (assignment_id, rmc_tenant_id, title, due_date,
      sequence, related_service_keys)
    values (p_assignment_id, plan_row.rmc_tenant_id, ms ->> 'title', (ms ->> 'due_date')::date,
      (ms ->> 'sequence')::int,
      coalesce(array(select jsonb_array_elements_text(ms -> 'related_service_keys')), '{}'));
  end loop;

  perform private.create_journey_tasks(p_assignment_id);

  update public.relocation_plans
  set status = 'ready', summary = left(plan ->> 'summary', 2000), model = left(p_model, 100),
      error_message = null, attempts = attempts + 1, generated_at = now(), updated_at = now()
  where assignment_id = p_assignment_id;

  update public.assignments set status = 'planned'
  where id = p_assignment_id and status = 'requested';
end
$$;
revoke all on function public.save_relocation_plan(uuid, text, text, bigint, text) from public, anon;
grant execute on function public.save_relocation_plan(uuid, text, text, bigint, text) to authenticated;
