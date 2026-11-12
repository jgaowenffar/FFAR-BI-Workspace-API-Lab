-- Deliberately small shared document test store, not a production data model.
create table public.lab2_workspaces (
  id uuid primary key,
  name text not null,
  state jsonb not null default '{"organizations":[],"jobs":[],"notes":[]}'::jsonb,
  revision bigint not null default 0,
  updated_at timestamptz not null default now(),
  constraint lab2_state_shape check (coalesce(jsonb_typeof(state->'organizations')='array' and jsonb_typeof(state->'jobs')='array' and jsonb_typeof(state->'notes')='array',false)),
  constraint lab2_state_capacity check (octet_length(state::text) <= 8000000)
);
create table public.lab2_memberships (
  workspace_id uuid references public.lab2_workspaces(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  role text not null check (role in ('editor','viewer')),
  primary key (workspace_id,user_id)
);
alter table public.lab2_workspaces enable row level security;
alter table public.lab2_memberships enable row level security;
create policy lab2_own_membership on public.lab2_memberships for select to authenticated using (user_id=auth.uid());
create policy lab2_shared_read on public.lab2_workspaces for select to authenticated using (
  exists (select 1 from public.lab2_memberships m where m.workspace_id=id and m.user_id=auth.uid())
);
revoke all on public.lab2_workspaces,public.lab2_memberships from public,anon,authenticated;
grant select on public.lab2_workspaces,public.lab2_memberships to authenticated;
grant select,insert,update,delete on public.lab2_workspaces,public.lab2_memberships to service_role;
create function public.lab2_compare_and_swap(p_workspace uuid,p_user uuid,p_revision bigint,p_state jsonb)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if not exists(select 1 from public.lab2_memberships where workspace_id=p_workspace and user_id=p_user and role='editor') then
    raise exception 'Editor membership required' using errcode='42501';
  end if;
  update public.lab2_workspaces set state=p_state,revision=revision+1,updated_at=now()
    where id=p_workspace and revision=p_revision;
  return found;
end $$;
revoke all on function public.lab2_compare_and_swap(uuid,uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.lab2_compare_and_swap(uuid,uuid,bigint,jsonb) to service_role;
