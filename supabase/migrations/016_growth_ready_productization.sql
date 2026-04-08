alter table public.v2_tenants
  add column if not exists billing_email text,
  add column if not exists onboarding_status text not null default 'pending'
    check (onboarding_status in ('pending', 'in_progress', 'completed')),
  add column if not exists onboarding_completed_at timestamptz;

update public.v2_tenants
set
  billing_email = coalesce(billing_email, sender_email),
  onboarding_status = case
    when onboarding_completed_at is not null then 'completed'
    when sender_email is not null or attachment_filename is not null then 'in_progress'
    else onboarding_status
  end,
  updated_at = timezone('utc', now())
where billing_email is null
   or onboarding_status = 'pending';

alter table public.v2_tenant_users
  add column if not exists invited_by text,
  add column if not exists invite_token text,
  add column if not exists invited_at timestamptz,
  add column if not exists invite_expires_at timestamptz,
  add column if not exists accepted_at timestamptz,
  add column if not exists disabled_at timestamptz;

update public.v2_tenant_users
set
  invited_at = coalesce(invited_at, created_at),
  accepted_at = coalesce(accepted_at, case when status = 'active' then created_at else accepted_at end),
  disabled_at = coalesce(disabled_at, case when status = 'disabled' then updated_at else disabled_at end),
  can_manage_billing = case when role = 'owner' then true else false end,
  updated_at = timezone('utc', now())
where invited_at is null
   or (status = 'active' and accepted_at is null)
   or (status = 'disabled' and disabled_at is null)
   or (role <> 'owner' and can_manage_billing = true);

alter table public.v2_tenant_users
  drop constraint if exists v2_tenant_users_billing_owner_only;

alter table public.v2_tenant_users
  add constraint v2_tenant_users_billing_owner_only
  check (not can_manage_billing or role = 'owner');

create unique index if not exists idx_v2_tenant_users_invite_token
  on public.v2_tenant_users(invite_token)
  where invite_token is not null;

create index if not exists idx_v2_tenant_users_status
  on public.v2_tenant_users(tenant_id, status, created_at desc);

create table if not exists public.v2_workspace_onboarding (
  id uuid default gen_random_uuid() primary key,
  tenant_id uuid not null unique references public.v2_tenants(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'completed')),
  business_info_completed_at timestamptz,
  sender_identity_completed_at timestamptz,
  mailbox_completed_at timestamptz,
  attachment_completed_at timestamptz,
  first_campaign_ready_at timestamptz,
  completed_at timestamptz,
  created_by text,
  updated_by text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

insert into public.v2_workspace_onboarding (
  tenant_id,
  status,
  business_info_completed_at,
  sender_identity_completed_at,
  attachment_completed_at,
  completed_at,
  created_at,
  updated_at
)
select
  tenants.id,
  case
    when tenants.onboarding_completed_at is not null then 'completed'
    when tenants.sender_email is not null or tenants.attachment_filename is not null then 'in_progress'
    else 'pending'
  end,
  coalesce(tenants.created_at, timezone('utc', now())),
  case when tenants.sender_email is not null then coalesce(tenants.updated_at, timezone('utc', now())) else null end,
  case when tenants.attachment_filename is not null then coalesce(tenants.updated_at, timezone('utc', now())) else null end,
  tenants.onboarding_completed_at,
  coalesce(tenants.created_at, timezone('utc', now())),
  coalesce(tenants.updated_at, timezone('utc', now()))
from public.v2_tenants tenants
on conflict (tenant_id) do update
set
  status = excluded.status,
  business_info_completed_at = coalesce(public.v2_workspace_onboarding.business_info_completed_at, excluded.business_info_completed_at),
  sender_identity_completed_at = coalesce(public.v2_workspace_onboarding.sender_identity_completed_at, excluded.sender_identity_completed_at),
  attachment_completed_at = coalesce(public.v2_workspace_onboarding.attachment_completed_at, excluded.attachment_completed_at),
  completed_at = coalesce(public.v2_workspace_onboarding.completed_at, excluded.completed_at),
  updated_at = timezone('utc', now());

create table if not exists public.v2_workspace_attachments (
  id uuid default gen_random_uuid() primary key,
  tenant_id uuid not null references public.v2_tenants(id) on delete cascade,
  storage_key text not null,
  filename text not null,
  content_type text not null default 'application/pdf',
  file_size_bytes integer not null default 0,
  uploaded_by text,
  status text not null default 'active' check (status in ('active', 'archived')),
  is_default boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (tenant_id, storage_key)
);

