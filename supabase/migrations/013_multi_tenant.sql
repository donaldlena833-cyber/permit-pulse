create extension if not exists pgcrypto;

alter table if exists public.v2_tenants
  add column if not exists business_name text,
  add column if not exists attachment_filename text,
  add column if not exists attachment_content_type text default 'application/pdf',
  add column if not exists features jsonb default '{"permit_scanning": false, "prospect_outreach": true}'::jsonb,
  add column if not exists updated_at timestamptz default now();

alter table if exists public.v2_tenant_users
  add column if not exists auth_user_id uuid references auth.users(id) on delete set null,
  add column if not exists status text default 'active';

update public.v2_tenant_users
set status = coalesce(nullif(status, ''), 'active')
where status is null or status = '';

update public.v2_tenant_users tenant_users
set auth_user_id = auth_users.id
from auth.users auth_users
where tenant_users.auth_user_id is null
  and lower(coalesce(tenant_users.email, '')) = lower(coalesce(auth_users.email, ''));

update public.v2_tenants
set
  business_name = coalesce(nullif(business_name, ''), name),
  attachment_content_type = coalesce(nullif(attachment_content_type, ''), 'application/pdf'),
  features = coalesce(features, '{"permit_scanning": false, "prospect_outreach": true}'::jsonb),
  updated_at = coalesce(updated_at, timezone('utc', now()));

alter table if exists public.v2_tenants
  alter column features set not null;

update public.v2_tenants
set
  business_name = 'MetroGlass Pro',
  icon = coalesce(nullif(icon, ''), 'MG'),
  attachment_filename = coalesce(nullif(attachment_filename, ''), 'MetroGlass Pro - About Us.pdf'),
  features = '{"permit_scanning": true, "prospect_outreach": true}'::jsonb,
  outreach_pitch = coalesce(
    nullif(outreach_pitch, ''),
    'handle custom glass installations including shower enclosures, mirrors, partitions, cabinet glass, and railings'
  ),
  outreach_focus = coalesce(
    nullif(outreach_focus, ''),
    'We support architects, designers, contractors, and property teams with clean fabrication, fast field coordination, and reliable closeout on glass scope.'
  ),
  outreach_cta = coalesce(
    nullif(outreach_cta, ''),
    'If there is any upcoming glass scope, I would be glad to connect, turn around pricing quickly, and help keep things moving.'
  )
where slug = 'metroglasspro';

update public.v2_tenants
set
  business_name = 'Lokeil Remodeling',
  icon = coalesce(nullif(icon, ''), 'LK'),
  attachment_filename = coalesce(nullif(attachment_filename, ''), 'LOKEIL - About Us.pdf'),
  features = '{"permit_scanning": false, "prospect_outreach": true}'::jsonb,
  outreach_pitch = coalesce(
    nullif(outreach_pitch, ''),
    'handle kitchen renovations, bathroom remodels, flooring, and finish carpentry'
  ),
  outreach_focus = coalesce(
    nullif(outreach_focus, ''),
    'We help architects, designers, contractors, and property teams move remodeling scope with disciplined scheduling, field execution, and finish quality.'
  ),
  outreach_cta = coalesce(
    nullif(outreach_cta, ''),
    'If there is any upcoming remodeling scope, I would be glad to connect, turn around pricing quickly, and help keep things moving.'
  )
where slug = 'lokeilrenovating';

