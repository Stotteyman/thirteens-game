-- Development-only migration.
-- Allows anon-key server mode to read/write game tables while service-role key is not configured.
-- Replace with service-role key + stricter RLS policies before production.

drop policy if exists "profiles_all_dev" on public.player_profiles;
create policy "profiles_all_dev" on public.player_profiles
for all using (true) with check (true);

drop policy if exists "tables_all_dev" on public.tables;
create policy "tables_all_dev" on public.tables
for all using (true) with check (true);

drop policy if exists "memberships_all_dev" on public.table_memberships;
create policy "memberships_all_dev" on public.table_memberships
for all using (true) with check (true);

drop policy if exists "contributions_all_dev" on public.table_pot_contributions;
create policy "contributions_all_dev" on public.table_pot_contributions
for all using (true) with check (true);

drop policy if exists "games_all_dev" on public.games;
create policy "games_all_dev" on public.games
for all using (true) with check (true);

drop policy if exists "tournaments_all_dev" on public.tournaments;
create policy "tournaments_all_dev" on public.tournaments
for all using (true) with check (true);

drop policy if exists "tournament_results_all_dev" on public.tournament_round_results;
create policy "tournament_results_all_dev" on public.tournament_round_results
for all using (true) with check (true);
