-- APS AUDIO ENGINE ONLY — run in the dedicated APS Supabase project.
-- Never apply this to the D'Moura / Sarah / DMAP database.
-- Roles are server-controlled; raw_user_meta_data is NEVER trusted for role/plan.
begin;

create schema if not exists aps_private;
revoke all on schema aps_private from public, anon, authenticated;
grant usage on schema aps_private to authenticated;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  role text not null default 'musician' check (role in ('musician','admin')),
  plan_tier text not null default 'free_trial' check (plan_tier in ('free_trial','free','pro','estudio')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
revoke all on public.profiles from public, anon, authenticated;
grant select on public.profiles to authenticated;
grant update (role, plan_tier) on public.profiles to authenticated;

-- The helper is in a NON-EXPOSED schema and is not publicly executable.
-- It avoids recursive profiles lookups in a profiles RLS policy.
create or replace function aps_private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists(
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.role = 'admin'
    );
$$;
revoke all on function aps_private.is_admin() from public, anon, authenticated;
grant execute on function aps_private.is_admin() to authenticated;

drop policy if exists aps_profiles_read_self on public.profiles;
create policy aps_profiles_read_self on public.profiles
  for select to authenticated
  using ((select auth.uid()) = id);

drop policy if exists aps_profiles_admin_read on public.profiles;
create policy aps_profiles_admin_read on public.profiles
  for select to authenticated
  using ((select aps_private.is_admin()));

drop policy if exists aps_profiles_admin_update on public.profiles;
create policy aps_profiles_admin_update on public.profiles
  for update to authenticated
  using ((select aps_private.is_admin()))
  with check ((select aps_private.is_admin()));

-- Every signup, including Google, starts as musician/free_trial.
-- Browser-supplied role or plan metadata is deliberately ignored.
create or replace function aps_private.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, email, role, plan_tier)
  values (new.id, new.raw_user_meta_data->>'full_name', new.email, 'musician', 'free_trial')
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke all on function aps_private.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_aps_auth_user_created on auth.users;
create trigger on_aps_auth_user_created
  after insert on auth.users
  for each row execute function aps_private.handle_new_user();

create or replace function aps_private.handle_email_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;
revoke all on function aps_private.handle_email_change() from public, anon, authenticated;

drop trigger if exists on_aps_auth_email_changed on auth.users;
create trigger on_aps_auth_email_changed
  after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function aps_private.handle_email_change();

insert into public.profiles (id, full_name, email, role, plan_tier)
select id, raw_user_meta_data->>'full_name', email, 'musician', 'free_trial'
from auth.users
on conflict (id) do nothing;

commit;
