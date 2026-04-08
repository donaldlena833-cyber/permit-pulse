create table if not exists public.v2_tenants (
  id uuid default gen_random_uuid() primary key,
  slug text not null unique,
  name text not null,
  business_name text not null,
  website text,
  primary_login_domain text not null unique,
  icon text,
  accent_color text,
  sender_name text,
  sender_email text,
  attachment_kv_key text,
  attachment_filename text,
  attachment_content_type text default 'application/pdf',
  plan_name text not null default 'starter',
  plan_price_cents integer not null default 9900,
  subscription_status text not null default 'active'
    check (subscription_status in ('trialing', 'active', 'past_due', 'cancelled')),
  stripe_customer_id text,
  stripe_subscription_id text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.v2_tenant_users (
  id uuid default gen_random_uuid() primary key,
  tenant_id uuid not null references public.v2_tenants(id) on delete cascade,
  auth_user_id uuid,
  email text not null,
  full_name text,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  status text not null default 'active' check (status in ('active', 'invited', 'disabled')),
  can_manage_billing boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (tenant_id, email),
  unique (auth_user_id)
);

create index if not exists idx_v2_tenant_users_tenant on public.v2_tenant_users(tenant_id, created_at asc);
create index if not exists idx_v2_tenant_users_email on public.v2_tenant_users(email);

insert into public.v2_tenants (
  slug,
  name,
  business_name,
  website,
  primary_login_domain,
  icon,
  accent_color,
  sender_name,
  sender_email,
  attachment_kv_key,
  attachment_filename,
  attachment_content_type,
  plan_name,
  plan_price_cents,
  subscription_status
)
values
  (
    'metroglasspro',
    'MetroGlass Pro',
    'MetroGlass Pro',
    'https://metroglasspro.com',
    'metroglasspro.com',
    'MG',
    '#B88A52',
    'Donald Lena',
    'operations@metroglasspro.com',
    'workspace/metroglasspro/default-attachment',
    'MetroGlass Pro - About Us.pdf',
    'application/pdf',
    'starter',
    9900,
    'active'
  ),
  (
    'lokeilrenovating',
    'Lokeil Renovating',
    'Lokeil Renovating',
    'https://lokeilrenovating.com',
    'lokeilrenovating.com',
    'LR',
    '#5F7C65',
    'Lokeil Renovating',
    'lokeil@lokeilrenovating.com',
    'workspace/lokeilrenovating/default-attachment',
    'LOKEIL - About Us.pdf',
    'application/pdf',
    'starter',
    9900,
    'active'
  )
on conflict (slug) do update
set
  name = excluded.name,
  business_name = excluded.business_name,
  website = excluded.website,
  primary_login_domain = excluded.primary_login_domain,
  icon = excluded.icon,
  accent_color = excluded.accent_color,
  sender_name = excluded.sender_name,
  sender_email = excluded.sender_email,
  attachment_kv_key = excluded.attachment_kv_key,
  attachment_filename = excluded.attachment_filename,
  attachment_content_type = excluded.attachment_content_type,
  plan_name = excluded.plan_name,
  plan_price_cents = excluded.plan_price_cents,
  subscription_status = excluded.subscription_status,
  updated_at = timezone('utc', now());

insert into public.v2_tenant_users (
  tenant_id,
  auth_user_id,
  email,
  full_name,
  role,
  status,
  can_manage_billing
)
select
  id,
  null,
  'operations@metroglasspro.com',
  'MetroGlass Pro Owner',
  'owner',
  'active',
  true
from public.v2_tenants
where slug = 'metroglasspro'
on conflict (tenant_id, email) do update
set
  role = excluded.role,
  status = excluded.status,
  can_manage_billing = excluded.can_manage_billing,
  updated_at = timezone('utc', now());

insert into public.v2_tenant_users (
  tenant_id,
  auth_user_id,
  email,
  full_name,
  role,
  status,
  can_manage_billing
)
select
  id,
  null,
  'lokeil@lokeilrenovating.com',
  'Lokeil Renovating Owner',
  'owner',
  'active',
  true
from public.v2_tenants
where slug = 'lokeilrenovating'
on conflict (tenant_id, email) do update
set
  role = excluded.role,
  status = excluded.status,
  can_manage_billing = excluded.can_manage_billing,
  updated_at = timezone('utc', now());

grant select, insert, update, delete on public.v2_tenants to service_role;
grant select, insert, update, delete on public.v2_tenant_users to service_role;

revoke select, insert, update, delete on public.v2_tenants from anon, authenticated;
revoke select, insert, update, delete on public.v2_tenant_users from anon, authenticated;

alter table public.v2_tenants enable row level security;
alter table public.v2_tenant_users enable row level security;
