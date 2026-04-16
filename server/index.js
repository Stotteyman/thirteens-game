const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const { createServer } = require('http');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const { ethers } = require('ethers');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const PORT = Number(process.env.PORT || 8088);
const APP_ORIGIN = process.env.APP_ORIGIN || '*';

const suits = ['clubs', 'diamonds', 'hearts', 'spades'];
const suitOrder = { clubs: 0, diamonds: 1, hearts: 2, spades: 3 };

const nonces = new Map();
const sessions = new Map();
const balances = new Map();
const socketsByPlayer = new Map();
const rooms = new Map();

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
  if (!currentPlay) {
    return true;
  }

  const currentTopRank = sortCards(currentPlay.cards)[currentPlay.cards.length - 1].rank;
  if (nextPlay.type === 'bomb' && currentPlay.type === 'single' && currentTopRank === 15) {
    return true;
  }

  if (nextPlay.type !== currentPlay.type) {
    return false;
  }

  if (nextPlay.type === 'straight' && nextPlay.cards.length !== currentPlay.cards.length) {
    return false;
  }

  return nextPlay.strength > currentPlay.strength;
}

function nextTurn(activeIds, fromId) {
  const idx = activeIds.indexOf(fromId);
  if (idx === -1) {
    return activeIds[0];
  }
  return activeIds[(idx + 1) % activeIds.length];
}

function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'missing_auth' });
    return;
  }

  try {
    const token = auth.substring(7);
    const payload = jwt.verify(token, JWT_SECRET);
    req.playerId = payload.playerId;
    req.wallet = payload.wallet;
    next();
  } catch (error) {
    res.status(401).json({ error: 'bad_auth' });
  }
}

function buildPublicState(room, targetPlayerId) {
  const players = room.playerOrder.map((id) => {
    const p = room.players.get(id);
    const own = id === targetPlayerId;
    return {
      playerId: id,
      name: p.name,
      wallet: p.wallet,
      cardsCount: p.cards.length,
      cards: own ? p.cards : [],
      entryCents: p.entryCents,
      wagerCents: p.wagerCents,
      stakeCents: p.entryCents + p.wagerCents,
      balanceCents: balances.get(id) || 0,
    };
  });

  return {
    type: 'game_state',
    roomId: room.id,
    started: room.started,
    finished: room.finished,
    winnerId: room.winnerId,
    potCents: room.potCents,
    tablePlay: room.tablePlay,
    tableLeaderId: room.tableLeaderId,
    currentTurnId: room.currentTurnId,
    mustOpenWithThreeClubs: room.mustOpenWithThreeClubs,
    passes: [...room.passes],
    players,
    payout: room.payout,
  };
}

function sendToPlayer(playerId, payload) {
  const socket = socketsByPlayer.get(playerId);
  if (socket && socket.readyState === 1) {
    socket.send(JSON.stringify(payload));
  }
}

function broadcastRoom(room) {
  room.playerOrder.forEach((id) => {
    sendToPlayer(id, buildPublicState(room, id));
  });
}

function tryStartRoom(room) {
  if (room.started || room.playerOrder.length < 4) {
    return;
  }

  for (const playerId of room.playerOrder) {
    const p = room.players.get(playerId);
    const stake = p.entryCents + p.wagerCents;
    const balance = balances.get(playerId) || 0;
    if (balance < stake) {
      sendToPlayer(playerId, {
        type: 'error',
        code: 'insufficient_balance',
        message: 'Top up your internal balance to cover stake.',
      });
      return;
    }
  }

  room.potCents = 0;
  room.playerOrder.forEach((playerId) => {
    const p = room.players.get(playerId);
    const stake = p.entryCents + p.wagerCents;
    room.potCents += stake;
    balances.set(playerId, (balances.get(playerId) || 0) - stake);
  });

  const deck = shuffle(makeDeck());
  room.playerOrder.forEach((playerId, index) => {
    const hand = sortCards(deck.slice(index * 13, index * 13 + 13));
    room.players.get(playerId).cards = hand;
  });

  room.tablePlay = null;
  room.tableLeaderId = room.playerOrder[0];
  room.passes.clear();
  room.mustOpenWithThreeClubs = true;
  room.started = true;
  room.finished = false;
  room.winnerId = null;
  room.payout = null;

  const starterId = room.playerOrder.find((id) =>
    room.players.get(id).cards.some((card) => card.rank === 3 && card.suit === 'clubs'),
  );

  room.currentTurnId = starterId || room.playerOrder[0];
  broadcastRoom(room);
}

