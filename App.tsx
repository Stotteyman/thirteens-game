import 'react-native-get-random-values';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { Audio } from 'expo-av';
import * as WebBrowser from 'expo-web-browser';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  Card,
  ComboType,
  Play,
  RANK_LABEL,
  canBeatPlay,
  findCombo,
  makeDeck,
  nextTurn,
  removeCards,
  shuffle,
  sortCards,
} from './shared/gameEngine';
import { supabase } from './lib/supabase';

// â”€â”€â”€ Screen / Navigation Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

type Screen =
  | 'menu'
  | 'connect'
  | 'settings'
  | 'sp_lobby'
  | 'sp_game'
  | 'publicrooms'
  | 'privaterooms'
  | 'mp_waiting'
  | 'mp_playing'
  | 'mp_finished';

// â”€â”€â”€ Single-Player Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

type Difficulty = 'easy' | 'medium' | 'hard';
type Language = 'en' | 'es' | 'zh';

type SPPlayer = {
  id: string;
  name: string;
  hand: Card[];
  isBot: boolean;
  difficulty: Difficulty;
};

type SPGame = {
  players: SPPlayer[];
  turnIndex: number;
  tablePlay: { playerId: string; cards: Card[]; type: ComboType; strength: number } | null;
  tableLeaderId: string | null;
  passes: Set<string>;
  winner: string | null;
  mustOpenWithThreeClubs: boolean;
};

// â”€â”€â”€ Multiplayer Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

type MPPlayer = {
  playerId: string;
  name: string;
  wallet: string;
  cardsCount: number;
  cards: Card[];
  entryCents: number;
  wagerCents: number;
  stakeCents: number;
  balanceCents: number;
};

type MPPlay = {
  playerId: string;
  cards: Card[];
  type: ComboType;
  strength: number;
};

type MPGameState = {
  type: 'game_state';
  roomId: string;
  started: boolean;
  finished: boolean;
  winnerId: string | null;
  potCents: number;
  tablePlay: MPPlay | null;
  tableLeaderId: string | null;
  currentTurnId: string | null;
  mustOpenWithThreeClubs: boolean;
  passes: string[];
  players: MPPlayer[];
  payout: {
    winnerStakeCents: number;
    winnerPayoutCents: number;
    capCents: number;
    potCents: number;
  } | null;
};

type ChatMessage = {
  id: string;
  sender: string;
  text: string;
};

type MockRoom = {
  id: string;
  name: string;
  stakes: string;
  players: number;
  maxPlayers: number;
  status: 'waiting' | 'in-progress' | 'full';
};

// â”€â”€â”€ Constants â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const DEMO_SERVER = process.env.EXPO_PUBLIC_SERVER_URL ?? 'http://localhost:8088';
const SUPABASE_REDIRECT_URI = 'thirteens://auth';
const HUMAN_ID = 'human';

const SUIT_TEXT_BY_LANG: Record<Language, Record<Card['suit'], string>> = {
  en: { clubs: 'C', diamonds: 'D', hearts: 'H', spades: 'S' },
  es: { clubs: 'T', diamonds: 'D', hearts: 'C', spades: 'P' },
  zh: { clubs: '梅', diamonds: '方', hearts: '红', spades: '黑' },
};

const I18N = {
  en: {
    appTitle: 'Tien Len',
    menuWelcome: 'Welcome',
    menuGuest: 'Browse freely - sign in to join paid tables.',
    connectWallet: 'Sign In',
    walletConnected: 'Account Connected',
    settings: 'Settings',
    singlePlayer: 'Single Player',
    publicRooms: 'Public Rooms',
    privateRooms: 'Private Rooms',
    settingsHint: 'Display name and language',
    connectHint: 'Secure authentication via Supabase OAuth',
    settingsTitle: 'Settings',
    displayName: 'Display name',
    language: 'Language',
    save: 'Save',
    english: 'English',
    spanish: 'Spanish',
    chinese: 'Chinese',
    connectTitle: 'Sign In',
    connectDescription: 'Sign in with Supabase OAuth to join tables and manage your balance.',
    walletAddress: 'Account',
    connectNow: 'Sign in with Google',
    disconnect: 'Disconnect',
    topUp: 'Top Up',
    refresh: 'Refresh',
    quoteCashout: 'Quote and Cashout (L2)',
    serverConfigMissingTitle: 'WalletConnect setup missing',
    serverConfigMissingBody: 'Set EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID in your environment.',
    authFailed: 'Authentication failed',
    connectRequiredTitle: 'Sign In Required',
    connectRequiredBody: 'You need to sign in before joining a table.',
    connectNowAction: 'Connect Now',
    cancel: 'Cancel',
    backToMenu: '< Menu',
    yourTurn: 'Your turn',
    waitingTurn: 'is thinking...',
    includeThreeClubs: 'include 3 of clubs',
    tableOpen: 'Table is open',
  },
  es: {
    appTitle: 'Tien Len',
    menuWelcome: 'Bienvenido',
    menuGuest: 'Explora libremente: conecta tu billetera para jugar de verdad.',
    connectWallet: 'Conectar billetera',
    walletConnected: 'Billetera conectada',
    settings: 'Configuracion',
    singlePlayer: 'Un jugador',
    publicRooms: 'Salas publicas',
    privateRooms: 'Salas privadas',
    settingsHint: 'Nombre y idioma',
    connectHint: 'Autenticacion segura con WalletConnect',
    settingsTitle: 'Configuracion',
    displayName: 'Nombre',
    language: 'Idioma',
    save: 'Guardar',
    english: 'Ingles',
    spanish: 'Espanol',
    chinese: 'Chino',
    connectTitle: 'Conectar billetera',
    connectDescription: 'Inicia sesion con WalletConnect para unirte a partidas y usar funciones de billetera.',
    walletAddress: 'Direccion de billetera',
    connectNow: 'Conectar con WalletConnect',
    disconnect: 'Desconectar',
    topUp: 'Recargar',
    refresh: 'Actualizar',
    quoteCashout: 'Cotizar y retirar (L2)',
    serverConfigMissingTitle: 'Falta configurar WalletConnect',
    serverConfigMissingBody: 'Define EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID en tu entorno.',
    authFailed: 'Error de autenticacion',
    connectRequiredTitle: 'Conectar billetera',
    connectRequiredBody: 'Necesitas conectar tu billetera para unirte.',
    connectNowAction: 'Conectar ahora',
    cancel: 'Cancelar',
    backToMenu: '< Menu',
    yourTurn: 'Tu turno',
    waitingTurn: 'esta pensando...',
    includeThreeClubs: 'incluye 3 de treboles',
    tableOpen: 'Mesa abierta',
  },
  zh: {
    appTitle: '十三张',
    menuWelcome: '欢迎',
    menuGuest: '可先浏览，连接钱包后可参与真钱玩法。',
    connectWallet: '连接钱包',
    walletConnected: '钱包已连接',
    settings: '设置',
    singlePlayer: '单人模式',
    publicRooms: '公开房间',
    privateRooms: '私人房间',
    settingsHint: '昵称和语言',
    connectHint: '通过 WalletConnect 安全登录',
    settingsTitle: '设置',
    displayName: '昵称',
    language: '语言',
    save: '保存',
    english: '英文',
    spanish: '西班牙文',
    chinese: '中文',
    connectTitle: '连接钱包',
    connectDescription: '使用 WalletConnect 登录后即可加入对局并使用钱包功能。',
    walletAddress: '钱包地址',
    connectNow: '使用 WalletConnect 连接',
    disconnect: '断开连接',
    topUp: '充值',
    refresh: '刷新',
    quoteCashout: '提现报价 (L2)',
    serverConfigMissingTitle: 'WalletConnect 未配置',
    serverConfigMissingBody: '请在环境变量中设置 EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID。',
    authFailed: '认证失败',
    connectRequiredTitle: '连接钱包',
    connectRequiredBody: '加入对局前需要先连接钱包。',
    connectNowAction: '立即连接',
    cancel: '取消',
    backToMenu: '< 菜单',
    yourTurn: '你的回合',
    waitingTurn: '思考中...',
    includeThreeClubs: '首出需包含梅花3',
    tableOpen: '牌桌为空',
  },
} as const;

type TranslationKey = keyof typeof I18N.en;

const MOCK_PUBLIC_ROOMS: MockRoom[] = [
  { id: 'pub1', name: 'Low Stakes #1', stakes: '$1 / $4', players: 2, maxPlayers: 4, status: 'waiting' },
  { id: 'pub2', name: 'Low Stakes #2', stakes: '$1 / $4', players: 4, maxPlayers: 4, status: 'in-progress' },
  { id: 'pub3', name: 'Mid Stakes #1', stakes: '$5 / $20', players: 3, maxPlayers: 4, status: 'waiting' },
  { id: 'pub4', name: 'High Roller', stakes: '$25 / $100', players: 4, maxPlayers: 4, status: 'full' },
  { id: 'pub5', name: 'Beginner Table', stakes: 'Free', players: 1, maxPlayers: 4, status: 'waiting' },
];

const MOCK_PRIVATE_ROOMS: MockRoom[] = [
  { id: 'prv1', name: 'Friends Night', stakes: '$2 / $8', players: 2, maxPlayers: 4, status: 'waiting' },
  { id: 'prv2', name: 'Office League', stakes: '$5 / $20', players: 4, maxPlayers: 4, status: 'in-progress' },
];

const BOT_NAMES = ['Duc', 'Minh', 'Hoa'];

