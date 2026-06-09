import type {
  PlayerId,
  CardId,
  CardDefId,
  BattlefieldId,
  GameId,
  MatchId,
  Action,
  GameEvent,
} from '@thejokersthief/riftbound-protocol'
import type { CardCatalog } from '@thejokersthief/riftbound-card-catalog'
import type { GameState, CardInstance } from './state/types.js'
import type { DeckConfig, MatchState } from './match/state.js'
import type { GameEngineFunctions } from './match/index.js'
import { nextInt, shuffle } from './rng.js'
import { fold } from './state/fold.js'
import { createRulesQuery } from './rules-query/index.js'
import { advance } from './chain/index.js'
import { advanceTurn } from './turn/index.js'
import {
  createMatch as _createMatch,
  submitToMatch as _submitToMatch,
  legalMatchActions as _legalMatchActions,
  viewForMatch as _viewForMatch,
} from './match/index.js'
import { viewFor as _viewFor } from './visibility/index.js'

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export type { DeckConfig } from './match/state.js'
export type { GameState, MatchState }
export { serialize, deserialize } from './state/serialization.js'
export { viewFor } from './visibility/index.js'
export {
  createMatch,
  submitToMatch,
  legalMatchActions,
  viewForMatch,
  type GameEngineFunctions,
} from './match/index.js'
export { createRulesQuery } from './rules-query/index.js'
export { runStartPhase, runChannelPhase, startMainPhase } from './turn/index.js'
export { fold } from './state/fold.js'
export { resolveCombat } from './combat/index.js'

// ---------------------------------------------------------------------------
// createGame
// ---------------------------------------------------------------------------

