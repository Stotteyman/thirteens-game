require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const { createServer } = require('http');
const { v4: uuidv4 } = require('uuid');
const { createClient } = require('@supabase/supabase-js');

const PORT = Number(process.env.PORT || 8088);
const APP_ORIGIN = process.env.APP_ORIGIN || '*';
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const suits = ['clubs', 'diamonds', 'hearts', 'spades'];
const suitOrder = { clubs: 0, diamonds: 1, hearts: 2, spades: 3 };

const socketsByUser = new Map();
const roomsRuntime = new Map();
const PLAYER_STAT_FIELDS = [
  'games_played',
  'rounds_won',
  'losses',
  'bombs_played',
  'money_won_cents',
  'entry_fees_paid_cents',
  'wagers_paid_cents',
  'pot_contributed_cents',
];

function makeDeck() {
  const deck = [];
  for (let rank = 3; rank <= 15; rank += 1) {
    for (const suit of suits) {
      deck.push({ id: `${rank}-${suit}`, rank, suit });
    }
  }
  return deck;
}

function shuffle(cards) {
  const cloned = [...cards];
  for (let i = cloned.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [cloned[i], cloned[j]] = [cloned[j], cloned[i]];
  }
  return cloned;
}

function sortCards(cards) {
  return [...cards].sort((a, b) => {
    if (a.rank !== b.rank) {
      return a.rank - b.rank;
    }
    return suitOrder[a.suit] - suitOrder[b.suit];
  });
}

function findCombo(cards) {
  const sorted = sortCards(cards);
  const ranks = sorted.map((c) => c.rank);
  const unique = [...new Set(ranks)];

  if (sorted.length === 1) {
    return { type: 'single', strength: sorted[0].rank * 10 + suitOrder[sorted[0].suit] };
  }
  if (sorted.length === 2 && unique.length === 1) {
    return { type: 'pair', strength: sorted[0].rank };
  }
  if (sorted.length === 3 && unique.length === 1) {
    return { type: 'triple', strength: sorted[0].rank };
  }
  if (sorted.length === 4 && unique.length === 1) {
    return { type: 'bomb', strength: sorted[0].rank };
  }
  if (sorted.length >= 3 && unique.length === sorted.length && !ranks.includes(15)) {
    for (let i = 1; i < ranks.length; i += 1) {
      if (ranks[i] !== ranks[i - 1] + 1) {
        return null;
      }
    }
    return { type: 'straight', strength: ranks[ranks.length - 1] };
  }
  return null;
}

function canBeatPlay(nextPlay, currentPlay) {
  if (!currentPlay) return true;

  const currentTopRank = sortCards(currentPlay.cards)[currentPlay.cards.length - 1].rank;
  if (nextPlay.type === 'bomb' && currentPlay.type === 'single' && currentTopRank === 15) {
    return true;
  }
  if (nextPlay.type !== currentPlay.type) return false;
  if (nextPlay.type === 'straight' && nextPlay.cards.length !== currentPlay.cards.length) return false;
  return nextPlay.strength > currentPlay.strength;
}

function nextTurn(activeIds, fromId) {
  const idx = activeIds.indexOf(fromId);
  if (idx === -1) return activeIds[0];
  return activeIds[(idx + 1) % activeIds.length];
}

function sendToUser(userId, payload) {
  const socket = socketsByUser.get(userId);
  if (socket && socket.readyState === 1) {
    socket.send(JSON.stringify(payload));
  }
}