const BOT_QUIPS: Record<Difficulty, string[]> = {
  easy: ['Uh oh...', 'I pass!', 'Good one!', 'Hmm...'],
  medium: ['Nice play.', 'I see you.', 'Interesting...', 'Pass for now.'],
  hard: ['Tactical.', 'Calculated.', "You'll regret that.", 'Well played.'],
};

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function statusColor(status: MockRoom['status']): string {
  if (status === 'waiting') return '#3eb37a';
  if (status === 'in-progress') return '#f1c75d';
  return '#b05050';
}

// â”€â”€â”€ Bot AI â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function allCombosFromHand(cards: Card[]): Card[][] {
  const sorted = sortCards(cards);
  const results: Card[][] = [];

  // singles
  for (const c of sorted) results.push([c]);

  // pairs
  for (let i = 0; i < sorted.length - 1; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      if (sorted[i].rank === sorted[j].rank) results.push([sorted[i], sorted[j]]);
    }
  }

  // triples
  for (let i = 0; i < sorted.length - 2; i++) {
    for (let j = i + 1; j < sorted.length - 1; j++) {
      for (let k = j + 1; k < sorted.length; k++) {
        if (sorted[i].rank === sorted[j].rank && sorted[j].rank === sorted[k].rank)
          results.push([sorted[i], sorted[j], sorted[k]]);
      }
    }
  }

  // bombs (quad)
  for (let i = 0; i < sorted.length - 3; i++) {
    if (
      sorted[i].rank === sorted[i + 1].rank &&
      sorted[i].rank === sorted[i + 2].rank &&
      sorted[i].rank === sorted[i + 3].rank
    ) {
      results.push([sorted[i], sorted[i + 1], sorted[i + 2], sorted[i + 3]]);
    }
  }

  // straights (len 3+)
  for (let len = 3; len <= sorted.length; len++) {
    for (let start = 0; start <= sorted.length - len; start++) {
      const slice = sorted.slice(start, start + len);
      const ranks = slice.map((c) => c.rank);
      if (ranks.includes(15)) continue;
      if (new Set(ranks).size !== ranks.length) continue;
      let consec = true;
      for (let i = 1; i < ranks.length; i++) {
        if (ranks[i] !== ranks[i - 1] + 1) { consec = false; break; }
      }
      if (consec) results.push(slice);
    }
  }

  return results;
}

function botDecide(bot: SPPlayer, tablePlay: SPGame['tablePlay'], mustOpenWithThreeClubs = false): Card[] | null {
  const tableObj: Play | null = tablePlay
    ? { playerId: tablePlay.playerId, cards: tablePlay.cards, type: tablePlay.type, strength: tablePlay.strength }
    : null;

  const valid = allCombosFromHand(bot.hand).filter((combo) => {
    const c = findCombo(combo);
    if (!c) return false;
    if (mustOpenWithThreeClubs && !combo.some((card) => card.rank === 3 && card.suit === 'clubs')) return false;
    return canBeatPlay({ playerId: bot.id, cards: combo, type: c.type, strength: c.strength }, tableObj);
  });

  if (valid.length === 0) return null;

  if (bot.difficulty === 'easy') {
    if (Math.random() < 0.35 && tablePlay !== null) return null;
    return valid[Math.floor(Math.random() * valid.length)];
  }

  const scored = valid.map((c) => {
    const combo = findCombo(c)!;
    return { cards: c, strength: combo.strength };
  });
  scored.sort((a, b) => a.strength - b.strength);

  if (bot.difficulty === 'medium') return scored[0].cards;

  // hard: play lowest strength, but avoid breaking pairs if a single will do
  const rankCounts: Record<number, number> = {};
  for (const card of bot.hand) rankCounts[card.rank] = (rankCounts[card.rank] || 0) + 1;
  const withWaste = scored.map((s) => ({
    ...s,
    waste: s.cards.reduce((acc, card) => acc + (rankCounts[card.rank] > 1 ? 0 : 1), 0),
  }));
  withWaste.sort((a, b) => a.strength - b.strength || a.waste - b.waste);
  return withWaste[0].cards;
}

// â”€â”€â”€ createSPGame â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function createSPGame(humanName: string, difficulty: Difficulty): SPGame {
  const deck = shuffle(makeDeck());
  const players: SPPlayer[] = [
    { id: HUMAN_ID, name: humanName, hand: sortCards(deck.slice(0, 13)), isBot: false, difficulty },
    { id: 'bot1', name: BOT_NAMES[0], hand: sortCards(deck.slice(13, 26)), isBot: true, difficulty },
    { id: 'bot2', name: BOT_NAMES[1], hand: sortCards(deck.slice(26, 39)), isBot: true, difficulty },
    { id: 'bot3', name: BOT_NAMES[2], hand: sortCards(deck.slice(39, 52)), isBot: true, difficulty },
  ];

  let startIndex = 0;
  for (let i = 0; i < players.length; i++) {
    if (players[i].hand.some((c) => c.rank === 3 && c.suit === 'clubs')) {
      startIndex = i;
      break;
    }
  }

  return {
    players,
    turnIndex: startIndex,
    tablePlay: null,
    tableLeaderId: null,
    passes: new Set(),
    winner: null,
    mustOpenWithThreeClubs: true,
  };
}

// â”€â”€â”€ AnimatedCard â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function AnimatedCard({
  card,
  selected,
  onPress,
  suitForCard,
  small = false,
}: {
  card: Card;
  selected: boolean;
  onPress?: () => void;
  suitForCard: (suit: Card['suit']) => string;
  small?: boolean;
}) {
  const fade = useRef(new Animated.Value(0)).current;
  const lift = useRef(new Animated.Value(0)).current;

  function handlePress() {
    if (onPress) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      onPress();
    }
  }

  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 280, useNativeDriver: true }).start();
  }, [fade]);

  useEffect(() => {
    Animated.spring(lift, { toValue: selected ? -14 : 0, friction: 6, useNativeDriver: true }).start();
  }, [selected, lift]);

  const isRed = card.suit === 'diamonds' || card.suit === 'hearts';

  return (
    <Pressable onPress={handlePress} disabled={!onPress}>
      <Animated.View
        style={[
          styles.card,
          small && styles.cardSmall,
          selected && styles.cardSelected,
          { opacity: fade, transform: [{ translateY: lift }] },
        ]}
      >
        <Text style={[styles.cardText, isRed && styles.cardRed, small && styles.cardTextSmall]}>
          {RANK_LABEL[card.rank]}
        </Text>
        <Text style={[styles.cardSuit, isRed && styles.cardRed, small && styles.cardTextSmall]}>
          {suitForCard(card.suit)}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

// â”€â”€â”€ ChatPanel â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function ChatPanel({
  messages,
  inputValue,
  onChangeInput,
  onSend,
  canChat,
}: {
  messages: ChatMessage[];
  inputValue: string;
  onChangeInput: (v: string) => void;
  onSend: () => void;
  canChat: boolean;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (!collapsed) setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
  }, [messages, collapsed]);

  return (
    <View style={styles.chatWrap}>
      <Pressable onPress={() => setCollapsed((c) => !c)} style={styles.chatHeader}>
        <Text style={styles.chatHeaderText}>Chat {messages.length > 0 ? `(${messages.length})` : ''}</Text>
        <Text style={styles.chatToggle}>{collapsed ? '^' : 'v'}</Text>
      </Pressable>
      {!collapsed && (
        <>
          <ScrollView ref={scrollRef} style={styles.chatScroll} contentContainerStyle={{ paddingBottom: 4 }}>
            {messages.length === 0 ? (
              <Text style={styles.chatEmpty}>No messages yet.</Text>
            ) : (
              messages.map((m) => (
                <View key={m.id} style={styles.chatRow}>
                  <Text style={styles.chatSender}>{m.sender}: </Text>
                  <Text style={styles.chatText}>{m.text}</Text>
                </View>
              ))
            )}
          </ScrollView>
          <View style={styles.chatInputRow}>
            <TextInput
              style={styles.chatInput}
              value={inputValue}
              onChangeText={onChangeInput}
              placeholder={canChat ? 'Say something...' : 'Sign in to chat'}
              placeholderTextColor="#7ea6a2"
              editable={canChat}
              returnKeyType="send"
              onSubmitEditing={onSend}
            />
            <Pressable
              style={[styles.chatSendBtn, !canChat && styles.disabledBtn]}
              onPress={onSend}
              disabled={!canChat}
            >
              <Text style={styles.chatSendText}>^</Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

// â”€â”€â”€ RoomList â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function RoomList({
  rooms,
  onAction,
  actionLabel,
  disabled,
}: {
  rooms: MockRoom[];
  onAction: (room: MockRoom) => void;
  actionLabel: string;
  disabled?: boolean;
}) {
  return (
    <>
      {rooms.map((room) => (
        <View key={room.id} style={styles.roomRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.roomName}>{room.name}</Text>
            <Text style={styles.roomSub}>
              {room.stakes} - {room.players}/{room.maxPlayers} players
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 6 }}>
            <View style={[styles.statusBadge, { backgroundColor: statusColor(room.status) }]}>
              <Text style={styles.statusText}>{room.status}</Text>
            </View>
            <Pressable
              style={[styles.roomActionBtn, disabled && styles.disabledBtn]}
              onPress={() => onAction(room)}
            >
              <Text style={styles.roomActionText}>{actionLabel}</Text>
            </Pressable>
          </View>
        </View>
      ))}
    </>
  );
}