function settleRoom(room, winnerId) {
  const winner = room.players.get(winnerId);
  const winnerStake = winner.entryCents + winner.wagerCents;
  const cap = winnerStake * 2;
  const payout = Math.min(cap, room.potCents);

  balances.set(winnerId, (balances.get(winnerId) || 0) + payout);

  let remainder = room.potCents - payout;
  const losers = room.playerOrder.filter((id) => id !== winnerId);
  const losersTotal = losers.reduce((sum, id) => {
    const p = room.players.get(id);
    return sum + p.entryCents + p.wagerCents;
  }, 0);

  if (remainder > 0 && losersTotal > 0) {
    losers.forEach((id) => {
      const p = room.players.get(id);
      const stake = p.entryCents + p.wagerCents;
      const share = Math.floor((remainder * stake) / losersTotal);
      balances.set(id, (balances.get(id) || 0) + share);
      remainder -= share;
    });

    if (remainder > 0) {
      const firstLoser = losers[0];
      balances.set(firstLoser, (balances.get(firstLoser) || 0) + remainder);
      remainder = 0;
    }
  }

  room.finished = true;
  room.winnerId = winnerId;
  room.payout = {
    winnerStakeCents: winnerStake,
    winnerPayoutCents: payout,
    capCents: cap,
    potCents: room.potCents,
  };
}

function applyPlay(room, playerId, cardIds) {
  if (!room.started || room.finished) {
    return { ok: false, code: 'not_active' };
  }
  if (room.currentTurnId !== playerId) {
    return { ok: false, code: 'not_your_turn' };
  }

  const player = room.players.get(playerId);
  const cards = player.cards.filter((c) => cardIds.includes(c.id));
  if (cards.length !== cardIds.length) {
    return { ok: false, code: 'cards_not_owned' };
  }

  const combo = findCombo(cards);
  if (!combo) {
    return { ok: false, code: 'invalid_combo' };
  }

  if (room.mustOpenWithThreeClubs && !cards.some((c) => c.rank === 3 && c.suit === 'clubs')) {
    return { ok: false, code: 'must_open_3_clubs' };
  }

  const proposed = {
    playerId,
    cards: sortCards(cards),
    type: combo.type,
    strength: combo.strength,
  };

  if (!canBeatPlay(proposed, room.tablePlay)) {
    return { ok: false, code: 'play_too_weak' };
  }

  const selected = new Set(cardIds);
  player.cards = player.cards.filter((c) => !selected.has(c.id));

  room.tablePlay = proposed;
  room.tableLeaderId = playerId;
  room.passes.clear();
  room.mustOpenWithThreeClubs = false;

  if (player.cards.length === 0) {
    settleRoom(room, playerId);
    return { ok: true, finished: true };
  }

  const activeIds = room.playerOrder.filter((id) => room.players.get(id).cards.length > 0);
  room.currentTurnId = nextTurn(activeIds, playerId);
  return { ok: true, finished: false };
}

function pass(room, playerId) {
  if (!room.started || room.finished) {
    return { ok: false, code: 'not_active' };
  }
  if (!room.tablePlay) {
    return { ok: false, code: 'cannot_pass_open_table' };
  }
  if (room.currentTurnId !== playerId) {
    return { ok: false, code: 'not_your_turn' };
  }

  room.passes.add(playerId);
  const activeOthers = room.playerOrder.filter(
    (id) => id !== room.tableLeaderId && room.players.get(id).cards.length > 0,
  );

  if (activeOthers.every((id) => room.passes.has(id))) {
    room.tablePlay = null;
    room.passes.clear();
    room.currentTurnId = room.tableLeaderId;
    return { ok: true };
  }

  const activeIds = room.playerOrder.filter((id) => room.players.get(id).cards.length > 0);
  room.currentTurnId = nextTurn(activeIds, playerId);
  return { ok: true };
}

