insert into public.v2_app_config (key, value)
values ('auto_send_policy', 'any_published')
on conflict (key) do nothing;