// â”€â”€â”€ App â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export default function App() {
  const { width } = useWindowDimensions();

  // â”€â”€ Navigation â”€â”€
  const [screen, setScreen] = useState<Screen>('menu');
  const [language, setLanguage] = useState<Language>('en');
  const isDesktopWeb = Platform.OS === 'web' && width >= 1024;

  // â”€â”€ Auth â”€â”€
  const serverUrl = DEMO_SERVER;
  const [accountLabel, setAccountLabel] = useState('');
  const [displayName, setDisplayName] = useState('Player');
  const [token, setToken] = useState('');
  const [playerId, setPlayerId] = useState('');
  const [balanceCents, setBalanceCents] = useState(0);
  const [authBusy, setAuthBusy] = useState(false);
  const isConnected = !!token;

  const t = useCallback((key: TranslationKey) => I18N[language][key] ?? I18N.en[key], [language]);
  const suitText = useCallback((suit: Card['suit']) => SUIT_TEXT_BY_LANG[language][suit], [language]);

  // â”€â”€ Settings drafts â”€â”€
  const [settingsName, setSettingsName] = useState('Player');
  const [settingsLanguage, setSettingsLanguage] = useState<Language>('en');

  // â”€â”€ Lobby inputs â”€â”€
  const [entryInput, setEntryInput] = useState('100');
  const [wagerInput, setWagerInput] = useState('400');
  const [topupInput, setTopupInput] = useState('5000');
  const [cashoutInput, setCashoutInput] = useState('1000');
  const [privateCodeInput, setPrivateCodeInput] = useState('');

  // â”€â”€ Single player â”€â”€
  const [spDifficulty, setSpDifficulty] = useState<Difficulty>('medium');
  const [spGame, setSpGame] = useState<SPGame | null>(null);
  const [spSelectedIds, setSpSelectedIds] = useState<Set<string>>(new Set());
  const [spChatMessages, setSpChatMessages] = useState<ChatMessage[]>([]);
  const [spChatInput, setSpChatInput] = useState('');
  const spChatIdRef = useRef(0);
  const botTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // â”€â”€ Multiplayer â”€â”€
  const [mpWaitingFor, setMpWaitingFor] = useState(0);
  const [mpRoomPlayers, setMpRoomPlayers] = useState<{ playerId: string; name: string }[]>([]);
  const [mpGameState, setMpGameState] = useState<MPGameState | null>(null);
  const [mpSelectedIds, setMpSelectedIds] = useState<Set<string>>(new Set());
  const [mpChatMessages, setMpChatMessages] = useState<ChatMessage[]>([]);
  const [mpChatInput, setMpChatInput] = useState('');
  const mpChatIdRef = useRef(0);
  const [tablePulse] = useState(new Animated.Value(1));
  const wsRef = useRef<WebSocket | null>(null);
  const sfxTapRef = useRef<Audio.Sound | null>(null);
  const sfxPlayRef = useRef<Audio.Sound | null>(null);
  const sfxWinRef = useRef<Audio.Sound | null>(null);
  const lastSpWinnerRef = useRef<string | null>(null);
  const lastMpWinnerRef = useRef<string | null>(null);

  const playSound = useCallback(async (kind: 'tap' | 'play' | 'win') => {
    try {
      const target = kind === 'tap' ? sfxTapRef.current : kind === 'play' ? sfxPlayRef.current : sfxWinRef.current;
      if (!target) return;
      await target.replayAsync();
    } catch {
      // ignore audio errors on unsupported devices
    }
  }, []);

  // â”€â”€ Derived MP â”€â”€
  const mpMe = useMemo(
    () => mpGameState?.players.find((p) => p.playerId === playerId) || null,
    [mpGameState, playerId],
  );
  const mpMyCards = useMemo(() => sortCards(mpMe?.cards || []), [mpMe?.cards]);
  const mpSelectedCards = useMemo(
    () => sortCards(mpMyCards.filter((c) => mpSelectedIds.has(c.id))),
    [mpMyCards, mpSelectedIds],
  );
  const mpMyTurn = mpGameState?.currentTurnId === playerId;

  // â”€â”€ SP derived â”€â”€
  const spHumanPlayer = spGame?.players.find((p) => p.id === HUMAN_ID) || null;
  const spHumanHand = useMemo(() => sortCards(spHumanPlayer?.hand || []), [spHumanPlayer?.hand]);
  const spCurrentPlayer = spGame ? spGame.players[spGame.turnIndex] : null;
  const spIsHumanTurn = spCurrentPlayer?.id === HUMAN_ID;

  // â”€â”€ Pulse effect on game end â”€â”€
  useEffect(() => {
    if (screen === 'mp_finished') {
      Animated.sequence([
        Animated.timing(tablePulse, { toValue: 1.08, duration: 160, useNativeDriver: true }),
        Animated.timing(tablePulse, { toValue: 1, duration: 160, useNativeDriver: true }),
      ]).start();
    }
  }, [screen, tablePulse]);

  // â”€â”€ Bot turn trigger â”€â”€
  useEffect(() => {
    if (!spGame || spIsHumanTurn || spGame.winner) return;
    if (botTimerRef.current) clearTimeout(botTimerRef.current);
    const delay = 700 + Math.random() * 600;
    botTimerRef.current = setTimeout(() => runBotTurn(), delay);
    return () => {
      if (botTimerRef.current) clearTimeout(botTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spGame?.turnIndex, spGame?.winner]);

  useEffect(() => {
    return () => {
      if (botTimerRef.current) clearTimeout(botTimerRef.current);
    };
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        await Audio.setAudioModeAsync({
          playsInSilentModeIOS: true,
          allowsRecordingIOS: false,
          shouldDuckAndroid: true,
          playThroughEarpieceAndroid: false,
          staysActiveInBackground: false,
        });
        const tap = await Audio.Sound.createAsync(require('./assets/sfx/tap.wav'), { volume: 0.35 });
        const play = await Audio.Sound.createAsync(require('./assets/sfx/play.wav'), { volume: 0.55 });
        const win = await Audio.Sound.createAsync(require('./assets/sfx/win.wav'), { volume: 0.65 });
        if (!active) {
          await tap.sound.unloadAsync();
          await play.sound.unloadAsync();
          await win.sound.unloadAsync();
          return;
        }
        sfxTapRef.current = tap.sound;
        sfxPlayRef.current = play.sound;
        sfxWinRef.current = win.sound;
      } catch {
        // ignore preload failures
      }
    })();

    return () => {
      active = false;
      sfxTapRef.current?.unloadAsync().catch(() => {});
      sfxPlayRef.current?.unloadAsync().catch(() => {});
      sfxWinRef.current?.unloadAsync().catch(() => {});
      sfxTapRef.current = null;
      sfxPlayRef.current = null;
      sfxWinRef.current = null;
    };
  }, []);

  useEffect(() => {
    const winner = spGame?.winner ?? null;
    if (winner && winner !== lastSpWinnerRef.current) {
      playSound('win');
      lastSpWinnerRef.current = winner;
    }
    if (!winner) {
      lastSpWinnerRef.current = null;
    }
  }, [spGame?.winner, playSound]);

  useEffect(() => {
    const winner = mpGameState?.winnerId ?? null;
    if (screen === 'mp_finished' && winner && winner !== lastMpWinnerRef.current) {
      playSound('win');
      lastMpWinnerRef.current = winner;
    }
    if (screen !== 'mp_finished') {
      lastMpWinnerRef.current = null;
    }
  }, [screen, mpGameState?.winnerId, playSound]);

  // â”€â”€â”€ SP Logic â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  function addSpChat(sender: string, text: string) {
    setSpChatMessages((prev) => [
      ...prev,
      { id: String(++spChatIdRef.current), sender, text },
    ]);
  }

  function startSPGame(diff?: Difficulty) {
    const d = diff ?? spDifficulty;
    setSpDifficulty(d);
    const game = createSPGame(displayName, d);
    const firstPlayer = game.players[game.turnIndex];
    setSpGame(game);
    setSpSelectedIds(new Set());
    setSpChatMessages([{ id: String(++spChatIdRef.current), sender: 'System', text: `${firstPlayer.name} goes first (has 3 of clubs). Good luck!` }]);
    setScreen('sp_game');
  }

  const runBotTurn = useCallback(() => {
    setSpGame((prev) => {
      if (!prev || prev.winner) return prev;
      const bot = prev.players[prev.turnIndex];
      if (!bot.isBot) return prev;

      const chosen = botDecide(bot, prev.tablePlay, prev.mustOpenWithThreeClubs);

      if (!chosen || chosen.length === 0) {
        // Pass
        const newPasses = new Set(prev.passes);
        newPasses.add(bot.id);

        const otherIds = prev.players.map((p) => p.id).filter((id) => id !== prev.tableLeaderId);
        const allOthersPassed = !!prev.tableLeaderId && otherIds.every((id) => newPasses.has(id));

        let nextIdx: number;
        let newTablePlay = prev.tablePlay;
        let newLeader = prev.tableLeaderId;
        let finalPasses = newPasses;

        if (allOthersPassed) {
          const leaderIdx = prev.players.findIndex((p) => p.id === prev.tableLeaderId);
          nextIdx = leaderIdx;
          newTablePlay = null;
          newLeader = null;
          finalPasses = new Set();
        } else {
          const ids = prev.players.map((p) => p.id);
          const nextId = nextTurn(ids, bot.id);
          nextIdx = prev.players.findIndex((p) => p.id === nextId);
        }

        const quip = BOT_QUIPS[bot.difficulty][Math.floor(Math.random() * BOT_QUIPS[bot.difficulty].length)];
        setSpChatMessages((msgs) => [
          ...msgs,
          { id: String(++spChatIdRef.current), sender: bot.name, text: `passes. ${quip}` },
        ]);

        return {
          ...prev,
          turnIndex: nextIdx,
          tablePlay: newTablePlay,
          tableLeaderId: newLeader,
          passes: finalPasses,
        };
      }

      // Play cards
      const combo = findCombo(chosen)!;
      const newHand = removeCards(bot.hand, chosen);
      const newPlayers = prev.players.map((p) =>
        p.id === bot.id ? { ...p, hand: newHand } : p,
      );

      const winner = newHand.length === 0 ? bot.id : null;
      const ids = newPlayers.map((p) => p.id);
      const nextId = nextTurn(ids, bot.id);
      const nextIdx = newPlayers.findIndex((p) => p.id === nextId);

      const label = chosen.map((c) => `${RANK_LABEL[c.rank]}${suitText(c.suit)}`).join(' ');
      setSpChatMessages((msgs) => [
        ...msgs,
        { id: String(++spChatIdRef.current), sender: bot.name, text: `plays ${combo.type}: ${label}` },
      ]);
      playSound('play');

      return {
        ...prev,
        players: newPlayers,
        turnIndex: nextIdx,
        tablePlay: { playerId: bot.id, cards: chosen, type: combo.type, strength: combo.strength },
        tableLeaderId: bot.id,
        passes: new Set(),
        winner,
        mustOpenWithThreeClubs: false,
      };
    });
  }, []);

  function spToggleCard(cardId: string) {
    if (!spIsHumanTurn || spGame?.winner) return;
    playSound('tap');
    setSpSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(cardId)) next.delete(cardId); else next.add(cardId);
      return next;
    });
  }

  function spPlaySelected() {
    const selectedIds = spSelectedIds;
    setSpGame((prev) => {
      if (!prev || prev.winner) return prev;
      const humanPlayer = prev.players.find((p) => p.id === HUMAN_ID);
      if (!humanPlayer || prev.players[prev.turnIndex].id !== HUMAN_ID) return prev;

      const selected = sortCards(humanPlayer.hand.filter((c) => selectedIds.has(c.id)));
      if (selected.length === 0) {
        Alert.alert('Select cards', 'Tap cards to select them first.');
        return prev;
      }

      const combo = findCombo(selected);
      if (!combo) {
        Alert.alert('Invalid', 'Not a valid Tien Len combination.');
        return prev;
      }

      if (prev.mustOpenWithThreeClubs && !selected.some((c) => c.rank === 3 && c.suit === 'clubs')) {
        Alert.alert('Must include 3\u2663', 'First play must include the 3 of clubs.');
        return prev;
      }

      const tableObj: Play | null = prev.tablePlay
        ? { playerId: prev.tablePlay.playerId, cards: prev.tablePlay.cards, type: prev.tablePlay.type, strength: prev.tablePlay.strength }
        : null;
      const humanPlay: Play = { playerId: HUMAN_ID, cards: selected, type: combo.type, strength: combo.strength };

      if (!canBeatPlay(humanPlay, tableObj)) {
        Alert.alert("Can't beat", "Your combo doesn't beat what's on the table.");
        return prev;
      }

      const newHand = removeCards(humanPlayer.hand, selected);
      const newPlayers = prev.players.map((p) => p.id === HUMAN_ID ? { ...p, hand: newHand } : p);
      const winner = newHand.length === 0 ? HUMAN_ID : null;
      const ids = newPlayers.map((p) => p.id);
      const nextId = nextTurn(ids, HUMAN_ID);
      const nextIdx = newPlayers.findIndex((p) => p.id === nextId);

      const label = selected.map((c) => `${RANK_LABEL[c.rank]}${suitText(c.suit)}`).join(' ');
      setSpChatMessages((msgs) => [
        ...msgs,
        { id: String(++spChatIdRef.current), sender: displayName, text: `plays ${combo.type}: ${label}` },
      ]);
      playSound('play');

      return {
        ...prev,
        players: newPlayers,
        turnIndex: nextIdx,
        tablePlay: { playerId: HUMAN_ID, cards: selected, type: combo.type, strength: combo.strength },
        tableLeaderId: HUMAN_ID,
        passes: new Set(),
        winner,
        mustOpenWithThreeClubs: false,
      };
    });
    setSpSelectedIds(new Set());
  }

  function spPass() {
    setSpGame((prev) => {
      if (!prev || prev.winner) return prev;
      if (prev.players[prev.turnIndex].id !== HUMAN_ID) return prev;
      if (!prev.tablePlay) {
        Alert.alert("Can't pass", 'You must open the table \u2014 make a play first.');
        return prev;
      }

      const newPasses = new Set(prev.passes);
      newPasses.add(HUMAN_ID);

      const otherIds = prev.players.map((p) => p.id).filter((id) => id !== prev.tableLeaderId);
      const allOthersPassed = !!prev.tableLeaderId && otherIds.every((id) => newPasses.has(id));

      let nextIdx: number;
      let newTablePlay: SPGame['tablePlay'] = prev.tablePlay;
      let newLeader: string | null = prev.tableLeaderId;
      let finalPasses: Set<string> = newPasses;

      if (allOthersPassed) {
        const leaderIdx = prev.players.findIndex((p) => p.id === prev.tableLeaderId);
        nextIdx = leaderIdx;
        newTablePlay = null;
        newLeader = null;
        finalPasses = new Set();
      } else {
        const ids = prev.players.map((p) => p.id);
        const nextId = nextTurn(ids, HUMAN_ID);
        nextIdx = prev.players.findIndex((p) => p.id === nextId);
      }

      setSpChatMessages((msgs) => [
        ...msgs,
        { id: String(++spChatIdRef.current), sender: displayName, text: 'passes.' },
      ]);

      return { ...prev, turnIndex: nextIdx, tablePlay: newTablePlay, tableLeaderId: newLeader, passes: finalPasses };
    });
    setSpSelectedIds(new Set());
  }

  function sendSpChat() {
    const text = spChatInput.trim();
    if (!text) return;
    setSpChatMessages((prev) => [
      ...prev,
      { id: String(++spChatIdRef.current), sender: displayName, text },
    ]);
    setSpChatInput('');
  }

  function requireWallet(): boolean {
    if (!isConnected) {
      Alert.alert(t('connectRequiredTitle'), t('connectRequiredBody'), [
        { text: t('connectNowAction'), onPress: () => setScreen('connect') },
        { text: t('cancel'), style: 'cancel' },
      ]);
      return false;
    }
    return true;
  }

  function extractTokensFromUrl(url: string): { accessToken: string; refreshToken: string } | null {
    const hash = (url.split('#')[1] || '').trim();
    if (!hash) return null;
    const params = new URLSearchParams(hash);
    const accessToken = params.get('access_token') || '';
    const refreshToken = params.get('refresh_token') || '';
    if (!accessToken || !refreshToken) return null;
    return { accessToken, refreshToken };
  }

  async function syncAuthSession() {
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    if (!session) {
      setToken('');
      setPlayerId('');
      setBalanceCents(0);
      setAccountLabel('');
      if (wsRef.current) wsRef.current.close();
      return;
    }

    setToken(session.access_token);
    setAccountLabel(session.user.email || session.user.id);
    openSocket(session.access_token);

    const me = await fetch(`${serverUrl.trim()}/auth/me`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const payload = await me.json();
    if (me.ok) {
      setPlayerId(payload.userId || '');
      setBalanceCents(payload.balanceCents || 0);
      if (payload.displayName) {
        setDisplayName(payload.displayName);
      }
    }
  }

  async function beginSupabaseLogin() {
    setAuthBusy(true);
    try {
      const redirectTo =
        Platform.OS === 'web'
          ? (globalThis as unknown as { location?: { origin?: string } }).location?.origin
          : SUPABASE_REDIRECT_URI;

      if (Platform.OS === 'web') {
        const { error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo,
            skipBrowserRedirect: false,
            queryParams: { prompt: 'consent' },
          },
        });
        if (error) throw error;
        return;
      }

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
          skipBrowserRedirect: true,
          queryParams: { prompt: 'consent' },
        },
      });
      if (error || !data?.url) {
        throw error || new Error('missing_oauth_url');
      }

      const result = await WebBrowser.openAuthSessionAsync(data.url, SUPABASE_REDIRECT_URI);
      if (result.type !== 'success') {
        throw new Error('oauth_cancelled');
      }

      const tokens = extractTokensFromUrl(result.url);
      if (!tokens) {
        throw new Error('oauth_missing_tokens');
      }

      const { error: setSessionError } = await supabase.auth.setSession({
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
      });
      if (setSessionError) throw setSessionError;
      await syncAuthSession();
      setScreen('menu');
    } catch (err) {
      Alert.alert(t('authFailed'), String(err));
    } finally {
      setAuthBusy(false);
    }
  }

  useEffect(() => {
    WebBrowser.maybeCompleteAuthSession();
    syncAuthSession();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      syncAuthSession();
    });
    return () => {
      subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openSocket(authToken: string) {
    if (wsRef.current) wsRef.current.close();
    const wsUrl = `${serverUrl.trim().replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(authToken)}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string);
        if (msg.type === 'room_waiting') {
          setMpWaitingFor(msg.waitingFor || 0);
          setMpRoomPlayers((msg.players || []).map((p: { playerId: string; name: string }) => ({ playerId: p.playerId, name: p.name })));
          setScreen('mp_waiting');
        } else if (msg.type === 'table_state') {
          const normalized: MPGameState = {
            type: 'game_state',
            roomId: msg.tableId,
            started: !!msg.started,
            finished: !!msg.finished,
            winnerId: msg.winnerId || null,
            potCents: Number(msg.potCents || 0),
            tablePlay: msg.tablePlay
              ? {
                  playerId: msg.tablePlay.playerId,
                  cards: msg.tablePlay.cards || [],
                  type: msg.tablePlay.type,
                  strength: msg.tablePlay.strength,
                }
              : null,
            tableLeaderId: msg.tableLeaderId || null,
            currentTurnId: msg.currentTurnId || null,
            mustOpenWithThreeClubs: !!msg.mustOpenWithThreeClubs,
            passes: Array.isArray(msg.passes) ? msg.passes : [],
            players: (msg.players || []).map((p: any) => ({
              playerId: p.userId,
              name: p.name,
              wallet: p.userId,
              cardsCount: p.cardsCount,
              cards: p.cards || [],
              entryCents: p.paidEntryCents || 0,
              wagerCents: p.paidWagerCents || 0,
              stakeCents: p.stakeCents || 0,
              balanceCents: p.balanceCents || 0,
            })),
            payout: null,
          };
          setMpGameState(normalized);
          setMpWaitingFor(Math.max(0, 4 - normalized.players.length));
          setMpRoomPlayers(normalized.players.map((p) => ({ playerId: p.playerId, name: p.name })));
          setScreen(normalized.started ? (normalized.finished ? 'mp_finished' : 'mp_playing') : 'mp_waiting');
        } else if (msg.type === 'game_state') {
          setMpGameState(msg as MPGameState);
          setMpWaitingFor(0);
          setMpRoomPlayers([]);
          setScreen(msg.finished ? 'mp_finished' : 'mp_playing');
          if (msg.finished) setMpSelectedIds(new Set());
        } else if (msg.type === 'chat') {
          setMpChatMessages((prev) => [
            ...prev,
            { id: String(++mpChatIdRef.current), sender: msg.sender || '?', text: msg.text || '' },
          ]);
        } else if (msg.type === 'error') {
          Alert.alert('Server', msg.code || msg.message || 'unknown_error');
        }
      } catch (_) {
        // ignore parse errors
      }
    };
    ws.onclose = () => { wsRef.current = null; };
  }

  function sendMpChat() {
    const text = mpChatInput.trim();
    if (!text || !wsRef.current || wsRef.current.readyState !== 1 || !mpGameState?.roomId) return;
    wsRef.current.send(JSON.stringify({ type: 'chat', tableId: mpGameState.roomId, text }));
    setMpChatMessages((prev) => [
      ...prev,
      { id: String(++mpChatIdRef.current), sender: displayName, text },
    ]);
    setMpChatInput('');
  }

  async function refreshBalance() {
    if (!token) return;
    const res = await fetch(`${serverUrl.trim()}/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (res.ok) setBalanceCents(data.balanceCents || 0);
  }

  async function depositMock() {
    const amount = Number(topupInput);
    if (!Number.isInteger(amount) || amount <= 0) { Alert.alert('Top up', 'Enter positive integer cents.'); return; }
    const res = await fetch(`${serverUrl.trim()}/wallet/deposit/mock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ amountCents: amount }),
    });
    const data = await res.json();
    if (!res.ok) { Alert.alert('Top up failed', data.error || 'failed'); return; }
    setBalanceCents(data.balanceCents || 0);
  }

  async function quoteAndCashout() {
    Alert.alert('Cashout', 'Cashout API is disabled in this Supabase build.');
  }

  function joinMpMatch() {
    const entry = Number(entryInput);
    const wager = Number(wagerInput);
    if (!Number.isInteger(entry) || !Number.isInteger(wager) || entry < 0 || wager < 0) {
      Alert.alert('Stake', 'Entry and wager must be integer cents.');
      return;
    }
    if (entry > 0 && wager < entry * 2) {
      Alert.alert('Stake', 'Wager must be at least 2x the entry fee for paid tables.');
      return;
    }
    if (!wsRef.current || wsRef.current.readyState !== 1) {
      Alert.alert('Connection', 'Socket not connected. Reconnect your session.');
      return;
    }
    setMpChatMessages([]);
    wsRef.current.send(
      JSON.stringify({
        type: 'join_room',
        displayName,
        entryCents: entry,
        wagerCents: wager,
        private: screen === 'privaterooms',
        roomCode: privateCodeInput.trim() || undefined,
      }),
    );
  }

  function mpToggleCard(cardId: string) {
    if (!mpMyTurn) return;
    playSound('tap');
    setMpSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(cardId)) next.delete(cardId); else next.add(cardId);
      return next;
    });
  }

  function mpPlaySelected() {
    if (!mpMyTurn || !wsRef.current || wsRef.current.readyState !== 1) return;
    if (mpSelectedCards.length === 0) { Alert.alert('Play', 'Select cards first.'); return; }
    if (!findCombo(mpSelectedCards)) { Alert.alert('Play', 'Invalid combo.'); return; }
    wsRef.current.send(JSON.stringify({ type: 'play', tableId: mpGameState?.roomId, cardIds: mpSelectedCards.map((c) => c.id) }));
    setMpSelectedIds(new Set());
    playSound('play');
  }

  function mpPass() {
    if (!mpMyTurn || !wsRef.current || wsRef.current.readyState !== 1) return;
    wsRef.current.send(JSON.stringify({ type: 'pass', tableId: mpGameState?.roomId }));
  }

  function mpAddToPot() {
    const amount = Number(cashoutInput);
    if (!Number.isInteger(amount) || amount <= 0) {
      Alert.alert('Pot', 'Enter a positive cents amount in cashout field.');
      return;
    }
    if (!wsRef.current || wsRef.current.readyState !== 1 || !mpGameState?.roomId) return;
    wsRef.current.send(JSON.stringify({ type: 'add_to_pot', tableId: mpGameState.roomId, amountCents: amount }));
  }

  function mpSwitchToSpectator() {
    if (!wsRef.current || wsRef.current.readyState !== 1 || !mpGameState?.roomId) return;
    wsRef.current.send(JSON.stringify({ type: 'switch_to_spectator', tableId: mpGameState.roomId }));
  }

  function goBack() { setScreen('menu'); }

  // â”€â”€â”€ Render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  return (
    <LinearGradient colors={['#093028', '#237a57']} style={styles.gradient}>
      <SafeAreaView style={styles.safe}>
        <StatusBar style="light" />
        <View style={[styles.pageShell, isDesktopWeb && styles.pageShellDesktop]}>

        {/* â”€â”€ Header â”€â”€ */}
        <View style={styles.headerRow}>
          {screen !== 'menu' && screen !== 'sp_game' && screen !== 'mp_playing' && screen !== 'mp_finished' && (
            <Pressable onPress={goBack} style={styles.backBtn}>
              <Text style={styles.backText}>{t('backToMenu')}</Text>
            </Pressable>
          )}
          <Text style={styles.headerTitle}>{t('appTitle')}</Text>
          {isConnected ? (
            <Pressable onPress={() => setScreen('connect')}>
              <Text style={styles.balancePill}>{money(balanceCents)}</Text>
            </Pressable>
          ) : (
            <Pressable onPress={() => setScreen('connect')} style={styles.connectPill}>
              <Text style={styles.connectPillText}>{t('connectWallet')}</Text>
            </Pressable>
          )}
        </View>

        {/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
            MENU
        â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
        {screen === 'menu' && (
          <View style={styles.menuContainer}>
            <Text style={styles.menuHeadline}>
              {isConnected ? `${t('menuWelcome')}, ${displayName}` : t('menuWelcome')}
            </Text>
            {!isConnected && (
              <View style={styles.guestBanner}>
                <Text style={styles.guestText}>{t('menuGuest')}</Text>
              </View>
            )}
            <View style={[styles.menuList, isDesktopWeb && styles.menuListDesktop]}>
              <Pressable style={[styles.menuBtn, isDesktopWeb && styles.menuBtnDesktop]} onPress={() => setScreen('connect')}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.menuBtnTitle}>{isConnected ? t('walletConnected') : t('connectWallet')}</Text>
                  <Text style={styles.menuBtnSub}>{isConnected ? `${accountLabel.slice(0, 12)}...  ${money(balanceCents)}` : t('connectHint')}</Text>
                </View>
              </Pressable>

              <Pressable style={[styles.menuBtn, isDesktopWeb && styles.menuBtnDesktop]} onPress={() => { setSettingsName(displayName); setSettingsLanguage(language); setScreen('settings'); }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.menuBtnTitle}>{t('settings')}</Text>
                  <Text style={styles.menuBtnSub}>{t('settingsHint')}</Text>
                </View>
              </Pressable>

              <Pressable style={[styles.menuBtn, isDesktopWeb && styles.menuBtnDesktop]} onPress={() => setScreen('sp_lobby')}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.menuBtnTitle}>{t('singlePlayer')}</Text>
                  <Text style={styles.menuBtnSub}>Practice vs computer bots (free)</Text>
                </View>
              </Pressable>

              <Pressable style={[styles.menuBtn, isDesktopWeb && styles.menuBtnDesktop]} onPress={() => setScreen('publicrooms')}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.menuBtnTitle}>{t('publicRooms')}</Text>
                  <Text style={styles.menuBtnSub}>Browse open wager matches</Text>
                </View>
              </Pressable>

              <Pressable style={[styles.menuBtn, isDesktopWeb && styles.menuBtnDesktop]} onPress={() => setScreen('privaterooms')}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.menuBtnTitle}>{t('privateRooms')}</Text>
                  <Text style={styles.menuBtnSub}>Join by code or create your own</Text>
                </View>
              </Pressable>
            </View>
          </View>
        )}

        {/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
            CONNECT WALLET
        â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
        {screen === 'connect' && (
          <ScrollView style={styles.flex1} contentContainerStyle={styles.scrollContent}>
            <View style={[styles.webPanelWrap, isDesktopWeb && styles.webPanelWrapDesktop]}>
            <Text style={styles.panelTitle}>{isConnected ? t('walletConnected') : t('connectTitle')}</Text>
            {isConnected ? (
              <View style={styles.formPanel}>
                <Text style={styles.bodyText}>Connected as: {displayName}</Text>
                <Text style={styles.bodyText}>Account: {accountLabel}</Text>
                <Text style={styles.bodyText}>Balance: {money(balanceCents)}</Text>

                <Text style={styles.label}>Mock top up (cents)</Text>
                <TextInput value={topupInput} onChangeText={setTopupInput} style={styles.input} keyboardType="number-pad" placeholderTextColor="#7ea6a2" placeholder="5000" />
                <View style={styles.buttonRow}>
                  <Pressable style={[styles.btnGold, { flex: 1 }]} onPress={depositMock}><Text style={styles.btnDarkText}>Top Up</Text></Pressable>
                  <Pressable style={[styles.btnGreen, { flex: 1 }]} onPress={refreshBalance}><Text style={styles.btnDarkText}>Refresh</Text></Pressable>
                </View>

                <Text style={styles.label}>Cashout (cents)</Text>
                <TextInput value={cashoutInput} onChangeText={setCashoutInput} style={styles.input} keyboardType="number-pad" placeholderTextColor="#7ea6a2" placeholder="1000" />
                <Pressable style={styles.btnGreen} onPress={quoteAndCashout}><Text style={styles.btnDarkText}>{t('quoteCashout')}</Text></Pressable>

                <Pressable style={[styles.btnGreen, { marginTop: 16 }]} onPress={() => {
                  supabase.auth.signOut().catch(() => {});
                  setToken(''); setPlayerId(''); setAccountLabel(''); setScreen('menu');
                  if (wsRef.current) wsRef.current.close();
                }}>
                  <Text style={styles.btnDarkText}>{t('disconnect')}</Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.formPanel}>
                <Text style={styles.bodyText}>{t('connectDescription')}</Text>
                <Text style={styles.label}>{t('displayName')}</Text>
                <TextInput value={displayName} onChangeText={setDisplayName} style={styles.input} autoCapitalize="none" placeholder="Player" placeholderTextColor="#7ea6a2" />
                <Pressable style={[styles.btnGold, authBusy && styles.disabledBtn]} onPress={beginSupabaseLogin} disabled={authBusy}>
                  <Text style={styles.btnDarkText}>{authBusy ? 'Connecting...' : 'Sign in with Google'}</Text>
                </Pressable>
              </View>
            )}
            </View>
          </ScrollView>
        )}

        {/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
            SETTINGS
        â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
        {screen === 'settings' && (
          <View style={[styles.formPanel, styles.webPanelWrap, isDesktopWeb && styles.webPanelWrapDesktop]}>
            <Text style={styles.panelTitle}>{t('settingsTitle')}</Text>
            <Text style={styles.label}>{t('displayName')}</Text>
            <TextInput value={settingsName} onChangeText={setSettingsName} style={styles.input} autoCapitalize="none" placeholder="Player" placeholderTextColor="#7ea6a2" />
            <Text style={styles.label}>{t('language')}</Text>
            <View style={styles.buttonRow}>
              {(['en', 'es', 'zh'] as Language[]).map((lng) => (
                <Pressable
                  key={lng}
                  style={[styles.diffBtn, settingsLanguage === lng && styles.diffBtnActive, { flex: 1 }]}
                  onPress={() => setSettingsLanguage(lng)}
                >
                  <Text style={[styles.diffBtnText, settingsLanguage === lng && styles.diffBtnTextActive]}>
                    {lng === 'en' ? t('english') : lng === 'es' ? t('spanish') : t('chinese')}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Pressable style={styles.btnGold} onPress={() => { setDisplayName(settingsName); setLanguage(settingsLanguage); setScreen('menu'); }}>
              <Text style={styles.btnDarkText}>{t('save')}</Text>
            </Pressable>
          </View>
        )}

        {/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
            SINGLE PLAYER â€” LOBBY
        â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
        {screen === 'sp_lobby' && (
          <View style={[styles.flex1, styles.webPanelWrap, isDesktopWeb && styles.webPanelWrapDesktop]}>
            <Text style={styles.panelTitle}>Single Player</Text>
            <Text style={styles.bodyText}>
              Play Tien Len against 3 computer opponents. Bots take turns automatically.
            </Text>

            <ScrollView style={styles.flex1}>
              <RoomList
                rooms={[
                  { id: 'sp_easy', name: 'Easy Bot Table', stakes: 'Free', players: 1, maxPlayers: 4, status: 'waiting' },
                  { id: 'sp_med', name: 'Medium Bot Table', stakes: 'Free', players: 1, maxPlayers: 4, status: 'waiting' },
                  { id: 'sp_hard', name: 'Hard Bot Table', stakes: 'Free', players: 1, maxPlayers: 4, status: 'waiting' },
                ]}
                onAction={(room) => {
                  const diff: Difficulty = room.id === 'sp_easy' ? 'easy' : room.id === 'sp_med' ? 'medium' : 'hard';
                  startSPGame(diff);
                }}
                actionLabel="Play"
              />
            </ScrollView>
          </View>
        )}

        {/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
            SINGLE PLAYER â€” GAME
        â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
        {screen === 'sp_game' && spGame && (
          <KeyboardAvoidingView style={styles.flex1} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>

            {/* Opponents row */}
            <View style={styles.opponentsRow}>
              {spGame.players
                .filter((p) => p.id !== HUMAN_ID)
                .map((p) => (
                  <View
                    key={p.id}
                    style={[
                      styles.opponentBadge,
                      spCurrentPlayer?.id === p.id && styles.opponentBadgeActive,
                      spGame.winner === p.id && styles.opponentBadgeWinner,
                    ]}
                  >
                    <Text style={styles.opponentName}>{p.name}</Text>
                    <Text style={styles.opponentSub}>Cards {p.hand.length}</Text>
                    {spGame.winner === p.id && <Text style={styles.winnerTag}>WIN</Text>}
                  </View>
                ))}
            </View>

            {/* Table */}
            <View style={styles.tableArea}>
              <Text style={styles.tableLabel}>
                {spGame.tablePlay
                  ? `${spGame.players.find((p) => p.id === spGame.tablePlay?.playerId)?.name} - ${spGame.tablePlay.type}`
                  : t('tableOpen')}
              </Text>
              {spGame.mustOpenWithThreeClubs && !spGame.tablePlay && (
                <Text style={styles.mustOpenHint}>{t('includeThreeClubs')}</Text>
              )}
              <View style={styles.tableCardsRow}>
                {spGame.tablePlay?.cards.map((card) => (
                  <AnimatedCard key={`t-${card.id}`} card={card} selected={false} suitForCard={suitText} small />
                ))}
              </View>
            </View>

            {/* Win banner */}
            {spGame.winner && (
              <View style={styles.winBanner}>
                <Text style={styles.winBannerText}>
                  {spGame.winner === HUMAN_ID
                    ? 'You win!'
                    : `${spGame.players.find((p) => p.id === spGame.winner)?.name} wins!`}
                </Text>
                <View style={styles.buttonRow}>
                  <Pressable style={[styles.btnGold, { flex: 1 }]} onPress={() => startSPGame()}>
                    <Text style={styles.btnDarkText}>Play Again</Text>
                  </Pressable>
                  <Pressable style={[styles.btnGreen, { flex: 1 }]} onPress={() => { setSpGame(null); setScreen('sp_lobby'); }}>
                    <Text style={styles.btnDarkText}>Lobby</Text>
                  </Pressable>
                </View>
              </View>
            )}

            {/* Human hand + controls */}
            {!spGame.winner && (
              <View style={styles.playerArea}>
                <Text style={styles.turnText}>
                  {spIsHumanTurn ? `> ${t('yourTurn')}` : `${t('waitingTurn')} ${spCurrentPlayer?.name}`}
                  {spIsHumanTurn && spGame.mustOpenWithThreeClubs ? ` (${t('includeThreeClubs')})` : ''}
                </Text>
                <FlatList
                  data={spHumanHand}
                  keyExtractor={(item) => item.id}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.handList}
                  renderItem={({ item }) => (
                    <View style={styles.cardSpacing}>
                      <AnimatedCard
                        card={item}
                        selected={spSelectedIds.has(item.id)}
                        onPress={() => spToggleCard(item.id)}
                        suitForCard={suitText}
                      />
                    </View>
                  )}
                />
                <View style={styles.buttonRow}>
                  <Pressable
                    style={[styles.btnGold, !spIsHumanTurn && styles.disabledBtn, { flex: 1 }]}
                    onPress={spPlaySelected}
                    disabled={!spIsHumanTurn}
                  >
                    <Text style={styles.btnDarkText}>Play</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.btnGreen, (!spIsHumanTurn || !spGame.tablePlay) && styles.disabledBtn, { flex: 1 }]}
                    onPress={spPass}
                    disabled={!spIsHumanTurn || !spGame.tablePlay}
                  >
                    <Text style={styles.btnDarkText}>Pass</Text>
                  </Pressable>
                  <Pressable
                    style={styles.btnQuit}
                    onPress={() => { if (botTimerRef.current) clearTimeout(botTimerRef.current); setSpGame(null); setScreen('menu'); }}
                  >
                    <Text style={styles.btnDarkText}>X</Text>
                  </Pressable>
                </View>
              </View>
            )}

            {/* In-game chat */}
            <ChatPanel
              messages={spChatMessages}
              inputValue={spChatInput}
              onChangeInput={setSpChatInput}
              onSend={sendSpChat}
              canChat
            />
          </KeyboardAvoidingView>
        )}

        {/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
            PUBLIC ROOMS
        â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
        {screen === 'publicrooms' && (
          <View style={[styles.flex1, styles.webPanelWrap, isDesktopWeb && styles.webPanelWrapDesktop]}>
            <Text style={styles.panelTitle}>Public Rooms</Text>
            {!isConnected && (
              <View style={styles.guestBanner}>
                <Text style={styles.guestText}>Sign in to join. Browsing only.</Text>
              </View>
            )}
            {isConnected && (
              <View style={[styles.formPanel, { marginBottom: 10 }]}>
                <View style={styles.buttonRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.label}>Entry (Â¢)</Text>
                    <TextInput value={entryInput} onChangeText={setEntryInput} style={styles.input} keyboardType="number-pad" placeholderTextColor="#7ea6a2" placeholder="100" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.label}>Wager (Â¢)</Text>
                    <TextInput value={wagerInput} onChangeText={setWagerInput} style={styles.input} keyboardType="number-pad" placeholderTextColor="#7ea6a2" placeholder="400" />
                  </View>
                </View>
                <Pressable style={styles.btnGold} onPress={joinMpMatch}>
                  <Text style={styles.btnDarkText}>Join / Create Public Match</Text>
                </Pressable>
              </View>
            )}
            <ScrollView style={styles.flex1}>
              <RoomList
                rooms={MOCK_PUBLIC_ROOMS}
                onAction={() => { if (!requireWallet()) return; joinMpMatch(); }}
                actionLabel={isConnected ? 'Join' : 'View'}
                disabled={!isConnected}
              />
            </ScrollView>
          </View>
        )}

        {/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
            PRIVATE ROOMS
        â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
        {screen === 'privaterooms' && (
          <View style={[styles.flex1, styles.webPanelWrap, isDesktopWeb && styles.webPanelWrapDesktop]}>
            <Text style={styles.panelTitle}>Private Rooms</Text>
            {!isConnected && (
              <View style={styles.guestBanner}>
                <Text style={styles.guestText}>Sign in to create or join. Browsing only.</Text>
              </View>
            )}
            {isConnected && (
              <View style={[styles.formPanel, { marginBottom: 10 }]}>
                <Text style={styles.label}>Room code (blank = create)</Text>
                <TextInput value={privateCodeInput} onChangeText={setPrivateCodeInput} style={styles.input} autoCapitalize="none" placeholder="e.g. FRIENDS42" placeholderTextColor="#7ea6a2" />
                <View style={styles.buttonRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.label}>Entry (Â¢)</Text>
                    <TextInput value={entryInput} onChangeText={setEntryInput} style={styles.input} keyboardType="number-pad" placeholderTextColor="#7ea6a2" placeholder="100" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.label}>Wager (Â¢)</Text>
                    <TextInput value={wagerInput} onChangeText={setWagerInput} style={styles.input} keyboardType="number-pad" placeholderTextColor="#7ea6a2" placeholder="400" />
                  </View>
                </View>
                <Pressable style={styles.btnGold} onPress={joinMpMatch}>
                  <Text style={styles.btnDarkText}>{privateCodeInput ? 'Join Private Room' : 'Create Private Room'}</Text>
                </Pressable>
              </View>
            )}
            <ScrollView style={styles.flex1}>
              <RoomList
                rooms={MOCK_PRIVATE_ROOMS}
                onAction={() => { if (!requireWallet()) return; joinMpMatch(); }}
                actionLabel={isConnected ? 'Join' : 'View'}
                disabled={!isConnected}
              />
            </ScrollView>
          </View>
        )}

        {/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
            MP â€” WAITING
        â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
        {screen === 'mp_waiting' && (
          <KeyboardAvoidingView style={[styles.flex1, styles.webPanelWrap, isDesktopWeb && styles.webPanelWrapDesktop]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <Text style={styles.panelTitle}>Waiting for playersâ€¦</Text>
            <View style={styles.formPanel}>
              <Text style={styles.bodyText}>Need {mpWaitingFor} more player(s)</Text>
              {mpRoomPlayers.map((p) => (
                <Text key={p.playerId} style={styles.ruleCallout}>Â· {p.name}</Text>
              ))}
            </View>
            <View style={{ flex: 1 }} />
            <ChatPanel messages={mpChatMessages} inputValue={mpChatInput} onChangeInput={setMpChatInput} onSend={sendMpChat} canChat={isConnected} />
          </KeyboardAvoidingView>
        )}

        {/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
            MP â€” PLAYING / FINISHED
        â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
        {(screen === 'mp_playing' || screen === 'mp_finished') && mpGameState && (
          <KeyboardAvoidingView
            style={[styles.flex1, styles.webPanelWrap, isDesktopWeb && styles.webPanelWrapDesktop]}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            {/* Opponents */}
            <View style={styles.opponentsRow}>
              {mpGameState.players
                .filter((p) => p.playerId !== playerId)
                .map((p) => (
                  <View
                    key={p.playerId}
                    style={[styles.opponentBadge, mpGameState.currentTurnId === p.playerId && styles.opponentBadgeActive]}
                  >
                    <Text style={styles.opponentName}>{p.name}</Text>
                    <Text style={styles.opponentSub}>Cards {p.cardsCount}</Text>
                    <Text style={styles.opponentSub}>{money(p.stakeCents)}</Text>
                  </View>
                ))}
            </View>

            {/* Table */}
            <Animated.View style={[styles.tableArea, { transform: [{ scale: tablePulse }] }]}>
              <Text style={styles.tableLabel}>
                {mpGameState.tablePlay
                  ? `${mpGameState.players.find((p) => p.playerId === mpGameState.tablePlay?.playerId)?.name} - ${mpGameState.tablePlay.type}`
                  : t('tableOpen')}
              </Text>
              <Text style={styles.tablePot}>Pot: {money(mpGameState.potCents)}</Text>
              <View style={styles.tableCardsRow}>
                {mpGameState.tablePlay?.cards.map((card) => (
                  <AnimatedCard key={`mp-t-${card.id}`} card={card} selected={false} suitForCard={suitText} small />
                ))}
              </View>
            </Animated.View>

            {/* Finished payout */}
            {screen === 'mp_finished' && mpGameState.payout && (
              <View style={[styles.formPanel, { marginBottom: 8 }]}>
                <Text style={styles.panelTitle}>
                  {mpGameState.players.find((p) => p.playerId === mpGameState.winnerId)?.name} wins!
                </Text>
                <Text style={styles.bodyText}>Payout: {money(mpGameState.payout.winnerPayoutCents)}</Text>
                <Text style={styles.ruleCallout}>Ledger settled instantly. Cashout via blockchain optional.</Text>
                <Pressable style={styles.btnGold} onPress={() => { setScreen('menu'); setMpGameState(null); setMpSelectedIds(new Set()); refreshBalance(); }}>
                  <Text style={styles.btnDarkText}>Back to Menu</Text>
                </Pressable>
              </View>
            )}

            {/* Player hand */}
            {screen === 'mp_playing' && (
              <View style={styles.playerArea}>
                <Text style={styles.turnText}>
                  {mpMyTurn
                    ? `> ${t('yourTurn')}${mpGameState.mustOpenWithThreeClubs ? ` (${t('includeThreeClubs')})` : ''}`
                    : `${t('waitingTurn')} ${mpGameState.players.find((p) => p.playerId === mpGameState.currentTurnId)?.name}`}
                </Text>
                <FlatList
                  data={mpMyCards}
                  keyExtractor={(item) => item.id}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.handList}
                  renderItem={({ item }) => (
                    <View style={styles.cardSpacing}>
                      <AnimatedCard card={item} selected={mpSelectedIds.has(item.id)} onPress={() => mpToggleCard(item.id)} suitForCard={suitText} />
                    </View>
                  )}
                />
                <View style={styles.buttonRow}>
                  <Pressable style={[styles.btnGold, !mpMyTurn && styles.disabledBtn, { flex: 1 }]} onPress={mpPlaySelected} disabled={!mpMyTurn}>
                    <Text style={styles.btnDarkText}>Play</Text>
                  </Pressable>
                  <Pressable style={[styles.btnGreen, !mpMyTurn && styles.disabledBtn, { flex: 1 }]} onPress={mpPass} disabled={!mpMyTurn}>
                    <Text style={styles.btnDarkText}>Pass</Text>
                  </Pressable>
                </View>
                <View style={styles.buttonRow}>
                  <Pressable style={[styles.btnGreen, { flex: 1 }]} onPress={mpAddToPot}>
                    <Text style={styles.btnDarkText}>Add To Pot</Text>
                  </Pressable>
                  <Pressable style={[styles.btnGreen, { flex: 1 }]} onPress={mpSwitchToSpectator}>
                    <Text style={styles.btnDarkText}>Spectate</Text>
                  </Pressable>
                </View>
              </View>
            )}

            <ChatPanel messages={mpChatMessages} inputValue={mpChatInput} onChangeInput={setMpChatInput} onSend={sendMpChat} canChat={isConnected} />
          </KeyboardAvoidingView>
        )}
        </View>
      </SafeAreaView>
    </LinearGradient>
  );
}

// â”€â”€â”€ Styles â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const styles = StyleSheet.create({
  gradient: { flex: 1 },
  safe: { flex: 1, paddingHorizontal: 12, paddingBottom: 6 },
  pageShell: { flex: 1, width: '100%' },
  pageShellDesktop: { width: '100%', maxWidth: 1220, alignSelf: 'center' },
  webPanelWrap: { width: '100%' },
  webPanelWrapDesktop: { maxWidth: 980, alignSelf: 'center' },
  flex1: { flex: 1 },

  // Header
  headerRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4, marginBottom: 10, gap: 8 },
  backBtn: { paddingRight: 6 },
  backText: { color: '#f1c75d', fontSize: 14, fontWeight: '700' },
  headerTitle: { color: '#f2f7f2', fontSize: 20, fontWeight: '800', flex: 1 },
  balancePill: { color: '#f6e27f', fontWeight: '700', fontSize: 14, backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4 },
  connectPill: { backgroundColor: '#f1c75d', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 5 },
  connectPillText: { color: '#153223', fontWeight: '900', fontSize: 12 },

  // Menu
  menuContainer: { flex: 1 },
  menuHeadline: { color: '#fff', fontSize: 24, fontWeight: '900', marginBottom: 6, textAlign: 'center' },
  menuList: { flex: 1, gap: 8 },
  menuListDesktop: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignContent: 'flex-start' },
  menuBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(8,26,24,0.78)', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: 'rgba(197,228,216,0.2)', gap: 12 },
  menuBtnDesktop: { width: '49%', minHeight: 110 },
  menuIcon: { fontSize: 26 },
  menuBtnTitle: { color: '#fff', fontSize: 16, fontWeight: '800' },
  menuBtnSub: { color: '#a8d8c4', fontSize: 12, marginTop: 2 },

  guestBanner: { backgroundColor: 'rgba(200,140,50,0.22)', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: 'rgba(200,160,80,0.4)', marginBottom: 8 },
  guestText: { color: '#f8ecae', fontSize: 13, textAlign: 'center' },

  // Shared
  scrollContent: { paddingBottom: 16 },
  formPanel: { backgroundColor: 'rgba(8,26,24,0.78)', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: 'rgba(197,228,216,0.2)' },
  panelTitle: { color: '#fff', fontSize: 20, fontWeight: '800', marginBottom: 8 },
  bodyText: { color: '#d5ebdf', fontSize: 14, marginBottom: 6 },
  label: { color: '#ddf6e8', fontSize: 13, marginTop: 6, marginBottom: 3 },
  input: { borderColor: '#74a697', borderWidth: 1, borderRadius: 10, backgroundColor: '#0f3f38', color: '#eff8f0', paddingHorizontal: 10, paddingVertical: 9, marginBottom: 8 },
  ruleCallout: { color: '#f8ecae', fontWeight: '600', marginTop: 4 },
  buttonRow: { flexDirection: 'row', gap: 8, marginTop: 6 },

  // Buttons
  btnGold: { backgroundColor: '#f1c75d', borderRadius: 11, paddingVertical: 11, alignItems: 'center', justifyContent: 'center' },
  btnGreen: { backgroundColor: '#4f7f72', borderRadius: 11, paddingVertical: 11, alignItems: 'center', justifyContent: 'center' },
  btnQuit: { backgroundColor: 'rgba(180,50,50,0.75)', borderRadius: 11, paddingVertical: 11, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  btnDarkText: { color: '#0f2719', fontWeight: '900', fontSize: 14 },
  disabledBtn: { opacity: 0.38 },

  // Difficulty
  diffBtn: { borderRadius: 10, paddingVertical: 9, alignItems: 'center', backgroundColor: 'rgba(10,35,30,0.8)', borderWidth: 1, borderColor: 'rgba(197,228,216,0.25)' },
  diffBtnActive: { backgroundColor: '#f1c75d', borderColor: '#f1c75d' },
  diffBtnText: { color: '#a8d8c4', fontWeight: '700', fontSize: 13 },
  diffBtnTextActive: { color: '#0f2719' },

  // Rooms
  roomRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(8,26,24,0.78)', borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: 'rgba(197,228,216,0.2)' },
  roomName: { color: '#fff', fontSize: 14, fontWeight: '700' },
  roomSub: { color: '#a8d8c4', fontSize: 12, marginTop: 2 },
  statusBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { color: '#0a1f18', fontSize: 11, fontWeight: '800' },
  roomActionBtn: { backgroundColor: '#4f7f72', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 6 },
  roomActionText: { color: '#fff', fontWeight: '800', fontSize: 13 },

  // Game layout
  opponentsRow: { flexDirection: 'row', gap: 6, marginBottom: 8 },
  opponentBadge: { flex: 1, backgroundColor: 'rgba(17,41,37,0.8)', borderRadius: 10, padding: 8, borderWidth: 1, borderColor: 'rgba(170,220,197,0.2)', alignItems: 'center' },
  opponentBadgeActive: { borderColor: '#f1c75d', borderWidth: 2 },
  opponentBadgeWinner: { borderColor: '#3eb37a', borderWidth: 2 },
  opponentName: { color: '#f2f6f2', fontWeight: '700', fontSize: 12 },
  opponentSub: { color: '#cbe4d7', fontSize: 11, marginTop: 1 },
  winnerTag: { fontSize: 14 },

  tableArea: { backgroundColor: 'rgba(8,25,21,0.55)', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(208,235,224,0.22)', alignItems: 'center', justifyContent: 'center', paddingVertical: 10, paddingHorizontal: 6, marginBottom: 8, minHeight: 96 },
  tableLabel: { color: '#edf9f2', fontSize: 13, fontWeight: '700', marginBottom: 4 },
  tablePot: { color: '#f8ecae', fontSize: 12, marginBottom: 4 },
  mustOpenHint: { color: '#f1c75d', fontSize: 12, marginBottom: 4 },
  tableCardsRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 5 },

  playerArea: { flex: 1, borderRadius: 12, padding: 10, backgroundColor: 'rgba(7,27,22,0.72)', borderWidth: 1, borderColor: 'rgba(208,235,224,0.22)', marginBottom: 6 },
  turnText: { color: '#ebfaef', fontSize: 13, marginBottom: 6, fontWeight: '600' },
  handList: { marginBottom: 6 },
  cardSpacing: { marginRight: 7, marginBottom: 2 },

  winBanner: { backgroundColor: 'rgba(8,26,24,0.92)', borderRadius: 14, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: '#3eb37a', marginBottom: 8 },
  winBannerText: { color: '#fff', fontSize: 22, fontWeight: '900', marginBottom: 10 },

  // Cards
  card: { width: 50, height: 74, borderRadius: 8, backgroundColor: '#f7f7f4', borderWidth: 1, borderColor: '#b5b5b5', justifyContent: 'space-between', padding: 6 },
  cardSmall: { width: 42, height: 60, padding: 4 },
  cardSelected: { borderColor: '#f3c85a', borderWidth: 2 },
  cardText: { color: '#252525', fontSize: 17, fontWeight: '700' },
  cardTextSmall: { fontSize: 13 },
  cardSuit: { color: '#252525', fontSize: 17, textAlign: 'right', fontWeight: '700' },
  cardRed: { color: '#c33a3a' },

  // Chat
  chatWrap: { backgroundColor: 'rgba(7,20,18,0.9)', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(197,228,216,0.18)', maxHeight: 190 },
  chatHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 8 },
  chatHeaderText: { color: '#a8d8c4', fontWeight: '700', fontSize: 12 },
  chatToggle: { color: '#a8d8c4', fontSize: 12 },
  chatScroll: { maxHeight: 100, paddingHorizontal: 8 },
  chatEmpty: { color: '#5a8a7a', fontSize: 12, fontStyle: 'italic', paddingVertical: 4 },
  chatRow: { flexDirection: 'row', marginBottom: 3, flexWrap: 'wrap' },
  chatSender: { color: '#f1c75d', fontWeight: '700', fontSize: 12 },
  chatText: { color: '#d5ebdf', fontSize: 12, flex: 1 },
  chatInputRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: 'rgba(197,228,216,0.15)', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, gap: 6 },
  chatInput: { flex: 1, backgroundColor: '#0f3f38', borderRadius: 8, color: '#eff8f0', paddingHorizontal: 10, paddingVertical: 6, fontSize: 13, borderWidth: 1, borderColor: '#74a697' },
  chatSendBtn: { backgroundColor: '#f1c75d', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  chatSendText: { color: '#153223', fontWeight: '900', fontSize: 14 },
});
