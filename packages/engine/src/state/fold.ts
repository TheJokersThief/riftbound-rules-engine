import type { GameEvent } from "@thejokersthief/riftbound-protocol";
import type { BattlefieldId, CardId, PlayerId } from "@thejokersthief/riftbound-protocol";
import { typedObjectKeys } from "@thejokersthief/riftbound-protocol";
import type { BattlefieldState, CardInstance, GameState, PlayerState } from "./types.js";

function updateCard(
  state: GameState,
  cardId: CardId,
  updater: (card: CardInstance) => CardInstance,
): GameState {
  const card = state.cards[cardId];
  if (!card) return state;
  return { ...state, cards: { ...state.cards, [cardId]: updater(card) } };
}

function removeCardFromAllZones(state: GameState, cardId: CardId): GameState {
  const players = { ...state.players } as Record<PlayerId, PlayerState>;
  for (const pid of typedObjectKeys(players)) {
    const p = players[pid]!;
    players[pid] = {
      ...p,
      hand: p.hand.filter((id) => id !== cardId),
      mainDeck: p.mainDeck.filter((id) => id !== cardId),
      runeDeck: p.runeDeck.filter((id) => id !== cardId),
      base: p.base.filter((id) => id !== cardId),
      trash: p.trash.filter((id) => id !== cardId),
    };
  }
  const battlefields = { ...state.battlefields } as Record<BattlefieldId, BattlefieldState>;
  for (const bfId of typedObjectKeys(battlefields)) {
    const bf = battlefields[bfId]!;
    if (bf.units.includes(cardId)) {
      battlefields[bfId] = { ...bf, units: bf.units.filter((id) => id !== cardId) };
    }
  }
  return { ...state, players, battlefields };
}

function addCardToZone(state: GameState, cardId: CardId, toZone: string): GameState {
  const ownerId = state.cards[cardId]?.ownerId;
  if (!ownerId) return state;
  const player = state.players[ownerId]!;
  const destination = toZone.startsWith("discard") ? "trash" : toZone;
  switch (destination) {
    case "base":
      return { ...state, players: { ...state.players, [ownerId]: { ...player, base: [...player.base, cardId] } } };
    case "trash":
      return { ...state, players: { ...state.players, [ownerId]: { ...player, trash: [...player.trash, cardId] } } };
    default:
      return state;
  }
}