function createRoom(stakeKey) {
  const room = {
    id: uuidv4(),
    stakeKey,
    started: false,
    finished: false,
    playerOrder: [],
    players: new Map(),
    potCents: 0,
    tablePlay: null,
    tableLeaderId: null,
    currentTurnId: null,
    mustOpenWithThreeClubs: true,
    passes: new Set(),
    winnerId: null,
    payout: null,
  };
  rooms.set(room.id, room);
  return room;
}

function findOpenRoom(stakeKey) {
  for (const room of rooms.values()) {
    if (room.stakeKey === stakeKey && !room.started && room.playerOrder.length < 4) {
      return room;
    }
  }
  return null;
}

const app = express();
app.use(cors({ origin: APP_ORIGIN }));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true, network: 'base-sepolia', mode: 'offchain-ledger-with-l2-cashout' });
});

app.post('/auth/challenge', (req, res) => {
  const wallet = String(req.body.wallet || '').toLowerCase();
  if (!wallet || !wallet.startsWith('0x')) {
    res.status(400).json({ error: 'bad_wallet' });
    return;
  }

  const nonce = uuidv4();
  nonces.set(wallet, nonce);
  res.json({ nonce, message: `Sign in to Tien Len: ${nonce}` });
});

app.post('/auth/verify', (req, res) => {
  const wallet = String(req.body.wallet || '').toLowerCase();
  const signature = String(req.body.signature || '');
  const nonce = String(req.body.nonce || '');
  const displayName = String(req.body.displayName || 'Player').slice(0, 20);

  if (nonces.get(wallet) !== nonce) {
    res.status(400).json({ error: 'bad_nonce' });
    return;
  }

  const message = `Sign in to Tien Len: ${nonce}`;
  let verifiedWallet = '';

  try {
    verifiedWallet = ethers.verifyMessage(message, signature).toLowerCase();
  } catch (_error) {
    verifiedWallet = '';
  }

  // Demo fallback for Expo Go without wallet SDK.
  if (!verifiedWallet && signature === `demo:${wallet}:${nonce}`) {
    verifiedWallet = wallet;
  }

  if (verifiedWallet !== wallet) {
    res.status(401).json({ error: 'bad_signature' });
    return;
  }

  const playerId = sessions.get(wallet)?.playerId || uuidv4();
  const token = jwt.sign({ playerId, wallet }, JWT_SECRET, { expiresIn: '7d' });

  sessions.set(wallet, { playerId, wallet, displayName, token });
  if (!balances.has(playerId)) {
    balances.set(playerId, 0);
  }

  res.json({ token, playerId, wallet, displayName, balanceCents: balances.get(playerId) || 0 });
});

app.get('/wallet/me', requireAuth, (req, res) => {
  res.json({ playerId: req.playerId, wallet: req.wallet, balanceCents: balances.get(req.playerId) || 0 });
});

app.post('/wallet/deposit/mock', requireAuth, (req, res) => {
  const amountCents = Number(req.body.amountCents || 0);
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    res.status(400).json({ error: 'bad_amount' });
    return;
  }

  balances.set(req.playerId, (balances.get(req.playerId) || 0) + amountCents);
  res.json({ balanceCents: balances.get(req.playerId) || 0 });
});

app.post('/wallet/cashout/quote', requireAuth, (req, res) => {
  const amountCents = Number(req.body.amountCents || 0);
  const chain = String(req.body.chain || 'base');
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    res.status(400).json({ error: 'bad_amount' });
    return;
  }

  const fixedFeeCents = 2;
  const variableFee = Math.ceil(amountCents * 0.0015);
  const feeCents = Math.max(fixedFeeCents, variableFee);

  res.json({
    chain,
    amountCents,
    feeCents,
    receiveCents: Math.max(0, amountCents - feeCents),
    note: 'Cashout runs on low-fee L2. In-game transfers stay off-chain and free.',
  });
});