async function getUserFromToken(token) {
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

async function ensureProfile(user) {
  const displayName =
    String(user.user_metadata?.full_name || user.user_metadata?.name || user.email || 'Player').slice(0, 20);

  const { data, error } = await supabase
    .from('player_profiles')
    .upsert({ user_id: user.id, display_name: displayName }, { onConflict: 'user_id' })
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

async function ensurePlayerStatsRow(userId) {
  const { error } = await supabase
    .from('player_stats')
    .upsert({ user_id: userId }, { onConflict: 'user_id' });
  if (error) throw error;
}

async function getPlayerStats(userId) {
  await ensurePlayerStatsRow(userId);
  const { data, error } = await supabase
    .from('player_stats')
    .select('*')
    .eq('user_id', userId)
    .single();
  if (error) throw error;
  return data;
}

async function incrementPlayerStats(userId, deltas) {
  await ensurePlayerStatsRow(userId);
  const current = await getPlayerStats(userId);

  const updatePatch = {};
  for (const field of PLAYER_STAT_FIELDS) {
    const delta = Number(deltas[field] || 0);
    if (!Number.isFinite(delta) || delta === 0) continue;
    updatePatch[field] = Number(current[field] || 0) + delta;
  }

  if (Object.keys(updatePatch).length === 0) return current;

  const { data, error } = await supabase
    .from('player_stats')
    .update(updatePatch)
    .eq('user_id', userId)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function loadTable(tableId) {
  const { data, error } = await supabase.from('tables').select('*').eq('id', tableId).single();
  if (error) throw error;
  return data;
}

async function loadMemberships(tableId) {
  const { data, error } = await supabase
    .from('table_memberships')
    .select('id, table_id, user_id, role, seat_no, paid_entry_cents, paid_wager_cents, contributed_cents, active')
    .eq('table_id', tableId)
    .eq('active', true);
  if (error) throw error;
  return data || [];
}

async function listRoomAudience(tableId) {
  const memberships = await loadMemberships(tableId);
  const userIds = memberships.map((m) => m.user_id);
  if (userIds.length === 0) {
    return [];
  }

  const { data: profiles, error } = await supabase
    .from('player_profiles')
    .select('user_id, display_name, balance_cents')
    .in('user_id', userIds);
  if (error) throw error;

  const profilesById = new Map((profiles || []).map((p) => [p.user_id, p]));
  return memberships.map((m) => {
    const profile = profilesById.get(m.user_id);
    return {
      userId: m.user_id,
      role: m.role,
      seatNo: m.seat_no,
      paidEntryCents: m.paid_entry_cents,
      paidWagerCents: m.paid_wager_cents,
      contributedCents: m.contributed_cents,
      name: profile?.display_name || 'Player',
      balanceCents: profile?.balance_cents || 0,
    };
  });
}

async function broadcastTableState(tableId) {
  const table = await loadTable(tableId);
  const audience = await listRoomAudience(tableId);
  const runtime = roomsRuntime.get(tableId);

  const players = audience
    .filter((a) => a.role === 'player')
    .sort((a, b) => (a.seatNo || 99) - (b.seatNo || 99));
  const spectators = audience
    .filter((a) => a.role === 'spectator')
    .map((s) => ({ userId: s.userId, name: s.name, contributedCents: s.contributedCents }));

  const playerOrder = runtime?.playerOrder || players.map((p) => p.userId);
  const playersById = new Map(players.map((p) => [p.userId, p]));

  for (const watcher of audience) {
    const serializedPlayers = playerOrder
      .filter((id) => playersById.has(id))
      .map((id) => {
        const p = playersById.get(id);
        const hand = runtime?.hands?.get(id) || [];
        const isSelf = id === watcher.userId;
        return {
          userId: id,
          name: p.name,
          seatNo: p.seatNo,
          role: 'player',
          cardsCount: hand.length,
          cards: isSelf ? hand : [],
          paidEntryCents: p.paidEntryCents,
          paidWagerCents: p.paidWagerCents,
          stakeCents: p.paidEntryCents + p.paidWagerCents,
          balanceCents: p.balanceCents,
          contributedCents: p.contributedCents,
        };
      });

    sendToUser(watcher.userId, {
      type: 'table_state',
      tableId,
      started: !!runtime?.started,
      finished: !!runtime?.finished,
      winnerId: runtime?.winnerId || null,
      tableStatus: table.status,
      potCents: table.pot_cents,
      currentTurnId: runtime?.currentTurnId || null,
      tablePlay: runtime?.tablePlay || null,
      tableLeaderId: runtime?.tableLeaderId || null,
      mustOpenWithThreeClubs: runtime?.mustOpenWithThreeClubs || false,
      passes: [...(runtime?.passes || new Set())],
      meRole: watcher.role,
      players: serializedPlayers,
      spectators,
      tournament: table.tournament_id
        ? { id: table.tournament_id, bracket: table.bracket, roundNo: table.round_no }
        : null,
    });
  }
}

async function updateBalance(userId, delta) {
  const { data: row, error: readErr } = await supabase
    .from('player_profiles')
    .select('balance_cents')
    .eq('user_id', userId)
    .single();
  if (readErr) throw readErr;

  const nextBalance = Number(row.balance_cents || 0) + delta;
  if (nextBalance < 0) {
    return { ok: false, code: 'insufficient_balance' };
  }

  const { error: writeErr } = await supabase
    .from('player_profiles')
    .update({ balance_cents: nextBalance })
    .eq('user_id', userId);
  if (writeErr) throw writeErr;

  return { ok: true, balanceCents: nextBalance };
}

function createRuntimeForTable(tableId) {
  const runtime = {
    tableId,
    started: false,
    finished: false,
    playerOrder: [],
    hands: new Map(),
    tablePlay: null,
    tableLeaderId: null,
    currentTurnId: null,
    mustOpenWithThreeClubs: true,
    passes: new Set(),
    winnerId: null,
    standings: null,
  };
  roomsRuntime.set(tableId, runtime);
  return runtime;
}

function getRuntime(tableId) {
  return roomsRuntime.get(tableId) || createRuntimeForTable(tableId);
}

async function maybeStartGame(tableId) {
  const table = await loadTable(tableId);
  const runtime = getRuntime(tableId);
  if (runtime.started && !runtime.finished) return;

  const memberships = await loadMemberships(tableId);
  const players = memberships
    .filter((m) => m.role === 'player')
    .sort((a, b) => (a.seat_no || 99) - (b.seat_no || 99));

  if (players.length !== 4) {
    return;
  }

  const deck = shuffle(makeDeck());
  runtime.playerOrder = players.map((p) => p.user_id);
  runtime.hands.clear();

  runtime.playerOrder.forEach((userId, index) => {
    runtime.hands.set(userId, sortCards(deck.slice(index * 13, index * 13 + 13)));
  });

  runtime.tablePlay = null;
  runtime.tableLeaderId = runtime.playerOrder[0];
  runtime.passes.clear();
  runtime.mustOpenWithThreeClubs = true;
  runtime.started = true;
  runtime.finished = false;
  runtime.winnerId = null;
  runtime.standings = null;

  const starter = runtime.playerOrder.find((id) =>
    (runtime.hands.get(id) || []).some((c) => c.rank === 3 && c.suit === 'clubs'),
  );
  runtime.currentTurnId = starter || runtime.playerOrder[0];

  await supabase.from('tables').update({ status: 'in_progress' }).eq('id', tableId);

  const { data: existingGame } = await supabase
    .from('games')
    .select('id')
    .eq('table_id', tableId)
    .in('status', ['waiting', 'in_progress'])
    .limit(1)
    .maybeSingle();

  if (existingGame?.id) {
    await supabase
      .from('games')
      .update({ status: 'in_progress', started_at: new Date().toISOString() })
      .eq('id', existingGame.id);
  } else {
    await supabase.from('games').insert({
      table_id: tableId,
      status: 'in_progress',
      started_at: new Date().toISOString(),
    });
  }

  await Promise.all(
    runtime.playerOrder.map((userId) =>
      incrementPlayerStats(userId, { games_played: 1 }),
    ),
  );

  await broadcastTableState(tableId);
}

async function settleGame(tableId, winnerId) {
  const runtime = getRuntime(tableId);
  runtime.finished = true;
  runtime.winnerId = winnerId;

  const standings = runtime.playerOrder
    .map((userId) => ({ userId, cardsLeft: (runtime.hands.get(userId) || []).length }))
    .sort((a, b) => a.cardsLeft - b.cardsLeft);

  // Winner should always be first even when cardsLeft ties due to fast finish.
  standings.sort((a, b) => {
    if (a.userId === winnerId) return -1;
    if (b.userId === winnerId) return 1;
    return a.cardsLeft - b.cardsLeft;
  });
  runtime.standings = standings;

  const table = await loadTable(tableId);
  const allMemberships = await loadMemberships(tableId);
  const winnerStake = allMemberships
    .filter((m) => m.user_id === winnerId)
    .reduce((sum, m) => sum + m.paid_entry_cents + m.paid_wager_cents, 0);

  const cap = winnerStake * 2;
  const payout = Math.min(cap || table.pot_cents, table.pot_cents);

  await updateBalance(winnerId, payout);

  await incrementPlayerStats(winnerId, {
    rounds_won: 1,
    money_won_cents: payout,
  });

  const losers = allMemberships.filter((m) => m.role === 'player' && m.user_id !== winnerId);
  await Promise.all(
    losers.map((loser) =>
      incrementPlayerStats(loser.user_id, { losses: 1 }),
    ),
  );

  await supabase.from('tables').update({ status: 'finished', pot_cents: 0 }).eq('id', tableId);
  await supabase
    .from('games')
    .update({
      status: 'finished',
      winner_user_id: winnerId,
      standings,
      finished_at: new Date().toISOString(),
    })
    .eq('table_id', tableId)
    .eq('status', 'in_progress');

  if (table.tournament_id && table.bracket) {
    await supabase.from('tournament_round_results').upsert(
      {
        tournament_id: table.tournament_id,
        round_no: table.round_no,
        bracket: table.bracket,
        table_id: table.id,
        standings,
      },
      { onConflict: 'tournament_id,round_no,bracket' },
    );

    const { data: roundResults } = await supabase
      .from('tournament_round_results')
      .select('*')
      .eq('tournament_id', table.tournament_id)
      .eq('round_no', table.round_no)
      .eq('processed', false);

    if ((roundResults || []).length === 2) {
      const winners = roundResults.find((r) => r.bracket === 'winners');
      const losers = roundResults.find((r) => r.bracket === 'losers');

      if (winners && losers) {
        const topWinners = winners.standings.slice(0, 2).map((x) => x.userId);
        const bottomWinners = winners.standings.slice(2, 4).map((x) => x.userId);
        const topLosers = losers.standings.slice(0, 2).map((x) => x.userId);
        const bottomLosers = losers.standings.slice(2, 4).map((x) => x.userId);

        const newWinners = [...topWinners, ...topLosers].filter(Boolean);
        const newLosers = [...bottomLosers, ...bottomWinners].filter(Boolean);

        await supabase
          .from('table_memberships')
          .update({ role: 'spectator', seat_no: null })
          .in('table_id', [winners.table_id, losers.table_id])
          .eq('active', true)
          .eq('role', 'player');

        for (let i = 0; i < Math.min(4, newWinners.length); i += 1) {
          await supabase.from('table_memberships').upsert(
            {
              table_id: winners.table_id,
              user_id: newWinners[i],
              role: 'player',
              seat_no: i + 1,
              active: true,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'table_id,user_id' },
          );
        }

        for (let i = 0; i < Math.min(4, newLosers.length); i += 1) {
          await supabase.from('table_memberships').upsert(
            {
              table_id: losers.table_id,
              user_id: newLosers[i],
              role: 'player',
              seat_no: i + 1,
              active: true,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'table_id,user_id' },
          );
        }

        await supabase
          .from('tables')
          .update({ status: 'waiting', round_no: table.round_no + 1 })
          .in('id', [winners.table_id, losers.table_id]);

        await supabase
          .from('tournaments')
          .update({ current_round: table.round_no + 1 })
          .eq('id', table.tournament_id);

        await supabase
          .from('tournament_round_results')
          .update({ processed: true })
          .in(
            'id',
            roundResults.map((r) => r.id),
          );
      }
    }
  }

  await broadcastTableState(tableId);
}

function applyPlay(runtime, userId, cardIds) {
  if (!runtime.started || runtime.finished) {
    return { ok: false, code: 'not_active' };
  }
  if (runtime.currentTurnId !== userId) {
    return { ok: false, code: 'not_your_turn' };
  }

  const hand = runtime.hands.get(userId) || [];
  const cards = hand.filter((c) => cardIds.includes(c.id));
  if (cards.length !== cardIds.length) {
    return { ok: false, code: 'cards_not_owned' };
  }

  const combo = findCombo(cards);
  if (!combo) {
    return { ok: false, code: 'invalid_combo' };
  }

  if (runtime.mustOpenWithThreeClubs && !cards.some((c) => c.rank === 3 && c.suit === 'clubs')) {
    return { ok: false, code: 'must_open_3_clubs' };
  }

  const proposed = {
    playerId: userId,
    cards: sortCards(cards),
    type: combo.type,
    strength: combo.strength,
  };

  if (!canBeatPlay(proposed, runtime.tablePlay)) {
    return { ok: false, code: 'play_too_weak' };
  }

  const selected = new Set(cardIds);
  runtime.hands.set(
    userId,
    hand.filter((c) => !selected.has(c.id)),
  );

  runtime.tablePlay = proposed;
  runtime.tableLeaderId = userId;
  runtime.passes.clear();
  runtime.mustOpenWithThreeClubs = false;

  const nextHand = runtime.hands.get(userId) || [];
  if (nextHand.length === 0) {
    return { ok: true, finished: true, comboType: combo.type };
  }

  const activeIds = runtime.playerOrder.filter((id) => (runtime.hands.get(id) || []).length > 0);
  runtime.currentTurnId = nextTurn(activeIds, userId);
  return { ok: true, finished: false, comboType: combo.type };
}

function applyPass(runtime, userId) {
  if (!runtime.started || runtime.finished) {
    return { ok: false, code: 'not_active' };
  }
  if (!runtime.tablePlay) {
    return { ok: false, code: 'cannot_pass_open_table' };
  }
  if (runtime.currentTurnId !== userId) {
    return { ok: false, code: 'not_your_turn' };
  }

  runtime.passes.add(userId);
  const activeOthers = runtime.playerOrder.filter(
    (id) => id !== runtime.tableLeaderId && (runtime.hands.get(id) || []).length > 0,
  );

  if (activeOthers.every((id) => runtime.passes.has(id))) {
    runtime.tablePlay = null;
    runtime.passes.clear();
    runtime.currentTurnId = runtime.tableLeaderId;
    return { ok: true };
  }

  const activeIds = runtime.playerOrder.filter((id) => (runtime.hands.get(id) || []).length > 0);
  runtime.currentTurnId = nextTurn(activeIds, userId);
  return { ok: true };
}

async function findOrCreateOpenTable(entryCents, wagerCents, isPrivate = false, roomCode = null) {
  const minWager = entryCents > 0 ? Math.max(entryCents * 2, wagerCents) : 0;

  let query = supabase
    .from('tables')
    .select('*')
    .eq('status', 'waiting')
    .eq('is_private', !!isPrivate)
    .eq('entry_fee_cents', entryCents)
    .eq('min_wager_cents', minWager)
    .is('tournament_id', null)
    .limit(1);

  if (isPrivate && roomCode) {
    query = query.eq('room_code', roomCode.toUpperCase());
  }

  const { data: existing } = await query;
  if (existing && existing.length > 0) return existing[0];

  const name = isPrivate ? `Private ${roomCode || uuidv4().slice(0, 6).toUpperCase()}` : `Public ${moneyLabel(entryCents, minWager)}`;
  const code = isPrivate ? (roomCode || uuidv4().slice(0, 6)).toUpperCase() : null;

  const { data: created, error } = await supabase
    .from('tables')
    .insert({
      name,
      is_private: isPrivate,
      room_code: code,
      entry_fee_cents: entryCents,
      min_wager_cents: minWager,
      status: 'waiting',
      seat_count: 4,
    })
    .select('*')
    .single();

  if (error) throw error;
  return created;
}

function moneyLabel(entry, wager) {
  return `$${(entry / 100).toFixed(2)} / $${(wager / 100).toFixed(2)}`;
}

async function joinTableAs(user, payload, desiredRole) {
  const role = desiredRole === 'spectator' ? 'spectator' : 'player';
  const tableId = payload.tableId || null;
  const entryCents = Number(payload.entryCents || 0);
  const wagerCents = Number(payload.wagerCents || 0);
  const isPrivate = !!payload.private;
  const roomCode = payload.roomCode ? String(payload.roomCode).trim().toUpperCase() : null;

  let table = null;
  if (tableId) {
    table = await loadTable(tableId);
  } else {
    if (!Number.isInteger(entryCents) || !Number.isInteger(wagerCents) || entryCents < 0 || wagerCents < 0) {
      return { ok: false, code: 'bad_stake' };
    }
    table = await findOrCreateOpenTable(entryCents, wagerCents, isPrivate, roomCode);
  }

  const tableMinWager = table.entry_fee_cents > 0 ? Math.max(table.min_wager_cents, table.entry_fee_cents * 2) : 0;
  const wagerForSeat = Number(payload.wagerCents ?? tableMinWager);

  const memberships = await loadMemberships(table.id);
  const existing = memberships.find((m) => m.user_id === user.id);
  const playerSeats = memberships.filter((m) => m.role === 'player').map((m) => m.seat_no).filter(Boolean);

  const profile = await ensureProfile(user);

  if (role === 'player') {
    if (table.entry_fee_cents > 0 && (!Number.isInteger(wagerForSeat) || wagerForSeat < tableMinWager)) {
      return { ok: false, code: 'min_wager_not_met' };
    }

    let seatNo = null;
    if (existing?.role === 'player' && existing.seat_no) {
      seatNo = existing.seat_no;
    } else {
      for (let i = 1; i <= 4; i += 1) {
        if (!playerSeats.includes(i)) {
          seatNo = i;
          break;
        }
      }
    }

    if (!seatNo) {
      return { ok: false, code: 'table_full' };
    }

    const alreadyPaid = existing && existing.role === 'player' && existing.paid_wager_cents > 0;
    const stake = alreadyPaid ? 0 : table.entry_fee_cents + wagerForSeat;
    if (stake > 0) {
      const debit = await updateBalance(user.id, -stake);
      if (!debit.ok) {
        return { ok: false, code: 'insufficient_balance' };
      }
      await supabase.from('table_pot_contributions').insert({
        table_id: table.id,
        user_id: user.id,
        amount_cents: stake,
        source: 'buy_in',
      });
      await supabase
        .from('tables')
        .update({ pot_cents: (table.pot_cents || 0) + stake })
        .eq('id', table.id);
      table.pot_cents = (table.pot_cents || 0) + stake;

      await incrementPlayerStats(user.id, {
        entry_fees_paid_cents: table.entry_fee_cents,
        wagers_paid_cents: wagerForSeat,
        pot_contributed_cents: stake,
      });
    }

    const nextPaidEntry = alreadyPaid ? existing.paid_entry_cents : table.entry_fee_cents;
    const nextPaidWager = alreadyPaid ? existing.paid_wager_cents : wagerForSeat;
    const nextContrib = (existing?.contributed_cents || 0) + stake;

    await supabase.from('table_memberships').upsert(
      {
        table_id: table.id,
        user_id: user.id,
        role: 'player',
        seat_no: seatNo,
        paid_entry_cents: nextPaidEntry,
        paid_wager_cents: nextPaidWager,
        contributed_cents: nextContrib,
        active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'table_id,user_id' },
    );
  } else {
    await supabase.from('table_memberships').upsert(
      {
        table_id: table.id,
        user_id: user.id,
        role: 'spectator',
        seat_no: null,
        active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'table_id,user_id' },
    );
  }

  sendToUser(user.id, {
    type: 'joined_table',
    tableId: table.id,
    role,
    tableName: table.name,
    entryCents: table.entry_fee_cents,
    minWagerCents: tableMinWager,
    potCents: table.pot_cents,
    displayName: profile.display_name,
  });

  await maybeStartGame(table.id);
  await broadcastTableState(table.id);
  return { ok: true, tableId: table.id };
}

const app = express();
app.use(cors({ origin: APP_ORIGIN }));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true, mode: 'supabase-backed' });
});

