create table if not exists public.v2_tenant_app_config (
  id uuid default gen_random_uuid() primary key,
  tenant_id uuid not null references public.v2_tenants(id) on delete cascade,
  key text not null,
  value jsonb not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (tenant_id, key)
);

grant select, insert, update, delete on public.v2_tenant_app_config to service_role;
revoke select, insert, update, delete on public.v2_tenant_app_config from anon, authenticated;
alter table public.v2_tenant_app_config enable row level security;

alter table public.v2_leads add column if not exists tenant_id uuid references public.v2_tenants(id) on delete cascade;
alter table public.v2_automation_runs add column if not exists tenant_id uuid references public.v2_tenants(id) on delete cascade;
alter table public.v2_company_candidates add column if not exists tenant_id uuid references public.v2_tenants(id) on delete cascade;
alter table public.v2_email_candidates add column if not exists tenant_id uuid references public.v2_tenants(id) on delete cascade;
alter table public.v2_lead_events add column if not exists tenant_id uuid references public.v2_tenants(id) on delete cascade;
alter table public.v2_lead_jobs add column if not exists tenant_id uuid references public.v2_tenants(id) on delete cascade;
alter table public.v2_email_outcomes add column if not exists tenant_id uuid references public.v2_tenants(id) on delete cascade;
alter table public.v2_follow_ups add column if not exists tenant_id uuid references public.v2_tenants(id) on delete cascade;
alter table public.v2_related_permits add column if not exists tenant_id uuid references public.v2_tenants(id) on delete cascade;

alter table public.v2_prospect_import_batches add column if not exists tenant_id uuid references public.v2_tenants(id) on delete cascade;
alter table public.v2_prospects add column if not exists tenant_id uuid references public.v2_tenants(id) on delete cascade;
alter table public.v2_prospect_events add column if not exists tenant_id uuid references public.v2_tenants(id) on delete cascade;
alter table public.v2_prospect_outcomes add column if not exists tenant_id uuid references public.v2_tenants(id) on delete cascade;
alter table public.v2_prospect_follow_ups add column if not exists tenant_id uuid references public.v2_tenants(id) on delete cascade;
alter table public.v2_prospect_companies add column if not exists tenant_id uuid references public.v2_tenants(id) on delete cascade;
alter table public.v2_prospect_campaigns add column if not exists tenant_id uuid references public.v2_tenants(id) on delete cascade;
alter table public.v2_prospect_suppressions add column if not exists tenant_id uuid references public.v2_tenants(id) on delete cascade;
alter table public.v2_outreach_review_queue add column if not exists tenant_id uuid references public.v2_tenants(id) on delete cascade;

with metroglass as (
  select id
  from public.v2_tenants
  where slug = 'metroglasspro'
  limit 1
)
update public.v2_leads
set tenant_id = (select id from metroglass)
where tenant_id is null;

update public.v2_automation_runs
set tenant_id = (select id from public.v2_tenants where slug = 'metroglasspro' limit 1)
where tenant_id is null;

update public.v2_company_candidates child
set tenant_id = parent.tenant_id
from public.v2_leads parent
where child.tenant_id is null
  and child.lead_id = parent.id;

update public.v2_email_candidates child
set tenant_id = parent.tenant_id
from public.v2_leads parent
where child.tenant_id is null
  and child.lead_id = parent.id;

update public.v2_lead_events child
set tenant_id = parent.tenant_id
from public.v2_leads parent
where child.tenant_id is null
  and child.lead_id = parent.id;

update public.v2_lead_jobs child
set tenant_id = parent.tenant_id
from public.v2_leads parent
where child.tenant_id is null
  and child.lead_id = parent.id;

update public.v2_lead_jobs child
set tenant_id = parent.tenant_id
from public.v2_automation_runs parent
where child.tenant_id is null
  and child.run_id = parent.id;

update public.v2_email_outcomes child
set tenant_id = parent.tenant_id
from public.v2_leads parent
where child.tenant_id is null
  and child.lead_id = parent.id;

update public.v2_follow_ups child
set tenant_id = parent.tenant_id
from public.v2_leads parent
where child.tenant_id is null
  and child.lead_id = parent.id;

update public.v2_related_permits child
set tenant_id = parent.tenant_id
from public.v2_leads parent
where child.tenant_id is null
  and child.lead_id = parent.id;

update public.v2_prospect_import_batches
set tenant_id = (select id from public.v2_tenants where slug = 'metroglasspro' limit 1)
where tenant_id is null;

update public.v2_prospects
set tenant_id = coalesce(
  (select tenant_id from public.v2_prospect_import_batches where id = import_batch_id),
  (select id from public.v2_tenants where slug = 'metroglasspro' limit 1)
)
where tenant_id is null;

update public.v2_prospect_events child
set tenant_id = parent.tenant_id
from public.v2_prospects parent
where child.tenant_id is null
  and child.prospect_id = parent.id;

update public.v2_prospect_outcomes child
set tenant_id = parent.tenant_id
from public.v2_prospects parent
where child.tenant_id is null
  and child.prospect_id = parent.id;

update public.v2_prospect_follow_ups child
set tenant_id = parent.tenant_id
from public.v2_prospects parent
where child.tenant_id is null
  and child.prospect_id = parent.id;

update public.v2_prospect_companies
set tenant_id = (select id from public.v2_tenants where slug = 'metroglasspro' limit 1)
where tenant_id is null;

update public.v2_prospect_campaigns
set tenant_id = (select id from public.v2_tenants where slug = 'metroglasspro' limit 1)
where tenant_id is null;