alter table public.v2_prospects add column if not exists tenant_id uuid references public.v2_tenants(id);
alter table public.v2_prospect_import_batches add column if not exists tenant_id uuid references public.v2_tenants(id);
alter table public.v2_prospect_events add column if not exists tenant_id uuid references public.v2_tenants(id);
alter table public.v2_prospect_outcomes add column if not exists tenant_id uuid references public.v2_tenants(id);
alter table public.v2_prospect_follow_ups add column if not exists tenant_id uuid references public.v2_tenants(id);
alter table public.v2_prospect_companies add column if not exists tenant_id uuid references public.v2_tenants(id);
alter table public.v2_prospect_campaigns add column if not exists tenant_id uuid references public.v2_tenants(id);
alter table public.v2_prospect_suppressions add column if not exists tenant_id uuid references public.v2_tenants(id);
alter table public.v2_outreach_review_queue add column if not exists tenant_id uuid references public.v2_tenants(id);
alter table public.v2_leads add column if not exists tenant_id uuid references public.v2_tenants(id);
alter table public.v2_automation_runs add column if not exists tenant_id uuid references public.v2_tenants(id);
alter table public.v2_lead_events add column if not exists tenant_id uuid references public.v2_tenants(id);
alter table public.v2_lead_jobs add column if not exists tenant_id uuid references public.v2_tenants(id);
alter table public.v2_email_candidates add column if not exists tenant_id uuid references public.v2_tenants(id);
alter table public.v2_company_candidates add column if not exists tenant_id uuid references public.v2_tenants(id);
alter table public.v2_email_outcomes add column if not exists tenant_id uuid references public.v2_tenants(id);
alter table public.v2_follow_ups add column if not exists tenant_id uuid references public.v2_tenants(id);
alter table public.v2_related_permits add column if not exists tenant_id uuid references public.v2_tenants(id);
alter table public.v2_app_config add column if not exists tenant_id uuid references public.v2_tenants(id);

update public.v2_prospects
set tenant_id = 'b1d46be5-2eb7-4d5c-8098-15abf581b7d6'
where tenant_id is null;

update public.v2_prospect_import_batches
set tenant_id = 'b1d46be5-2eb7-4d5c-8098-15abf581b7d6'
where tenant_id is null;

update public.v2_prospect_events event_rows
set tenant_id = prospects.tenant_id
from public.v2_prospects prospects
where event_rows.prospect_id = prospects.id
  and event_rows.tenant_id is null;

update public.v2_prospect_outcomes outcome_rows
set tenant_id = prospects.tenant_id
from public.v2_prospects prospects
where outcome_rows.prospect_id = prospects.id
  and outcome_rows.tenant_id is null;

update public.v2_prospect_follow_ups follow_up_rows
set tenant_id = prospects.tenant_id
from public.v2_prospects prospects
where follow_up_rows.prospect_id = prospects.id
  and follow_up_rows.tenant_id is null;

update public.v2_prospect_companies
set tenant_id = 'b1d46be5-2eb7-4d5c-8098-15abf581b7d6'
where tenant_id is null;

update public.v2_prospect_campaigns
set tenant_id = 'b1d46be5-2eb7-4d5c-8098-15abf581b7d6'
where tenant_id is null;

update public.v2_prospect_suppressions suppression_rows
set tenant_id = prospects.tenant_id
from public.v2_prospects prospects
where suppression_rows.prospect_id = prospects.id
  and suppression_rows.tenant_id is null;

update public.v2_prospect_suppressions suppression_rows
set tenant_id = companies.tenant_id
from public.v2_prospect_companies companies
where suppression_rows.company_id = companies.id
  and suppression_rows.tenant_id is null;

update public.v2_outreach_review_queue
set tenant_id = 'b1d46be5-2eb7-4d5c-8098-15abf581b7d6'
where tenant_id is null;

update public.v2_leads
set tenant_id = 'b1d46be5-2eb7-4d5c-8098-15abf581b7d6'
where tenant_id is null;

update public.v2_automation_runs
set tenant_id = 'b1d46be5-2eb7-4d5c-8098-15abf581b7d6'
where tenant_id is null;

update public.v2_lead_events event_rows
set tenant_id = leads.tenant_id
from public.v2_leads leads
where event_rows.lead_id = leads.id
  and event_rows.tenant_id is null;

update public.v2_lead_jobs job_rows
set tenant_id = leads.tenant_id
from public.v2_leads leads
where job_rows.lead_id = leads.id
  and job_rows.tenant_id is null;