async function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'missing_auth' });
    return;
  }
  const token = auth.slice(7);
  const user = await getUserFromToken(token);
  if (!user) {
    res.status(401).json({ error: 'bad_auth' });
    return;
  }
  req.authUser = user;
  next();
}

app.get('/auth/me', requireAuth, async (req, res) => {
  try {
    const profile = await ensureProfile(req.authUser);
    const stats = await getPlayerStats(req.authUser.id);
    res.json({
      userId: req.authUser.id,
      email: req.authUser.email,
      displayName: profile.display_name,
      balanceCents: profile.balance_cents,
      stats,
    });
  } catch (error) {
    res.status(500).json({ error: 'profile_failed', detail: String(error.message || error) });
  }
});

app.get('/stats/me', requireAuth, async (req, res) => {
  try {
    const stats = await getPlayerStats(req.authUser.id);
    res.json({ stats });
  } catch (error) {
    res.status(500).json({ error: 'stats_failed', detail: String(error.message || error) });
  }
});

app.post('/profile', requireAuth, async (req, res) => {
  try {
    const displayName = String(req.body.displayName || 'Player').slice(0, 20);
    const { data, error } = await supabase
      .from('player_profiles')
      .update({ display_name: displayName })
      .eq('user_id', req.authUser.id)
      .select('*')
      .single();
    if (error) throw error;
    res.json({ displayName: data.display_name, balanceCents: data.balance_cents });
  } catch (error) {
    res.status(500).json({ error: 'profile_update_failed', detail: String(error.message || error) });
  }
});

