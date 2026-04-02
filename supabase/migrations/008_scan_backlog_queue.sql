alter table public.v2_leads
  add column if not exists automation_state text not null default 'pending';

alter table public.v2_leads
  drop constraint if exists v2_leads_automation_state_check;

alter table public.v2_leads
  add constraint v2_leads_automation_state_check
  check (automation_state in ('pending', 'claimed', 'processed'));

alter table public.v2_leads
  add column if not exists automation_claimed_by_run uuid references public.v2_automation_runs(id) on delete set null,
  add column if not exists automation_claimed_at timestamptz,
  add column if not exists automation_processed_at timestamptz;

create index if not exists idx_v2_leads_automation_state
  on public.v2_leads(automation_state);

create index if not exists idx_v2_leads_automation_claimed_by_run
  on public.v2_leads(automation_claimed_by_run);

create index if not exists idx_v2_leads_automation_pending_queue
  on public.v2_leads(automation_state, relevance_score desc, created_at asc);

update public.v2_leads
set
  automation_state = case
    when status = 'new' then 'pending'
    else 'processed'
  end,
  automation_claimed_by_run = null,
  automation_claimed_at = null,
  automation_processed_at = case
    when status = 'new' then null
    else coalesce(automation_processed_at, enriched_at, sent_at, updated_at, created_at)
  end;

update public.v2_leads
set
  automation_state = 'pending',
  automation_claimed_by_run = null,
  automation_claimed_at = null
where automation_state = 'claimed'
  and status = 'new';