export function createGame(config: {
  players: readonly [PlayerId, PlayerId]
  decks: Record<PlayerId, DeckConfig>
  seed: number
  matchId: MatchId
}): GameState {
  const [p1, p2] = config.players

  // Validate decks
  for (const playerId of config.players) {
    const deck = config.decks[playerId]
    if (!deck) throw new Error(`Missing deck for player ${playerId}`)
    if (deck.mainDeck.length < 40 || deck.mainDeck.length > 60) {
      throw new Error(
        `Player ${playerId} mainDeck must have 40–60 cards, got ${deck.mainDeck.length}`,
      )
    }
    if (deck.runeDeck.length !== 10) {
      throw new Error(
        `Player ${playerId} runeDeck must have exactly 10 cards, got ${deck.runeDeck.length}`,
      )
    }
    if (deck.battlefieldIds.length !== 3) {
      throw new Error(
        `Player ${playerId} battlefieldIds must have exactly 3, got ${deck.battlefieldIds.length}`,
      )
    }
  }

  let rng = { seed: config.seed }
  let cardCounter = 0

  function makeCardId(): CardId {
    return `card-${config.seed}-${cardCounter++}` as CardId
  }

  function makeCard(defId: CardDefId, ownerId: PlayerId): CardInstance {
    return {
      id: makeCardId(),
      defId,
      ownerId,
      exhausted: false,
      buffAmount: 0,
      keywords: [],
      xp: 0,
      counters: {},
      faceDown: false,
    }
  }

  const allCards: Record<CardId, CardInstance> = {}

  // Build cards for each player
  interface PlayerCards {
    mainDeckIds: CardId[]
    runeDeckIds: CardId[]
    legendId: CardId
    championId: CardId
  }

  function buildPlayerCards(playerId: PlayerId): PlayerCards {
    const deck = config.decks[playerId]!

    // Main deck
    const mainDeckIds: CardId[] = deck.mainDeck.map(defId => {
      const card = makeCard(defId, playerId)
      allCards[card.id] = card
      return card.id
    })

    // Rune deck
    const runeDeckIds: CardId[] = deck.runeDeck.map(defId => {
      const card = makeCard(defId, playerId)
      allCards[card.id] = card
      return card.id
    })

    // Legend
    const legendCard = makeCard(deck.legendId, playerId)
    allCards[legendCard.id] = legendCard

    // Champion
    const championCard = makeCard(deck.championId, playerId)
    allCards[championCard.id] = championCard

    // Battlefield cards (all 3 created as instances)
    for (const bfDefId of deck.battlefieldIds) {
      const bfCard = makeCard(bfDefId, playerId)
      allCards[bfCard.id] = bfCard
    }

    return {
      mainDeckIds,
      runeDeckIds,
      legendId: legendCard.id,
      championId: championCard.id,
    }
  }

  const p1Cards = buildPlayerCards(p1)
  const p2Cards = buildPlayerCards(p2)

  // Shuffle main decks
  const shuffleP1 = shuffle(p1Cards.mainDeckIds, rng)
  rng = shuffleP1.next
  const p1ShuffledDeck = shuffleP1.result

  const shuffleP2 = shuffle(p2Cards.mainDeckIds, rng)
  rng = shuffleP2.next
  const p2ShuffledDeck = shuffleP2.result

  // Determine first player
  const firstPlayerResult = nextInt(rng, 2)
  rng = firstPlayerResult.next
  const firstPlayerId = config.players[firstPlayerResult.value]!

  // Draw opening hands (5 cards)
  const p1Hand = p1ShuffledDeck.slice(0, 5)
  const p1Deck = p1ShuffledDeck.slice(5)
  const p2Hand = p2ShuffledDeck.slice(0, 5)
  const p2Deck = p2ShuffledDeck.slice(5)

  // Create battlefield instances from first battlefield in each player's config
  const p1BfId = `bf-${p1}` as BattlefieldId
  const p2BfId = `bf-${p2}` as BattlefieldId

  const p1BfDefId = config.decks[p1]!.battlefieldIds[0]!
  const p2BfDefId = config.decks[p2]!.battlefieldIds[0]!

  const p1BfCard = makeCard(p1BfDefId, p1)
  allCards[p1BfCard.id] = p1BfCard

  const p2BfCard = makeCard(p2BfDefId, p2)
  allCards[p2BfCard.id] = p2BfCard

  const state: GameState = {
    gameId: `game-${config.seed}` as GameId,
    matchId: config.matchId,
    playerIds: config.players as [PlayerId, PlayerId],
    cards: allCards,
    players: {
      [p1]: {
        hand: p1Hand,
        mainDeck: p1Deck,
        runeDeck: p1Cards.runeDeckIds,
        runePool: Array.from({ length: 10 }, () => ({ filled: false, runeCardId: null })),
        legendZone: p1Cards.legendId,
        championZone: p1Cards.championId,
        base: [],
        resources: { energy: 3, power: 2 },
        points: 0,
      },
      [p2]: {
        hand: p2Hand,
        mainDeck: p2Deck,
        runeDeck: p2Cards.runeDeckIds,
        runePool: Array.from({ length: 10 }, () => ({ filled: false, runeCardId: null })),
        legendZone: p2Cards.legendId,
        championZone: p2Cards.championId,
        base: [],
        resources: { energy: 3, power: 2 },
        points: 0,
      },
    } as Record<PlayerId, import('./state/types.js').PlayerState>,
    battlefields: {
      [p1BfId]: { id: p1BfId, cardId: p1BfCard.id, controllerId: p1, units: [] },
      [p2BfId]: { id: p2BfId, cardId: p2BfCard.id, controllerId: p2, units: [] },
    } as Record<BattlefieldId, import('./state/types.js').BattlefieldState>,
    turnNumber: 1,
    activePlayerId: firstPlayerId,
    phase: 'Start',
    chain: { isOpen: false, items: [], priority: null, focus: null, showdown: null },
    resolutionStack: [],
    pendingDecision: {
      type: 'ChooseMulligan',
      playerId: firstPlayerId,
      handSize: 5,
    },
    rng,
    scoredThisTurn: {} as Record<PlayerId, BattlefieldId[]>,
    status: 'setup',
    winner: null,
    hotQueue: [],
    holdEligible: [],
    firstTurnSecondPlayer: true,
  }

  return state
}

// ---------------------------------------------------------------------------
// submit
// ---------------------------------------------------------------------------

export function submit(
  state: GameState,
  action: Action,
  catalog: CardCatalog,
): { state: GameState; events: GameEvent[] } {
  // Validate player
  if (!state.playerIds.includes(action.playerId)) {
    throw new Error(`Unknown player ${action.playerId}`)
  }

  // Status dispatch
  if (state.status === 'ended') {
    throw new Error('Cannot submit action to an ended game')
  }

  if (state.status === 'setup') {
    switch (action.type) {
      case 'KeepHand':
        return { state: { ...state, status: 'playing', pendingDecision: null }, events: [] }

      case 'Mulligan': {
        // Simplified: shuffle hand back, draw new 5
        const player = state.players[action.playerId]
        if (!player) return { state: { ...state, pendingDecision: null, status: 'playing' }, events: [] }

        const newDeck = [...player.hand, ...player.mainDeck]
        const shuffled = shuffle(newDeck, state.rng)
        const newHand = shuffled.result.slice(0, 5)
        const remainingDeck = shuffled.result.slice(5)

        const newState: GameState = {
          ...state,
          rng: shuffled.next,
          pendingDecision: null,
          status: 'playing',
          players: {
            ...state.players,
            [action.playerId]: {
              ...player,
              hand: newHand,
              mainDeck: remainingDeck,
            },
          },
        }
        return { state: newState, events: [] }
      }

      case 'ChooseBattlefield':
        return { state: { ...state, pendingDecision: null, status: 'playing' }, events: [] }

      default:
        return { state, events: [] }
    }
  }

  // status === 'playing'
  const query = createRulesQuery(state, catalog)

  switch (action.type) {
    case 'EndTurn': {
      return advanceTurn(state, query, catalog)
    }

    case 'PassPriority':
    case 'PassFocus': {
      return advance(state, query, catalog)
    }

    case 'PlayCard': {
      const event: GameEvent = {
        type: 'CardPlayed',
        playerId: action.playerId,
        cardId: action.cardId,
      }
      const newState = fold(state, event)
      return { state: newState, events: [event] }
    }

    case 'ActivateAbility': {
      return advance(state, query, catalog)
    }

    case 'ChooseTargets':
    case 'ChooseYesNo':
    case 'ChooseOne': {
      const newStack = state.resolutionStack.slice(0, -1)
      return advance({ ...state, resolutionStack: newStack, pendingDecision: null }, query, catalog)
    }

    case 'AssignDamage': {
      return advance({ ...state, pendingDecision: null }, query, catalog)
    }

    default:
      return { state, events: [] }
  }
}