update public.v2_lead_jobs job_rows
set tenant_id = runs.tenant_id
from public.v2_automation_runs runs
where job_rows.run_id = runs.id
  and job_rows.tenant_id is null;

update public.v2_email_candidates candidate_rows
set tenant_id = leads.tenant_id
from public.v2_leads leads
where candidate_rows.lead_id = leads.id
  and candidate_rows.tenant_id is null;

update public.v2_company_candidates company_rows
set tenant_id = leads.tenant_id
from public.v2_leads leads
where company_rows.lead_id = leads.id
  and company_rows.tenant_id is null;

update public.v2_email_outcomes outcome_rows
set tenant_id = leads.tenant_id
from public.v2_leads leads
where outcome_rows.lead_id = leads.id
  and outcome_rows.tenant_id is null;

update public.v2_follow_ups follow_up_rows
set tenant_id = leads.tenant_id
from public.v2_leads leads
where follow_up_rows.lead_id = leads.id
  and follow_up_rows.tenant_id is null;

update public.v2_related_permits permit_rows
set tenant_id = leads.tenant_id
from public.v2_leads leads
where permit_rows.lead_id = leads.id
  and permit_rows.tenant_id is null;

update public.v2_app_config
set tenant_id = 'b1d46be5-2eb7-4d5c-8098-15abf581b7d6'
where tenant_id is null;

update public.v2_prospect_events
set tenant_id = 'b1d46be5-2eb7-4d5c-8098-15abf581b7d6'
where tenant_id is null;

update public.v2_prospect_outcomes
set tenant_id = 'b1d46be5-2eb7-4d5c-8098-15abf581b7d6'
where tenant_id is null;

update public.v2_prospect_follow_ups
set tenant_id = 'b1d46be5-2eb7-4d5c-8098-15abf581b7d6'
where tenant_id is null;

update public.v2_prospect_suppressions
set tenant_id = 'b1d46be5-2eb7-4d5c-8098-15abf581b7d6'
where tenant_id is null;

update public.v2_lead_events
set tenant_id = 'b1d46be5-2eb7-4d5c-8098-15abf581b7d6'
where tenant_id is null;

update public.v2_lead_jobs
set tenant_id = 'b1d46be5-2eb7-4d5c-8098-15abf581b7d6'
where tenant_id is null;

update public.v2_email_candidates
set tenant_id = 'b1d46be5-2eb7-4d5c-8098-15abf581b7d6'
where tenant_id is null;

update public.v2_company_candidates
set tenant_id = 'b1d46be5-2eb7-4d5c-8098-15abf581b7d6'
where tenant_id is null;

update public.v2_email_outcomes
set tenant_id = 'b1d46be5-2eb7-4d5c-8098-15abf581b7d6'
where tenant_id is null;

update public.v2_follow_ups
set tenant_id = 'b1d46be5-2eb7-4d5c-8098-15abf581b7d6'
where tenant_id is null;

update public.v2_related_permits
set tenant_id = 'b1d46be5-2eb7-4d5c-8098-15abf581b7d6'
where tenant_id is null;

alter table public.v2_app_config drop constraint if exists v2_app_config_pkey;
drop index if exists idx_v2_leads_permit_key;
drop index if exists idx_v2_prospect_companies_domain;
drop index if exists idx_v2_prospect_companies_name;
drop index if exists idx_v2_prospect_campaigns_active_category;
drop index if exists idx_v2_prospect_suppressions_scope;
drop index if exists idx_v2_outreach_review_queue_message;
alter table public.v2_prospects drop constraint if exists v2_prospects_email_normalized_key;

create unique index if not exists idx_v2_leads_tenant_permit_key
  on public.v2_leads(tenant_id, permit_key);

create unique index if not exists idx_v2_prospects_tenant_email
  on public.v2_prospects(tenant_id, email_normalized);

create unique index if not exists idx_v2_prospect_companies_tenant_domain
  on public.v2_prospect_companies(tenant_id, domain)
  where domain is not null;

