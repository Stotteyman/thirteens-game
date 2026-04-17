create extension if not exists "pgcrypto";

create table if not exists public.player_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Player',
  balance_cents integer not null default 0 check (balance_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.touch_player_profiles_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_touch_player_profiles on public.player_profiles;
create trigger trg_touch_player_profiles
before update on public.player_profiles
for each row execute function public.touch_player_profiles_updated_at();

create or replace function public.ensure_player_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.player_profiles(user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', 'Player'))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
after insert on auth.users
for each row execute function public.ensure_player_profile();

create table if not exists public.tables (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_private boolean not null default false,
  room_code text unique,
  entry_fee_cents integer not null default 0 check (entry_fee_cents >= 0),
  min_wager_cents integer not null default 0 check (min_wager_cents >= 0),
  status text not null default 'waiting' check (status in ('waiting','in_progress','finished')),
  seat_count integer not null default 4 check (seat_count = 4),
  tournament_id uuid null,
  bracket text null check (bracket in ('winners','losers')),
  round_no integer not null default 1,
  pot_cents integer not null default 0 check (pot_cents >= 0),
  created_by uuid null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.table_memberships (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references public.tables(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('player','spectator')),
  seat_no integer null check (seat_no between 1 and 4),
  paid_entry_cents integer not null default 0 check (paid_entry_cents >= 0),
  paid_wager_cents integer not null default 0 check (paid_wager_cents >= 0),
  contributed_cents integer not null default 0 check (contributed_cents >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(table_id, user_id)
);

create unique index if not exists idx_unique_player_seat_per_table
on public.table_memberships(table_id, seat_no)
where role = 'player' and active = true and seat_no is not null;

create table if not exists public.table_pot_contributions (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references public.tables(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  source text not null check (source in ('buy_in','extra','spectator_add')),
  created_at timestamptz not null default now()
);

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references public.tables(id) on delete cascade,
  status text not null default 'waiting' check (status in ('waiting','in_progress','finished')),
  winner_user_id uuid null references auth.users(id),
  standings jsonb null,
  started_at timestamptz null,
  finished_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  winners_table_id uuid not null references public.tables(id) on delete cascade,
  losers_table_id uuid not null references public.tables(id) on delete cascade,
  current_round integer not null default 1,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.tables
  add constraint fk_tables_tournament
  foreign key (tournament_id)
  references public.tournaments(id)
  on delete set null;

create table if not exists public.tournament_round_results (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  round_no integer not null,
  bracket text not null check (bracket in ('winners','losers')),
  table_id uuid not null references public.tables(id) on delete cascade,
  standings jsonb not null,
  processed boolean not null default false,
  created_at timestamptz not null default now(),
  unique(tournament_id, round_no, bracket)
);

alter table public.player_profiles enable row level security;
alter table public.tables enable row level security;
alter table public.table_memberships enable row level security;
alter table public.table_pot_contributions enable row level security;
alter table public.games enable row level security;
alter table public.tournaments enable row level security;
alter table public.tournament_round_results enable row level security;

create policy if not exists "profiles_select_all" on public.player_profiles
for select using (true);

create policy if not exists "profiles_update_self" on public.player_profiles
for update using (auth.uid() = user_id);

create policy if not exists "tables_select_all" on public.tables
for select using (true);

create policy if not exists "memberships_select_all" on public.table_memberships
for select using (true);

create policy if not exists "contributions_select_all" on public.table_pot_contributions
for select using (true);

create policy if not exists "games_select_all" on public.games
for select using (true);

create policy if not exists "tournaments_select_all" on public.tournaments
for select using (true);

create policy if not exists "tournament_results_select_all" on public.tournament_round_results
for select using (true);