// ---------------------------------------------------------------------------
// legalActions
// ---------------------------------------------------------------------------

export function legalActions(
  state: GameState,
  playerId: PlayerId,
  catalog: CardCatalog,
): Action[] {
  // Branch A: pending decision
  if (state.pendingDecision !== null) {
    if (state.pendingDecision.playerId !== playerId) return []

    const decision = state.pendingDecision
    switch (decision.type) {
      case 'PriorityWindow':
        return [{ type: 'PassPriority', playerId }]

      case 'FocusWindow':
        return [{ type: 'PassFocus', playerId }]

      case 'ChooseYesNo':
        return [
          { type: 'ChooseYesNo', playerId, decisionId: decision.decisionId, choice: true },
          { type: 'ChooseYesNo', playerId, decisionId: decision.decisionId, choice: false },
        ]

      case 'ChooseOne':
        return decision.options.map((_, i) => ({
          type: 'ChooseOne' as const,
          playerId,
          decisionId: decision.decisionId,
          index: i,
        }))

      case 'ChooseMulligan':
        return [
          { type: 'KeepHand', playerId },
          { type: 'Mulligan', playerId },
        ]

      case 'ChooseBattlefield':
        // ChooseBattlefield decision.options is CardId[], but the action takes cardDefId (CardDefId)
        // For v1 we emit a stub — the decision carries the available option card ids
        return decision.options.map(cardId => {
          const inst = state.cards[cardId]
          return {
            type: 'ChooseBattlefield' as const,
            playerId,
            cardDefId: inst?.defId ?? (cardId as unknown as CardDefId),
          }
        })

      case 'ChooseTargets':
        return [
          {
            type: 'ChooseTargets' as const,
            playerId,
            decisionId: decision.decisionId,
            targets: [],
          },
        ]

      case 'AssignDamage':
        return [
          {
            type: 'AssignDamage' as const,
            playerId,
            assignments: [],
          },
        ]
    }
  }

  // Branch B: no pending decision
  if (playerId !== state.activePlayerId) return []

  const actions: Action[] = []
  const query = createRulesQuery(state, catalog)
  const player = state.players[playerId]

  if (!player) return []

  // PlayCard
  for (const cardId of player.hand) {
    if (query.canBePlayed(cardId, playerId)) {
      actions.push({ type: 'PlayCard', playerId, cardId, targets: undefined })
    }
  }

  // EndTurn — available during main phase when chain is closed
  if (state.phase === 'Main' && !state.chain.isOpen) {
    actions.push({ type: 'EndTurn', playerId })
  }

  // PassPriority — available during main phase
  if (state.phase === 'Main') {
    actions.push({ type: 'PassPriority', playerId })
  }

  return actions
}

// ---------------------------------------------------------------------------
// createMatchEngine — catalog-bound match engine factory
// ---------------------------------------------------------------------------

export function createMatchEngine(catalog: CardCatalog) {
  const engine: GameEngineFunctions = {
    createGame: (config) =>
      createGame({ ...config, matchId: 'match-0' as MatchId }),
    submit: (state, action) => submit(state, action, catalog),
    legalActions: (state, playerId) => legalActions(state, playerId, catalog),
    viewFor: (state, playerId) => _viewFor(state, playerId, catalog),
  }

  return {
    createMatch: (config: Parameters<typeof _createMatch>[0]) => _createMatch(config, engine),
    submitToMatch: (ms: MatchState, action: Action) => _submitToMatch(ms, action, engine),
    legalMatchActions: (ms: MatchState, pid: PlayerId) => _legalMatchActions(ms, pid, engine),
    viewForMatch: (ms: MatchState, pid: PlayerId) => _viewForMatch(ms, pid, engine),
  }
}