create index if not exists idx_v2_workspace_attachments_tenant_created
  on public.v2_workspace_attachments(tenant_id, created_at desc);

create index if not exists idx_v2_workspace_attachments_tenant_status
  on public.v2_workspace_attachments(tenant_id, status, updated_at desc);

create unique index if not exists idx_v2_workspace_attachments_default
  on public.v2_workspace_attachments(tenant_id)
  where is_default = true and status = 'active';

insert into public.v2_workspace_attachments (
  tenant_id,
  storage_key,
  filename,
  content_type,
  file_size_bytes,
  uploaded_by,
  status,
  is_default,
  created_at,
  updated_at
)
select
  tenants.id,
  tenants.attachment_kv_key,
  tenants.attachment_filename,
  coalesce(tenants.attachment_content_type, 'application/pdf'),
  0,
  tenants.sender_email,
  'active',
  true,
  coalesce(tenants.created_at, timezone('utc', now())),
  coalesce(tenants.updated_at, timezone('utc', now()))
from public.v2_tenants tenants
where tenants.attachment_kv_key is not null
  and tenants.attachment_filename is not null
on conflict (tenant_id, storage_key) do update
set
  filename = excluded.filename,
  content_type = excluded.content_type,
  is_default = excluded.is_default,
  status = 'active',
  archived_at = null,
  updated_at = timezone('utc', now());

create table if not exists public.v2_workspace_mailboxes (
  id uuid default gen_random_uuid() primary key,
  tenant_id uuid not null references public.v2_tenants(id) on delete cascade,
  provider text not null default 'gmail' check (provider in ('gmail')),
  email text not null,
  display_name text,
  encrypted_refresh_token text not null,
  status text not null default 'active' check (status in ('active', 'error', 'revoked', 'archived')),
  is_default boolean not null default false,
  connected_by text,
  last_synced_at timestamptz,
  last_sent_at timestamptz,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  archived_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (tenant_id, provider, email)
);

create index if not exists idx_v2_workspace_mailboxes_tenant_status
  on public.v2_workspace_mailboxes(tenant_id, status, updated_at desc);

create unique index if not exists idx_v2_workspace_mailboxes_default
  on public.v2_workspace_mailboxes(tenant_id)
  where is_default = true and status in ('active', 'error');

create table if not exists public.v2_audit_events (
  id uuid default gen_random_uuid() primary key,
  tenant_id uuid not null references public.v2_tenants(id) on delete cascade,
  actor_type text not null default 'system' check (actor_type in ('system', 'user', 'webhook')),
  actor_id text,
  event_type text not null,
  target_type text,
  target_id text,
  detail jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_v2_audit_events_tenant_created
  on public.v2_audit_events(tenant_id, created_at desc);

create index if not exists idx_v2_audit_events_tenant_event
  on public.v2_audit_events(tenant_id, event_type, created_at desc);

alter table public.v2_domain_reputation
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists tenant_id uuid references public.v2_tenants(id) on delete cascade;

update public.v2_domain_reputation
set id = gen_random_uuid()
where id is null;

update public.v2_domain_reputation
set tenant_id = (select id from public.v2_tenants where slug = 'metroglasspro' limit 1)
where tenant_id is null;

alter table public.v2_domain_reputation
  alter column tenant_id set not null;

alter table public.v2_domain_reputation
  drop constraint if exists v2_domain_reputation_pkey;

alter table public.v2_domain_reputation
  add constraint v2_domain_reputation_pkey primary key (id);

create unique index if not exists idx_v2_domain_reputation_tenant_domain
  on public.v2_domain_reputation(tenant_id, domain);

grant select, insert, update, delete on public.v2_workspace_onboarding to service_role;
grant select, insert, update, delete on public.v2_workspace_attachments to service_role;
grant select, insert, update, delete on public.v2_workspace_mailboxes to service_role;
grant select, insert, update, delete on public.v2_audit_events to service_role;

revoke select, insert, update, delete on public.v2_workspace_onboarding from anon, authenticated;
revoke select, insert, update, delete on public.v2_workspace_attachments from anon, authenticated;
revoke select, insert, update, delete on public.v2_workspace_mailboxes from anon, authenticated;
revoke select, insert, update, delete on public.v2_audit_events from anon, authenticated;

alter table public.v2_workspace_onboarding enable row level security;
alter table public.v2_workspace_attachments enable row level security;
alter table public.v2_workspace_mailboxes enable row level security;
alter table public.v2_audit_events enable row level security;

notify pgrst, 'reload schema';