export function fold(state: GameState, event: GameEvent): GameState {
  switch (event.type) {
    case "GameStarted":
      return { ...state, status: "playing" };

    case "TurnStarted":
      return {
        ...state,
        turnNumber: event.turnNumber,
        activePlayerId: event.activePlayerId,
        scoredThisTurn: {},
      };

    case "PhaseStarted":
      return { ...state, phase: event.phase };

    case "ChainOpened":
      return { ...state, chain: { ...state.chain, isOpen: true, passes: 0 } };

    case "ChainClosed":
      return { ...state, chain: { ...state.chain, isOpen: false, passes: 0, items: [], showdown: null } };

    case "ShowdownOpened":
      return {
        ...state,
        chain: {
          ...state.chain,
          showdown: { battlefieldId: event.battlefieldId, kind: event.kind },
        },
      };

    case "ShowdownClosed":
      return { ...state, chain: { ...state.chain, showdown: null } };

    case "PriorityPassed":
      return { ...state, chain: { ...state.chain, priority: event.playerId } };

    case "FocusPassed":
      return { ...state, chain: { ...state.chain, focus: event.playerId } };

    case "CardDrawn": {
      if (event.cardId === null) return state;
      const player = state.players[event.playerId]!;
      return {
        ...state,
        players: {
          ...state.players,
          [event.playerId]: {
            ...player,
            hand: [...player.hand, event.cardId],
            mainDeck: player.mainDeck.filter((id) => id !== event.cardId),
          },
        },
      };
    }

    case "CardPlayed": {
      const player = state.players[event.playerId]!;
      return {
        ...state,
        players: {
          ...state.players,
          [event.playerId]: {
            ...player,
            hand: player.hand.filter((id) => id !== event.cardId),
          },
        },
      };
    }

    case "CardDiscarded": {
      const player = state.players[event.playerId]!;
      return {
        ...state,
        players: {
          ...state.players,
          [event.playerId]: {
            ...player,
            hand: player.hand.filter((id) => id !== event.cardId),
          },
        },
      };
    }

    case "CardExhausted":
      return updateCard(state, event.cardId, (card) => ({ ...card, exhausted: true }));

    case "CardReadied":
      return updateCard(state, event.cardId, (card) => ({ ...card, exhausted: false }));

    case "CardBuffed":
      return updateCard(state, event.cardId, (card) => ({
        ...card,
        buffAmount: card.buffAmount + event.amount,
      }));

    case "MightGiven":
      return updateCard(state, event.cardId, (card) => ({
        ...card,
        buffAmount: card.buffAmount + event.amount,
      }));

    case "KeywordGranted":
      return updateCard(state, event.cardId, (card) => ({
        ...card,
        keywords: [...card.keywords, event.keyword],
      }));

    case "CardKilled": {
      const killedId = event.cardId;
      const ownerId = state.cards[killedId]?.ownerId;
      const battlefields = { ...state.battlefields } as Record<BattlefieldId, BattlefieldState>;
      for (const bfId of typedObjectKeys(battlefields)) {
        const bf = battlefields[bfId]!;
        if (bf.units.includes(killedId)) {
          battlefields[bfId] = { ...bf, units: bf.units.filter((id) => id !== killedId) };
        }
      }
      const players = { ...state.players } as Record<PlayerId, PlayerState>;
      for (const pid of typedObjectKeys(players)) {
        const p = players[pid]!;
        const inBase = p.base.includes(killedId);
        players[pid] = {
          ...p,
          base: inBase ? p.base.filter((id) => id !== killedId) : p.base,
          trash: pid === ownerId ? [...p.trash, killedId] : p.trash,
        };
      }
      const withZones: GameState = { ...state, battlefields, players };
      return updateCard(withZones, killedId, (card) => ({ ...card, damage: 0 }));
    }

    case "ControlChanged":
      return {
        ...state,
        battlefields: {
          ...state.battlefields,
          [event.battlefieldId]: {
            ...state.battlefields[event.battlefieldId]!,
            controllerId: event.newControllerId,
          },
        },
      };

    case "PointScored": {
      const player = state.players[event.playerId]!;
      return {
        ...state,
        players: {
          ...state.players,
          [event.playerId]: { ...player, points: player.points + 1 },
        },
      };
    }

    case "ResourceAdded": {
      const player = state.players[event.playerId]!;
      return {
        ...state,
        players: {
          ...state.players,
          [event.playerId]: {
            ...player,
            resources: {
              energy: player.resources.energy + event.energy,
              power: player.resources.power + event.power,
            },
          },
        },
      };
    }

    case "XPGained":
      return updateCard(state, event.cardId, (card) => ({ ...card, xp: card.xp + event.amount }));

    case "XPSpent":
      return updateCard(state, event.cardId, (card) => ({ ...card, xp: card.xp - event.amount }));

    case "GameEnded":
      return { ...state, status: "ended", winner: event.winner };

    // Events handled by higher-level resolvers — no direct state mapping in this layer
    case "CardMoved": {
      const removed = removeCardFromAllZones(state, event.cardId);
      return addCardToZone(removed, event.cardId, event.toZone);
    }

    case "DamageDealt":
      return updateCard(state, event.targetId, (card) => ({
        ...card,
        damage: card.damage + event.amount + event.bonus,
      }));

    case "BattlefieldChosen":
    case "MulliganChosen":
    case "CardRecalled":
    case "CardReturnedToHand":
    case "CardCountered":
    case "CardBanished":
    case "TokenCreated":
    case "CardRevealed":
    case "CardRecycled":
    case "RuneChanneled":
    case "TurnEnded":
    case "MatchEnded":
    case "ExtraTurnGranted":
      return state;
  }
}