create unique index if not exists idx_v2_prospect_companies_tenant_name
  on public.v2_prospect_companies(tenant_id, normalized_name);

create unique index if not exists idx_v2_prospect_campaigns_tenant_active_category
  on public.v2_prospect_campaigns(tenant_id, category, template_variant, status);

create unique index if not exists idx_v2_prospect_suppressions_tenant_scope
  on public.v2_prospect_suppressions(tenant_id, scope_type, scope_value)
  where active = true;

create unique index if not exists idx_v2_outreach_review_queue_tenant_message
  on public.v2_outreach_review_queue(tenant_id, gmail_message_id);

alter table public.v2_prospects alter column tenant_id set not null;
alter table public.v2_prospect_import_batches alter column tenant_id set not null;
alter table public.v2_prospect_events alter column tenant_id set not null;
alter table public.v2_prospect_outcomes alter column tenant_id set not null;
alter table public.v2_prospect_follow_ups alter column tenant_id set not null;
alter table public.v2_prospect_companies alter column tenant_id set not null;
alter table public.v2_prospect_campaigns alter column tenant_id set not null;
alter table public.v2_prospect_suppressions alter column tenant_id set not null;
alter table public.v2_outreach_review_queue alter column tenant_id set not null;
alter table public.v2_leads alter column tenant_id set not null;
alter table public.v2_automation_runs alter column tenant_id set not null;
alter table public.v2_lead_events alter column tenant_id set not null;
alter table public.v2_lead_jobs alter column tenant_id set not null;
alter table public.v2_email_candidates alter column tenant_id set not null;
alter table public.v2_company_candidates alter column tenant_id set not null;
alter table public.v2_email_outcomes alter column tenant_id set not null;
alter table public.v2_follow_ups alter column tenant_id set not null;
alter table public.v2_related_permits alter column tenant_id set not null;
alter table public.v2_app_config alter column tenant_id set not null;

alter table public.v2_app_config
  add primary key (tenant_id, key);

create index if not exists idx_v2_prospects_tenant on public.v2_prospects(tenant_id);
create index if not exists idx_v2_prospect_import_batches_tenant on public.v2_prospect_import_batches(tenant_id);
create index if not exists idx_v2_prospect_events_tenant on public.v2_prospect_events(tenant_id);
create index if not exists idx_v2_prospect_outcomes_tenant on public.v2_prospect_outcomes(tenant_id);
create index if not exists idx_v2_prospect_follow_ups_tenant on public.v2_prospect_follow_ups(tenant_id);
create index if not exists idx_v2_prospect_companies_tenant on public.v2_prospect_companies(tenant_id);
create index if not exists idx_v2_prospect_campaigns_tenant on public.v2_prospect_campaigns(tenant_id);
create index if not exists idx_v2_prospect_suppressions_tenant on public.v2_prospect_suppressions(tenant_id);
create index if not exists idx_v2_outreach_review_queue_tenant on public.v2_outreach_review_queue(tenant_id);
create index if not exists idx_v2_leads_tenant on public.v2_leads(tenant_id);
create index if not exists idx_v2_automation_runs_tenant on public.v2_automation_runs(tenant_id);
create index if not exists idx_v2_lead_events_tenant on public.v2_lead_events(tenant_id);
create index if not exists idx_v2_lead_jobs_tenant on public.v2_lead_jobs(tenant_id);
create index if not exists idx_v2_email_candidates_tenant on public.v2_email_candidates(tenant_id);
create index if not exists idx_v2_company_candidates_tenant on public.v2_company_candidates(tenant_id);
create index if not exists idx_v2_email_outcomes_tenant on public.v2_email_outcomes(tenant_id);
create index if not exists idx_v2_follow_ups_tenant on public.v2_follow_ups(tenant_id);
create index if not exists idx_v2_related_permits_tenant on public.v2_related_permits(tenant_id);
create index if not exists idx_v2_app_config_tenant on public.v2_app_config(tenant_id);
create index if not exists idx_v2_tenant_users_auth_user_id on public.v2_tenant_users(auth_user_id);
create index if not exists idx_v2_tenant_users_email on public.v2_tenant_users(lower(email));

