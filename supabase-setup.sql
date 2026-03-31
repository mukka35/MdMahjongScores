create table if not exists public.app_state (
  id text primary key,
  payload jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.app_state enable row level security;

-- Anonymous read/write for minimum setup.
-- For production, tighten these policies and add auth.
drop policy if exists "anon can read app_state" on public.app_state;
create policy "anon can read app_state"
  on public.app_state for select
  to anon
  using (true);

drop policy if exists "anon can write app_state" on public.app_state;
create policy "anon can write app_state"
  on public.app_state for insert
  to anon
  with check (true);

drop policy if exists "anon can update app_state" on public.app_state;
create policy "anon can update app_state"
  on public.app_state for update
  to anon
  using (true)
  with check (true);