update public.v2_prospect_suppressions child
set tenant_id = coalesce(
  (select tenant_id from public.v2_prospects where id = child.prospect_id),
  (select tenant_id from public.v2_prospect_companies where id = child.company_id),
  (select id from public.v2_tenants where slug = 'metroglasspro' limit 1)
)
where child.tenant_id is null;

update public.v2_outreach_review_queue
set tenant_id = (select id from public.v2_tenants where slug = 'metroglasspro' limit 1)
where tenant_id is null;

insert into public.v2_tenant_app_config (tenant_id, key, value)
select tenants.id, config.key, config.value
from public.v2_tenants tenants
cross join public.v2_app_config config
on conflict (tenant_id, key) do update
set
  value = excluded.value,
  updated_at = timezone('utc', now());

alter table public.v2_leads alter column tenant_id set not null;
alter table public.v2_automation_runs alter column tenant_id set not null;
alter table public.v2_company_candidates alter column tenant_id set not null;
alter table public.v2_email_candidates alter column tenant_id set not null;
alter table public.v2_lead_events alter column tenant_id set not null;
alter table public.v2_lead_jobs alter column tenant_id set not null;
alter table public.v2_email_outcomes alter column tenant_id set not null;
alter table public.v2_follow_ups alter column tenant_id set not null;
alter table public.v2_related_permits alter column tenant_id set not null;

alter table public.v2_prospect_import_batches alter column tenant_id set not null;
alter table public.v2_prospects alter column tenant_id set not null;
alter table public.v2_prospect_events alter column tenant_id set not null;
alter table public.v2_prospect_outcomes alter column tenant_id set not null;
alter table public.v2_prospect_follow_ups alter column tenant_id set not null;
alter table public.v2_prospect_companies alter column tenant_id set not null;
alter table public.v2_prospect_campaigns alter column tenant_id set not null;
alter table public.v2_prospect_suppressions alter column tenant_id set not null;
alter table public.v2_outreach_review_queue alter column tenant_id set not null;

drop index if exists idx_v2_leads_permit_key;
create unique index if not exists idx_v2_leads_tenant_permit_key on public.v2_leads(tenant_id, permit_key);
create index if not exists idx_v2_leads_tenant_status on public.v2_leads(tenant_id, status, updated_at desc);
create index if not exists idx_v2_runs_tenant_created on public.v2_automation_runs(tenant_id, created_at desc);
create index if not exists idx_v2_followups_tenant_pending on public.v2_follow_ups(tenant_id, scheduled_at) where status = 'pending';
create index if not exists idx_v2_outcomes_tenant_sent on public.v2_email_outcomes(tenant_id, sent_at desc);

alter table public.v2_prospects drop constraint if exists v2_prospects_email_normalized_key;
create unique index if not exists idx_v2_prospects_tenant_email on public.v2_prospects(tenant_id, email_normalized);
create index if not exists idx_v2_prospects_tenant_status on public.v2_prospects(tenant_id, status, updated_at desc);

drop index if exists idx_v2_prospect_companies_domain;
drop index if exists idx_v2_prospect_companies_name;
create unique index if not exists idx_v2_prospect_companies_tenant_domain
  on public.v2_prospect_companies(tenant_id, domain)
  where domain is not null;
create unique index if not exists idx_v2_prospect_companies_tenant_name
  on public.v2_prospect_companies(tenant_id, normalized_name);

drop index if exists idx_v2_prospect_campaigns_active_category;
create unique index if not exists idx_v2_prospect_campaigns_tenant_active_category
  on public.v2_prospect_campaigns(tenant_id, category, template_variant, status);

drop index if exists idx_v2_prospect_suppressions_scope;
create unique index if not exists idx_v2_prospect_suppressions_tenant_scope
  on public.v2_prospect_suppressions(tenant_id, scope_type, scope_value)
  where active = true;

drop index if exists idx_v2_outreach_review_queue_message;
create unique index if not exists idx_v2_outreach_review_queue_tenant_message
  on public.v2_outreach_review_queue(tenant_id, gmail_message_id);

create index if not exists idx_v2_company_candidates_tenant_lead on public.v2_company_candidates(tenant_id, lead_id);
create index if not exists idx_v2_email_candidates_tenant_lead on public.v2_email_candidates(tenant_id, lead_id);
create index if not exists idx_v2_lead_events_tenant_lead on public.v2_lead_events(tenant_id, lead_id, created_at desc);
create index if not exists idx_v2_lead_jobs_tenant_status on public.v2_lead_jobs(tenant_id, status, created_at desc);
create index if not exists idx_v2_related_permits_tenant_lead on public.v2_related_permits(tenant_id, lead_id);
create index if not exists idx_v2_prospect_import_batches_tenant_created on public.v2_prospect_import_batches(tenant_id, created_at desc);
create index if not exists idx_v2_prospect_events_tenant_prospect on public.v2_prospect_events(tenant_id, prospect_id, created_at desc);
create index if not exists idx_v2_prospect_outcomes_tenant_prospect on public.v2_prospect_outcomes(tenant_id, prospect_id, created_at desc);
create index if not exists idx_v2_prospect_followups_tenant_pending on public.v2_prospect_follow_ups(tenant_id, scheduled_at) where status = 'pending';
create index if not exists idx_v2_prospect_campaigns_tenant_status on public.v2_prospect_campaigns(tenant_id, status, updated_at desc);
create index if not exists idx_v2_outreach_review_queue_tenant_status on public.v2_outreach_review_queue(tenant_id, status, created_at desc);

notify pgrst, 'reload schema';