app.post('/wallet/cashout/request', requireAuth, (req, res) => {
  const amountCents = Number(req.body.amountCents || 0);
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    res.status(400).json({ error: 'bad_amount' });
    return;
  }

  const balance = balances.get(req.playerId) || 0;
  if (balance < amountCents) {
    res.status(400).json({ error: 'insufficient_balance' });
    return;
  }

  const fixedFeeCents = 2;
  const variableFee = Math.ceil(amountCents * 0.0015);
  const feeCents = Math.max(fixedFeeCents, variableFee);
  const net = Math.max(0, amountCents - feeCents);

  balances.set(req.playerId, balance - amountCents);

  res.json({
    status: 'queued',
    txMode: 'batched-l2-relayer',
    netReceiveCents: net,
    feeCents,
    balanceCents: balances.get(req.playerId) || 0,
  });
});

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

wss.on('connection', (socket, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get('token') || '';

  let playerId = '';
  let wallet = '';

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    playerId = payload.playerId;
    wallet = payload.wallet;
  } catch (_error) {
    socket.close(4001, 'unauthorized');
    return;
  }

  socketsByPlayer.set(playerId, socket);

  socket.on('message', (raw) => {
    let data = null;
    try {
      data = JSON.parse(String(raw));
    } catch (_error) {
      return;
    }

    if (data.type === 'join_room') {
      const displayName = String(data.displayName || 'Player').slice(0, 20);
      const entryCents = Number(data.entryCents || 0);
      const wagerCents = Number(data.wagerCents || 0);
      const stakeCents = entryCents + wagerCents;

      if (!Number.isInteger(entryCents) || !Number.isInteger(wagerCents) || stakeCents <= 0) {
        sendToPlayer(playerId, { type: 'error', code: 'bad_stake' });
        return;
      }

      const stakeKey = `${entryCents}-${wagerCents}`;
      let room = findOpenRoom(stakeKey);
      if (!room) {
        room = createRoom(stakeKey);
      }

      if (!room.players.has(playerId)) {
        room.playerOrder.push(playerId);
        room.players.set(playerId, {
          playerId,
          wallet,
          name: displayName,
          entryCents,
          wagerCents,
          cards: [],
        });
      }

      room.playerOrder.forEach((id) => {
        sendToPlayer(id, {
          type: 'room_waiting',
          roomId: room.id,
          waitingFor: Math.max(0, 4 - room.playerOrder.length),
          players: room.playerOrder.map((pid) => ({
            playerId: pid,
            name: room.players.get(pid).name,
            wallet: room.players.get(pid).wallet,
          })),
        });
      });

      tryStartRoom(room);
      return;
    }

    if (data.type === 'play') {
      const room = [...rooms.values()].find((r) => r.players.has(playerId));
      if (!room) {
        return;
      }
      const cardIds = Array.isArray(data.cardIds) ? data.cardIds : [];
      const result = applyPlay(room, playerId, cardIds);
      if (!result.ok) {
        sendToPlayer(playerId, { type: 'error', code: result.code });
        return;
      }
      broadcastRoom(room);
      return;
    }

    if (data.type === 'pass') {
      const room = [...rooms.values()].find((r) => r.players.has(playerId));
      if (!room) {
        return;
      }
      const result = pass(room, playerId);
      if (!result.ok) {
        sendToPlayer(playerId, { type: 'error', code: result.code });
        return;
      }
      broadcastRoom(room);
      return;
    }

    if (data.type === 'chat') {
      const text = String(data.text || '').trim().slice(0, 300);
      if (!text) return;
      const session = sessions.get(wallet);
      const senderName = session ? session.displayName : 'Player';
      // Broadcast to everyone in the same room as this player
      const room = [...rooms.values()].find((r) => r.players.has(playerId));
      if (room) {
        for (const pid of room.players.keys()) {
          sendToPlayer(pid, { type: 'chat', sender: senderName, text });
        }
      }
      return;
    }
  });

  socket.on('close', () => {
    if (socketsByPlayer.get(playerId) === socket) {
      socketsByPlayer.delete(playerId);
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
