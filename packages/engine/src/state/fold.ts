import type { GameState, CardInstance, PlayerState, BattlefieldState } from './types.js'
import type { GameEvent } from '@thejokersthief/riftbound-protocol'
import type { PlayerId, CardId, BattlefieldId } from '@thejokersthief/riftbound-protocol'

function updateCard(
  state: GameState,
  cardId: CardId,
  updater: (card: CardInstance) => CardInstance,
): GameState {
  const card = state.cards[cardId]
  if (!card) return state
  return { ...state, cards: { ...state.cards, [cardId]: updater(card) } }
}

export function fold(state: GameState, event: GameEvent): GameState {
  switch (event.type) {
    case 'GameStarted':
      return { ...state, status: 'playing' }

    case 'TurnStarted':
      return {
        ...state,
        turnNumber: event.turnNumber,
        activePlayerId: event.activePlayerId,
        scoredThisTurn: {} as Record<PlayerId, BattlefieldId[]>,
      }

    case 'PhaseStarted':
      return { ...state, phase: event.phase }

    case 'ChainOpened':
      return { ...state, chain: { ...state.chain, isOpen: true } }

    case 'ChainClosed':
      return { ...state, chain: { ...state.chain, isOpen: false, items: [], showdown: null } }

    case 'ShowdownOpened':
      return {
        ...state,
        chain: {
          ...state.chain,
          showdown: { battlefieldId: event.battlefieldId, kind: event.kind },
        },
      }

    case 'ShowdownClosed':
      return { ...state, chain: { ...state.chain, showdown: null } }

    case 'PriorityPassed':
      return { ...state, chain: { ...state.chain, priority: event.playerId } }

    case 'FocusPassed':
      return { ...state, chain: { ...state.chain, focus: event.playerId } }

    case 'CardDrawn': {
      if (event.cardId === null) return state
      const player = state.players[event.playerId]!
      return {
        ...state,
        players: {
          ...state.players,
          [event.playerId]: {
            ...player,
            hand: [...player.hand, event.cardId],
            mainDeck: player.mainDeck.filter(id => id !== event.cardId),
          },
        },
      }
    }

    case 'CardDiscarded': {
      const player = state.players[event.playerId]!
      return {
        ...state,
        players: {
          ...state.players,
          [event.playerId]: {
            ...player,
            hand: player.hand.filter(id => id !== event.cardId),
          },
        },
      }
    }

    case 'CardExhausted':
      return updateCard(state, event.cardId, card => ({ ...card, exhausted: true }))

    case 'CardReadied':
      return updateCard(state, event.cardId, card => ({ ...card, exhausted: false }))

    case 'CardBuffed':
      return updateCard(state, event.cardId, card => ({
        ...card,
        buffAmount: card.buffAmount + event.amount,
      }))

    case 'MightGiven':
      return updateCard(state, event.cardId, card => ({
        ...card,
        buffAmount: card.buffAmount + event.amount,
      }))

    case 'KeywordGranted':
      return updateCard(state, event.cardId, card => ({
        ...card,
        keywords: [...card.keywords, event.keyword],
      }))

    case 'CardKilled': {
      return {
        ...state,
        battlefields: Object.fromEntries(
          (Object.entries(state.battlefields) as [BattlefieldId, BattlefieldState][]).map(
            ([bfId, bf]) => [
              bfId,
              { ...bf, units: bf.units.filter(id => id !== event.cardId) },
            ],
          ),
        ) as Record<BattlefieldId, BattlefieldState>,
        players: Object.fromEntries(
          (Object.entries(state.players) as [PlayerId, PlayerState][]).map(([pid, p]) => [
            pid,
            { ...p, base: p.base.filter(id => id !== event.cardId) },
          ]),
        ) as Record<PlayerId, PlayerState>,
      }
    }

    case 'ControlChanged':
      return {
        ...state,
        battlefields: {
          ...state.battlefields,
          [event.battlefieldId]: {
            ...state.battlefields[event.battlefieldId]!,
            controllerId: event.newControllerId,
          },
        },
      }

    case 'PointScored': {
      const player = state.players[event.playerId]!
      return {
        ...state,
        players: {
          ...state.players,
          [event.playerId]: { ...player, points: player.points + 1 },
        },
      }
    }

    case 'ResourceAdded': {
      const player = state.players[event.playerId]!
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
      }
    }

    case 'XPGained':
      return updateCard(state, event.cardId, card => ({ ...card, xp: card.xp + event.amount }))

    case 'XPSpent':
      return updateCard(state, event.cardId, card => ({ ...card, xp: card.xp - event.amount }))

    case 'GameEnded':
      return { ...state, status: 'ended', winner: event.winner }

    // Events handled by higher-level resolvers — no direct state mapping in this layer
    case 'BattlefieldChosen':
    case 'MulliganChosen':
    case 'CardPlayed':
    case 'CardMoved':
    case 'CardRecalled':
    case 'CardReturnedToHand':
    case 'CardCountered':
    case 'CardBanished':
    case 'TokenCreated':
    case 'CardRevealed':
    case 'CardRecycled':
    case 'RuneChanneled':
    case 'DamageDealt':
    case 'TurnEnded':
    case 'MatchEnded':
    case 'ExtraTurnGranted':
      return state
  }
}
