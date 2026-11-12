-- Run once in the Supabase SQL editor AFTER both migrations.
-- Create three Auth users first. Replace the two member UUIDs below.
-- The third account is deliberately NOT granted membership.
insert into public.lab2_workspaces(id,name)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Research API test workspace')
on conflict(id) do nothing;
insert into public.lab2_memberships(workspace_id,user_id,role) values
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','editor'),
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','22222222-2222-4222-8222-222222222222','editor')
on conflict(workspace_id,user_id) do update set role=excluded.role;