app.post('/wallet/deposit/mock', requireAuth, async (req, res) => {
  try {
    const amountCents = Number(req.body.amountCents || 0);
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      res.status(400).json({ error: 'bad_amount' });
      return;
    }
    const result = await updateBalance(req.authUser.id, amountCents);
    if (!result.ok) {
      res.status(400).json({ error: result.code });
      return;
    }
    res.json({ balanceCents: result.balanceCents });
  } catch (error) {
    res.status(500).json({ error: 'deposit_failed', detail: String(error.message || error) });
  }
});

app.get('/tables', async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('tables')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;

    const payload = await Promise.all(
      (data || []).map(async (table) => {
        const members = await loadMemberships(table.id);
        const players = members.filter((m) => m.role === 'player').length;
        const spectators = members.filter((m) => m.role === 'spectator').length;
        return {
          id: table.id,
          name: table.name,
          private: table.is_private,
          roomCode: table.room_code,
          entryCents: table.entry_fee_cents,
          minWagerCents: table.min_wager_cents,
          potCents: table.pot_cents,
          players,
          spectators,
          status: table.status,
          tournamentId: table.tournament_id,
          bracket: table.bracket,
          roundNo: table.round_no,
        };
      }),
    );

    res.json({ tables: payload });
  } catch (error) {
    res.status(500).json({ error: 'tables_failed', detail: String(error.message || error) });
  }
});

