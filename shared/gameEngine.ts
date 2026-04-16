export type Suit = 'clubs' | 'diamonds' | 'hearts' | 'spades';
export type ComboType = 'single' | 'pair' | 'triple' | 'straight' | 'bomb';

export type Card = {
  id: string;
  rank: number;
  suit: Suit;
};

export type Play = {
  playerId: string;
  cards: Card[];
  type: ComboType;
  strength: number;
};

export const SUIT_ORDER: Record<Suit, number> = {
  clubs: 0,
  diamonds: 1,
  hearts: 2,
  spades: 3,
};

export const SUIT_SYMBOL: Record<Suit, string> = {
  clubs: '♣',
  diamonds: '♦',
  hearts: '♥',
  spades: '♠',
};

export const RANK_LABEL: Record<number, string> = {
  3: '3',
  4: '4',
  5: '5',
  6: '6',
  7: '7',
  8: '8',
  9: '9',
  10: '10',
  11: 'J',
  12: 'Q',
  13: 'K',
  14: 'A',
  15: '2',
};

export function makeDeck(): Card[] {
  const suits: Suit[] = ['clubs', 'diamonds', 'hearts', 'spades'];
  const deck: Card[] = [];
  for (let rank = 3; rank <= 15; rank += 1) {
    for (const suit of suits) {
      deck.push({ id: `${rank}-${suit}`, rank, suit });
    }
  }
  return deck;
}

export function shuffle(cards: Card[]): Card[] {
  const cloned = [...cards];
  for (let i = cloned.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [cloned[i], cloned[j]] = [cloned[j], cloned[i]];
  }
  return cloned;
}

export function sortCards(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => {
    if (a.rank !== b.rank) {
      return a.rank - b.rank;
    }
    return SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit];
  });
}

export function findCombo(cards: Card[]): { type: ComboType; strength: number } | null {
  const sorted = sortCards(cards);
  const ranks = sorted.map((c) => c.rank);
  const uniqueRanks = [...new Set(ranks)];

  if (sorted.length === 1) {
    return {
      type: 'single',
      strength: sorted[0].rank * 10 + SUIT_ORDER[sorted[0].suit],
    };
  }

  if (sorted.length === 2 && uniqueRanks.length === 1) {
    return {
      type: 'pair',
      strength: sorted[0].rank,
    };
  }

  if (sorted.length === 3 && uniqueRanks.length === 1) {
    return {
      type: 'triple',
      strength: sorted[0].rank,
    };
  }

  if (sorted.length === 4 && uniqueRanks.length === 1) {
    return {
      type: 'bomb',
      strength: sorted[0].rank,
    };
  }

  if (sorted.length >= 3 && uniqueRanks.length === sorted.length && !ranks.includes(15)) {
    let consecutive = true;
    for (let i = 1; i < ranks.length; i += 1) {
      if (ranks[i] !== ranks[i - 1] + 1) {
        consecutive = false;
        break;
      }
    }
    if (consecutive) {
      return {
        type: 'straight',
        strength: ranks[ranks.length - 1],
      };
    }
  }

  return null;
}

export function canBeatPlay(nextPlay: Play, currentPlay: Play | null): boolean {
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

export function removeCards(source: Card[], selected: Card[]): Card[] {
  const selectedIds = new Set(selected.map((c) => c.id));
  return source.filter((c) => !selectedIds.has(c.id));
}

export function nextTurn(activePlayerIds: string[], fromId: string): string {
  if (activePlayerIds.length === 0) {
    return fromId;
  }
  const currentIndex = activePlayerIds.indexOf(fromId);
  if (currentIndex === -1) {
    return activePlayerIds[0];
  }
  return activePlayerIds[(currentIndex + 1) % activePlayerIds.length];
}
