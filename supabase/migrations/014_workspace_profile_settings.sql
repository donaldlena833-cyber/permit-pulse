alter table public.v2_tenants
  add column if not exists phone text,
  add column if not exists outreach_pitch text,
  add column if not exists outreach_focus text,
  add column if not exists outreach_cta text;

update public.v2_tenants
set
  attachment_kv_key = 'workspace/metroglasspro/default-attachment',
  attachment_filename = 'MetroGlass Pro - About Us.pdf',
  attachment_content_type = 'application/pdf',
  phone = coalesce(phone, '(332) 999-3846'),
  outreach_pitch = coalesce(
    outreach_pitch,
    'help interior designers turn glass concepts into finished installs without the usual back and forth across NYC, New Jersey, and Connecticut'
  ),
  outreach_focus = coalesce(
    outreach_focus,
    'We help interior designers translate shower, mirror, partition, and cabinet glass ideas into clean installs without losing the original concept.'
  ),
  outreach_cta = coalesce(
    outreach_cta,
    'If you have a project where glass scope still needs a responsive partner, I would be glad to connect, turn around pricing quickly, and help keep things moving.'
  ),
  updated_at = timezone('utc', now())
where slug = 'metroglasspro';

update public.v2_tenants
set
  attachment_kv_key = 'workspace/lokeilrenovating/default-attachment',
  attachment_filename = 'LOKEIL - About Us.pdf',
  attachment_content_type = 'application/pdf',
  updated_at = timezone('utc', now())
where slug = 'lokeilrenovating';

notify pgrst, 'reload schema';