app.post('/tables', requireAuth, async (req, res) => {
  try {
    const name = String(req.body.name || 'Custom Table').slice(0, 30);
    const entryCents = Number(req.body.entryCents || 0);
    const minWagerCents = Number(req.body.minWagerCents || 0);
    const isPrivate = !!req.body.private;
    const roomCode = isPrivate ? String(req.body.roomCode || uuidv4().slice(0, 6)).toUpperCase() : null;

    if (!Number.isInteger(entryCents) || !Number.isInteger(minWagerCents) || entryCents < 0 || minWagerCents < 0) {
      res.status(400).json({ error: 'bad_stake' });
      return;
    }

    const minimum = entryCents > 0 ? Math.max(entryCents * 2, minWagerCents) : 0;
    const { data, error } = await supabase
      .from('tables')
      .insert({
        name,
        is_private: isPrivate,
        room_code: roomCode,
        entry_fee_cents: entryCents,
        min_wager_cents: minimum,
        created_by: req.authUser.id,
      })
      .select('*')
      .single();
    if (error) throw error;

    res.json({
      id: data.id,
      name: data.name,
      private: data.is_private,
      roomCode: data.room_code,
      entryCents: data.entry_fee_cents,
      minWagerCents: data.min_wager_cents,
    });
  } catch (error) {
    res.status(500).json({ error: 'table_create_failed', detail: String(error.message || error) });
  }
});

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

