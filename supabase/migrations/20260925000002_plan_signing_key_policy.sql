-- Explicit "nobody through the API" rule for the signing secret (it already had RLS on and no
-- grants; this makes the intent visible and satisfies "no table without policies").
create policy "nobody reads or writes the signing key through the API" on private.plan_signing_key
  for all to anon, authenticated using (false) with check (false);
