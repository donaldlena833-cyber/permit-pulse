-- PermitPulse security hardening
-- Goal:
-- 1. Move worker access to Supabase service_role
-- 2. Enable RLS on public tables exposed through PostgREST
-- 3. Revoke public CRUD access from anon/authenticated for worker-only tables

grant usage on schema public to service_role;

grant select, insert, update, delete on public.leads to service_role;
grant select, insert, update, delete on public.property_profiles to service_role;
grant select, insert, update, delete on public.company_profiles to service_role;
grant select, insert, update, delete on public.contacts to service_role;
grant select, insert, update, delete on public.enrichment_facts to service_role;
grant select, insert, update, delete on public.outreach to service_role;
grant select, insert, update, delete on public.activity_log to service_role;

revoke select, insert, update, delete on public.leads from anon, authenticated;
revoke select, insert, update, delete on public.property_profiles from anon, authenticated;
revoke select, insert, update, delete on public.company_profiles from anon, authenticated;
revoke select, insert, update, delete on public.contacts from anon, authenticated;
revoke select, insert, update, delete on public.enrichment_facts from anon, authenticated;
revoke select, insert, update, delete on public.outreach from anon, authenticated;
revoke select, insert, update, delete on public.activity_log from anon, authenticated;

alter table if exists public.leads enable row level security;
alter table if exists public.property_profiles enable row level security;
alter table if exists public.company_profiles enable row level security;
alter table if exists public.contacts enable row level security;
alter table if exists public.enrichment_facts enable row level security;
alter table if exists public.outreach enable row level security;
alter table if exists public.activity_log enable row level security;

-- Legacy or auxiliary tables that still show up in Supabase lints.
do $$
begin
  if to_regclass('public.outreach_drafts') is not null then
    execute 'grant select, insert, update, delete on public.outreach_drafts to service_role';
    execute 'revoke select, insert, update, delete on public.outreach_drafts from anon, authenticated';
    execute 'alter table public.outreach_drafts enable row level security';
  end if;

  if to_regclass('public.email_sends') is not null then
    execute 'grant select, insert, update, delete on public.email_sends to service_role';
    execute 'revoke select, insert, update, delete on public.email_sends from anon, authenticated';
    execute 'alter table public.email_sends enable row level security';
  end if;

  if to_regclass('public.config') is not null then
    execute 'grant select, insert, update, delete on public.config to service_role';
    execute 'revoke select, insert, update, delete on public.config from anon, authenticated';
    execute 'alter table public.config enable row level security';
  end if;
end
$$;
