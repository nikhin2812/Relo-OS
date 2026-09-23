-- Fix: build the flag list with array_append (text[] || 'literal' was read as an array literal).
create or replace function private.record_invoice(
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
