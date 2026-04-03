grant usage on schema public to service_role;

grant select, insert, update, delete on public.v2_prospect_import_batches to service_role;
grant select, insert, update, delete on public.v2_prospects to service_role;
grant select, insert, update, delete on public.v2_prospect_events to service_role;
grant select, insert, update, delete on public.v2_prospect_outcomes to service_role;

revoke select, insert, update, delete on public.v2_prospect_import_batches from anon, authenticated;
revoke select, insert, update, delete on public.v2_prospects from anon, authenticated;
revoke select, insert, update, delete on public.v2_prospect_events from anon, authenticated;
revoke select, insert, update, delete on public.v2_prospect_outcomes from anon, authenticated;

alter table if exists public.v2_prospect_import_batches enable row level security;
alter table if exists public.v2_prospects enable row level security;
alter table if exists public.v2_prospect_events enable row level security;
alter table if exists public.v2_prospect_outcomes enable row level security;