wss.on('connection', async (socket, req) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get('token') || '';
    const user = await getUserFromToken(token);
    if (!user) {
      socket.close(4001, 'unauthorized');
      return;
    }
    await ensureProfile(user);

    socketsByUser.set(user.id, socket);

    socket.on('message', async (raw) => {
      let msg = null;
      try {
        msg = JSON.parse(String(raw));
      } catch (_error) {
        return;
      }

      try {
        if (msg.type === 'join_room') {
          const result = await joinTableAs(user, msg, 'player');
          if (!result.ok) sendToUser(user.id, { type: 'error', code: result.code });
          return;
        }

        if (msg.type === 'spectate_table') {
          const result = await joinTableAs(user, msg, 'spectator');
          if (!result.ok) sendToUser(user.id, { type: 'error', code: result.code });
          return;
        }

        if (msg.type === 'switch_to_spectator') {
          const tableId = String(msg.tableId || '');
          if (!tableId) return;
          await supabase
            .from('table_memberships')
            .update({ role: 'spectator', seat_no: null, updated_at: new Date().toISOString() })
            .eq('table_id', tableId)
            .eq('user_id', user.id)
            .eq('active', true);
          await broadcastTableState(tableId);
          return;
        }

        if (msg.type === 'add_to_pot') {
          const tableId = String(msg.tableId || '');
          const amountCents = Number(msg.amountCents || 0);
          if (!tableId || !Number.isInteger(amountCents) || amountCents <= 0) {
            sendToUser(user.id, { type: 'error', code: 'bad_amount' });
            return;
          }

          const memberships = await loadMemberships(tableId);
          const mine = memberships.find((m) => m.user_id === user.id);
          if (!mine) {
            sendToUser(user.id, { type: 'error', code: 'not_in_table' });
            return;
          }

          const debit = await updateBalance(user.id, -amountCents);
          if (!debit.ok) {
            sendToUser(user.id, { type: 'error', code: debit.code });
            return;
          }

          await supabase.from('table_pot_contributions').insert({
            table_id: tableId,
            user_id: user.id,
            amount_cents: amountCents,
            source: mine.role === 'spectator' ? 'spectator_add' : 'extra',
          });

          await supabase
            .from('table_memberships')
            .update({ contributed_cents: (mine.contributed_cents || 0) + amountCents, updated_at: new Date().toISOString() })
            .eq('id', mine.id);

          const table = await loadTable(tableId);
          await supabase
            .from('tables')
            .update({ pot_cents: (table.pot_cents || 0) + amountCents })
            .eq('id', tableId);

          await incrementPlayerStats(user.id, {
            pot_contributed_cents: amountCents,
          });

          await broadcastTableState(tableId);
          return;
        }

        if (msg.type === 'play') {
          const tableId = String(msg.tableId || '');
          if (!tableId) return;
          const runtime = getRuntime(tableId);
          const cardIds = Array.isArray(msg.cardIds) ? msg.cardIds : [];
          const result = applyPlay(runtime, user.id, cardIds);
          if (!result.ok) {
            sendToUser(user.id, { type: 'error', code: result.code });
            return;
          }

          if (result.comboType === 'bomb') {
            await incrementPlayerStats(user.id, { bombs_played: 1 });
          }

          if (result.finished) {
            await settleGame(tableId, user.id);
            return;
          }
          await broadcastTableState(tableId);
          return;
        }

        if (msg.type === 'pass') {
          const tableId = String(msg.tableId || '');
          if (!tableId) return;
          const runtime = getRuntime(tableId);
          const result = applyPass(runtime, user.id);
          if (!result.ok) {
            sendToUser(user.id, { type: 'error', code: result.code });
            return;
          }
          await broadcastTableState(tableId);
          return;
        }

        if (msg.type === 'chat') {
          const tableId = String(msg.tableId || '');
          const text = String(msg.text || '').trim().slice(0, 300);
          if (!tableId || !text) return;
          const audience = await listRoomAudience(tableId);
          const sender = audience.find((a) => a.userId === user.id)?.name || 'Player';
          for (const person of audience) {
            sendToUser(person.userId, { type: 'chat', sender, text });
          }
          return;
        }
      } catch (error) {
        sendToUser(user.id, { type: 'error', code: 'server_error', detail: String(error.message || error) });
      }
    });

    socket.on('close', () => {
      if (socketsByUser.get(user.id) === socket) {
        socketsByUser.delete(user.id);
      }
    });
  } catch (_error) {
    socket.close(4002, 'auth_failed');
  }
});

httpServer.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
