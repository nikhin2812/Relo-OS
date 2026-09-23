-- Security Advisor: pin the search path on private.needs_approval (no behaviour change).
alter function private.needs_approval(public.plan_services) set search_path = '';
