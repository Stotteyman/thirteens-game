create table if not exists public.player_stats (
  user_id uuid primary key references auth.users(id) on delete cascade,
  games_played integer not null default 0 check (games_played >= 0),
  rounds_won integer not null default 0 check (rounds_won >= 0),
  losses integer not null default 0 check (losses >= 0),
  bombs_played integer not null default 0 check (bombs_played >= 0),
  money_won_cents integer not null default 0,
  entry_fees_paid_cents integer not null default 0 check (entry_fees_paid_cents >= 0),
  wagers_paid_cents integer not null default 0 check (wagers_paid_cents >= 0),
  pot_contributed_cents integer not null default 0 check (pot_contributed_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.touch_player_stats_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_touch_player_stats on public.player_stats;
create trigger trg_touch_player_stats
before update on public.player_stats
for each row execute function public.touch_player_stats_updated_at();

alter table public.player_stats enable row level security;

drop policy if exists "player_stats_select_all" on public.player_stats;
create policy "player_stats_select_all" on public.player_stats
for select using (true);

drop policy if exists "player_stats_update_self" on public.player_stats;
create policy "player_stats_update_self" on public.player_stats
for update using (auth.uid() = user_id);

drop policy if exists "player_stats_insert_self" on public.player_stats;
create policy "player_stats_insert_self" on public.player_stats
for insert with check (auth.uid() = user_id);

-- Development-only policy for server anon mode.
-- Remove this policy when the backend runs with service-role key in production.
drop policy if exists "player_stats_all_dev" on public.player_stats;
create policy "player_stats_all_dev" on public.player_stats
for all using (true) with check (true);