create table if not exists public.v2_tenant_email_templates (
  id uuid default gen_random_uuid() primary key,
  tenant_id uuid not null references public.v2_tenants(id),
  template_kind text not null check (
    template_kind in (
      'prospect_initial',
      'prospect_follow_up_1',
      'prospect_follow_up_2',
      'permit_initial',
      'permit_follow_up_1',
      'permit_follow_up_2'
    )
  ),
  category text check (category in ('interior_designer', 'gc', 'property_manager', 'project_manager', 'architect')),
  subject_template text not null,
  body_template text not null,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (tenant_id, template_kind, category)
);

create unique index if not exists idx_v2_tenant_email_templates_scope
  on public.v2_tenant_email_templates(tenant_id, template_kind, coalesce(category, '__all__'));

create index if not exists idx_v2_tenant_email_templates_tenant
  on public.v2_tenant_email_templates(tenant_id);

create table if not exists public.v2_tenant_gmail_credentials (
  id uuid default gen_random_uuid() primary key,
  tenant_id uuid not null references public.v2_tenants(id) unique,
  gmail_address text not null,
  client_id text not null,
  client_secret_encrypted text not null,
  refresh_token_encrypted text not null,
  token_status text default 'active' check (token_status in ('active', 'expired', 'revoked')),
  last_token_refresh_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create or replace function public.encrypt_gmail_secret(secret_value text, secret_key text)
returns text
language sql
security definer
set search_path = public, extensions
as $$
  select armor(pgp_sym_encrypt(secret_value, secret_key, 'cipher-algo=aes256'));
$$;

create or replace function public.decrypt_gmail_secret(ciphertext text, secret_key text)
returns text
language sql
security definer
set search_path = public, extensions
as $$
  select pgp_sym_decrypt(dearmor(ciphertext), secret_key);
$$;

revoke all on function public.encrypt_gmail_secret(text, text) from public;
revoke all on function public.decrypt_gmail_secret(text, text) from public;
grant execute on function public.encrypt_gmail_secret(text, text) to service_role;
grant execute on function public.decrypt_gmail_secret(text, text) to service_role;

with target_tenants as (
  select id as tenant_id
  from public.v2_tenants
  where slug in ('metroglasspro', 'lokeilrenovating')
),
template_seed(template_kind, category, subject_template, body_template) as (
  values
    (
      'prospect_initial',
      null,
      '{{company_name}} | {{business_name}}',
      E'Hi {{first_name}},\n\nI''m {{sender_name}} from {{business_name}}, and I''m reaching out because {{company_name}} looks closely aligned with the kind of work we support.\n\nWe {{category_pitch}}.\n\n{{category_focus}}\n\nI attached our About Us one-pager so you can get a quick feel for the work, responsiveness, and detail we bring to projects.\n\n{{outreach_cta}}\n\nWarm regards,\n{{sender_name}}\n{{business_name}}\n{{sender_phone}}\n{{website}}'
    ),
    (
      'prospect_follow_up_1',
      null,
      'Quick follow-up for {{company_name}} | {{business_name}}',
      E'Hi {{first_name}},\n\nFollowing up on my note from {{business_name}}.\n\nWe {{category_pitch}}, and {{category_focus}}\n\nIf there is any upcoming scope, I would be glad to send over our About Us one-pager again and map out quick next steps.\n\n{{outreach_cta}}\n\nWarm regards,\n{{sender_name}}\n{{business_name}}\n{{sender_phone}}\n{{website}}'
    ),
    (
      'prospect_follow_up_2',
      null,
      'Final follow-up for {{company_name}} | {{business_name}}',
      E'Hi {{first_name}},\n\nOne last note from {{business_name}}.\n\nWe {{category_pitch}}, and {{category_focus}}\n\nIf there is any upcoming scope, I would still be glad to share our About Us one-pager and connect on quick next steps.\n\n{{outreach_cta}}\n\nWarm regards,\n{{sender_name}}\n{{business_name}}\n{{sender_phone}}\n{{website}}'
    ),
    (
      'permit_initial',
      null,
      'Quick note on {{address}}',
      E'Hi {{first_name}},\n\nI saw the filing for {{address}} and wanted to reach out.\n\nI''m with {{business_name}}. We {{category_pitch}}.\n\n{{category_focus}}\n\n{{outreach_cta}}\n\nBest,\n{{sender_name}}\n{{business_name}}\n{{sender_phone}}\n{{website}}'
    ),
    (
      'permit_follow_up_1',
      null,
      'Following up on {{address}}',
      E'Hi {{first_name}},\n\nWanted to follow up on my note about {{address}}.\n\nWe {{category_pitch}}, and {{category_focus}}\n\n{{outreach_cta}}\n\nBest,\n{{sender_name}}\n{{business_name}}\n{{sender_phone}}\n{{website}}'
    ),
    (
      'permit_follow_up_2',
      null,
      'Final follow up for {{address}}',
      E'Hi {{first_name}},\n\nJust wanted to make sure this did not get buried.\n\nWe {{category_pitch}}, and {{category_focus}}\n\n{{outreach_cta}}\n\nBest,\n{{sender_name}}\n{{business_name}}\n{{sender_phone}}\n{{website}}'
    )
)
insert into public.v2_tenant_email_templates (
  tenant_id,
  template_kind,
  category,
  subject_template,
  body_template
)
select
  tenants.tenant_id,
  seed.template_kind,
  seed.category,
  seed.subject_template,
  seed.body_template
from target_tenants tenants
cross join template_seed seed
where not exists (
  select 1
  from public.v2_tenant_email_templates existing
  where existing.tenant_id = tenants.tenant_id
    and existing.template_kind = seed.template_kind
    and coalesce(existing.category, '__all__') = coalesce(seed.category, '__all__')
);

insert into public.v2_app_config (tenant_id, key, value)
select
  lokeil.id,
  config.key,
  case
    when config.key = 'prospect_pilot_enabled' then 'false'::jsonb
    else config.value
  end
from public.v2_tenants metro
join public.v2_tenants lokeil
  on lokeil.slug = 'lokeilrenovating'
join public.v2_app_config config
  on config.tenant_id = metro.id
where metro.slug = 'metroglasspro'
on conflict (tenant_id, key) do update
set value = excluded.value,
    updated_at = timezone('utc', now());

insert into public.v2_prospect_campaigns (
  tenant_id,
  name,
  category,
  status,
  template_variant,
  daily_cap,
  send_time_local,
  timezone
)
select
  lokeil.id,
  campaign.name,
  campaign.category,
  campaign.status,
  campaign.template_variant,
  campaign.daily_cap,
  campaign.send_time_local,
  campaign.timezone
from public.v2_tenants metro
join public.v2_tenants lokeil
  on lokeil.slug = 'lokeilrenovating'
join public.v2_prospect_campaigns campaign
  on campaign.tenant_id = metro.id
where metro.slug = 'metroglasspro'
on conflict do nothing;

grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on public.v2_tenants to service_role;
grant select, insert, update, delete on public.v2_tenant_users to service_role;
grant select, insert, update, delete on public.v2_tenant_email_templates to service_role;
grant select, insert, update, delete on public.v2_tenant_gmail_credentials to service_role;

grant select on public.v2_tenants to authenticated;
grant select on public.v2_tenant_users to authenticated;

do $$
declare
  tenant_select_tables text[] := array[
    'v2_prospects',
    'v2_prospect_import_batches',
    'v2_prospect_events',
    'v2_prospect_outcomes',
    'v2_prospect_follow_ups',
    'v2_prospect_companies',
    'v2_prospect_campaigns',
    'v2_prospect_suppressions',
    'v2_outreach_review_queue',
    'v2_leads',
    'v2_automation_runs',
    'v2_lead_events',
    'v2_lead_jobs',
    'v2_email_candidates',
    'v2_company_candidates',
    'v2_email_outcomes',
    'v2_follow_ups',
    'v2_related_permits',
    'v2_app_config',
    'v2_tenant_email_templates'
  ];
  service_only_tables text[] := array[
    'v2_tenant_gmail_credentials',
    'v2_domain_health',
    'v2_domain_reputation'
  ];
  table_name text;
begin
  foreach table_name in array tenant_select_tables loop
    execute format('grant select on table public.%I to authenticated', table_name);
    execute format('grant select, insert, update, delete on table public.%I to service_role', table_name);
    execute format('revoke all on table public.%I from anon', table_name);
    execute format('alter table public.%I enable row level security', table_name);
  end loop;

  foreach table_name in array service_only_tables loop
    execute format('grant select, insert, update, delete on table public.%I to service_role', table_name);
    execute format('revoke all on table public.%I from anon, authenticated', table_name);
    execute format('alter table public.%I enable row level security', table_name);
  end loop;
end
$$;

create or replace function public.current_auth_tenant_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select distinct tenant_users.tenant_id
  from public.v2_tenant_users tenant_users
  where coalesce(tenant_users.status, 'active') = 'active'
    and (
      (auth.uid() is not null and tenant_users.auth_user_id = auth.uid())
      or lower(coalesce(tenant_users.email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
    );
$$;

revoke all on function public.current_auth_tenant_ids() from public;
grant execute on function public.current_auth_tenant_ids() to authenticated, service_role;

do $$
declare
  tenant_policy_tables text[] := array[
    'v2_prospects',
    'v2_prospect_import_batches',
    'v2_prospect_events',
    'v2_prospect_outcomes',
    'v2_prospect_follow_ups',
    'v2_prospect_companies',
    'v2_prospect_campaigns',
    'v2_prospect_suppressions',
    'v2_outreach_review_queue',
    'v2_leads',
    'v2_automation_runs',
    'v2_lead_events',
    'v2_lead_jobs',
    'v2_email_candidates',
    'v2_company_candidates',
    'v2_email_outcomes',
    'v2_follow_ups',
    'v2_related_permits',
    'v2_app_config',
    'v2_tenant_email_templates'
  ];
  table_name text;
  policy_name text;
begin
  foreach table_name in array tenant_policy_tables loop
    policy_name := table_name || '_tenant_select';
    execute format('drop policy if exists %I on public.%I', policy_name, table_name);
    execute format(
      'create policy %I on public.%I for select to authenticated using (tenant_id in (select public.current_auth_tenant_ids()))',
      policy_name,
      table_name
    );
  end loop;
end
$$;

alter table public.v2_tenants enable row level security;
drop policy if exists v2_tenants_self_select on public.v2_tenants;
create policy v2_tenants_self_select
  on public.v2_tenants
  for select
  to authenticated
  using (id in (select public.current_auth_tenant_ids()));

alter table public.v2_tenant_users enable row level security;
drop policy if exists v2_tenant_users_self_select on public.v2_tenant_users;
create policy v2_tenant_users_self_select
  on public.v2_tenant_users
  for select
  to authenticated
  using (tenant_id in (select public.current_auth_tenant_ids()));

drop table if exists public.outreach_drafts cascade;
drop table if exists public.email_sends cascade;
drop table if exists public.config cascade;
drop table if exists public.activity_log cascade;
drop table if exists public.outreach cascade;
drop table if exists public.enrichment_facts cascade;
drop table if exists public.contacts cascade;
drop table if exists public.company_profiles cascade;
drop table if exists public.property_profiles cascade;
drop table if exists public.leads cascade;

notify pgrst, 'reload schema';
