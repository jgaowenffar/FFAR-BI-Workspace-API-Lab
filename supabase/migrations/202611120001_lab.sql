-- Isolated test tables. Apply to a separate test project.
create table public.lab_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject text not null,
  domain text,
  mode text not null check (mode in ('mock','live')),
  model text not null,
  document jsonb not null,
  source_run uuid,
  created_at timestamptz not null default now()
);
create table public.lab_runs (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  operation text not null,
  mode text not null check (mode in ('mock','live')),
  model text not null,
  subject text not null,
  status text not null default 'started' check (status in ('started','complete','failed')),
  usage jsonb,
  cost jsonb,
  result jsonb,
  elapsed_ms integer,
  error_code text,
  provider_request_id text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index on public.lab_profiles(user_id,created_at desc);
create index on public.lab_runs(user_id,created_at desc);
alter table public.lab_profiles enable row level security;
alter table public.lab_runs enable row level security;
revoke all on public.lab_profiles, public.lab_runs from anon,authenticated;
grant select on public.lab_profiles, public.lab_runs to authenticated;
grant select,insert,update on public.lab_profiles, public.lab_runs to service_role;
create policy own_profiles on public.lab_profiles for select to authenticated using ((select auth.uid())=user_id);
create policy own_runs on public.lab_runs for select to authenticated using ((select auth.uid())=user_id);

-- Atomic duplicate protection and an hourly live-run count, across server instances.
create function public.lab_start_run(p_id uuid,p_user uuid,p_operation text,p_mode text,p_model text,p_subject text,p_hourly_limit integer)
returns boolean language plpgsql set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
  if exists(select 1 from public.lab_runs where id=p_id) then return false; end if;
  if p_mode='live' and (select count(*) from public.lab_runs where user_id=p_user and mode='live' and created_at > now()-interval '1 hour') >= least(greatest(p_hourly_limit,1),100) then
    raise exception 'Hourly live-test limit reached';
  end if;
  insert into public.lab_runs(id,user_id,operation,mode,model,subject) values(p_id,p_user,p_operation,p_mode,p_model,p_subject);
  return true;
end;
$$;
revoke all on function public.lab_start_run(uuid,uuid,text,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.lab_start_run(uuid,uuid,text,text,text,text,integer) to service_role;
