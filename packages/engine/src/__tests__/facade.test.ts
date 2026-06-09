import { describe, it, expect } from 'vitest'
import type {
  PlayerId,
  CardId,
  BattlefieldId,
  CardDefId,
  GameId,
  MatchId,
} from '@thejokersthief/riftbound-protocol'
import type { CardCatalog, CardDefinition } from '@thejokersthief/riftbound-card-catalog'
import type { GameState } from '../state/types.js'
import { createGame, submit, legalActions, serialize, deserialize } from '../index.js'
import type { DeckConfig } from '../index.js'

// ---------------------------------------------------------------------------
// Fixture identifiers
// ---------------------------------------------------------------------------

const p1 = 'player1' as PlayerId
const p2 = 'player2' as PlayerId
const bf1 = 'bf001' as BattlefieldId
const def1 = 'def001' as CardDefId
const def2 = 'def002' as CardDefId

// ---------------------------------------------------------------------------
// Card catalog fixture
// ---------------------------------------------------------------------------

const unitDef: CardDefinition = {
  id: def1,
  name: 'Test Unit',
  cardType: 'Unit',
  set: 'core',
  rarity: 'common',
  abilityText: '',
  might: 3,
  playCost: { energy: 2, power: 1, runes: [] },
  deckZone: 'Main',
  keywords: [],
}

const runeDef: CardDefinition = {
  id: def2,
  name: 'Test Rune',
  cardType: 'Rune',
  set: 'core',
  rarity: 'common',
  abilityText: '',
  might: 0,
  playCost: { energy: 0, power: 0, runes: [] },
  deckZone: 'Rune',
  keywords: [],
}

const defs: Record<CardDefId, CardDefinition> = {
  [def1]: unitDef,
  [def2]: runeDef,
}

const mockCatalog: CardCatalog = {
  get: (id) => {
    const d = defs[id]
    if (!d) throw new Error(`unknown ${id}`)
    return d
  },
  find: (id) => defs[id] ?? null,
  all: () => Object.values(defs),
}

// ---------------------------------------------------------------------------
// DeckConfig fixture helper — valid configuration
// ---------------------------------------------------------------------------

function makeValidDeck(): DeckConfig {
  // 40 mainDeck cards (all def1), 10 rune cards (all def2), 3 battlefields
  return {
    mainDeck: Array.from({ length: 40 }, () => def1),
    runeDeck: Array.from({ length: 10 }, () => def2),
    legendId: def1,
    championId: def1,
    battlefields: [def1, def1, def1],
  }
}

// ---------------------------------------------------------------------------
// makeState helper for direct state construction in tests
// ---------------------------------------------------------------------------

function makeState(overrides: Partial<GameState> = {}): GameState {
  const cardId = 'card001' as CardId
  return {
    gameId: 'game1' as GameId,
    matchId: 'match1' as MatchId,
    playerIds: [p1, p2],
    cards: {
      [cardId]: {
        id: cardId,
        defId: def1,
        ownerId: p1,
        exhausted: false,
        buffAmount: 0,
        keywords: [],
        xp: 0,
        counters: {},
        faceDown: false,
      },
    },
    players: {
      [p1]: {
        hand: [cardId],
        mainDeck: [],
        runeDeck: [],
        runePool: Array.from({ length: 10 }, () => ({ filled: false, runeCardId: null })),
        legendZone: 'leg1' as CardId,
        championZone: 'chm1' as CardId,
        base: [],
        resources: { energy: 3, power: 2 },
        points: 0,
      },
      [p2]: {
        hand: [],
        mainDeck: [],
        runeDeck: [],
        runePool: Array.from({ length: 10 }, () => ({ filled: false, runeCardId: null })),
        legendZone: 'leg2' as CardId,
        championZone: 'chm2' as CardId,
        base: [],
        resources: { energy: 3, power: 2 },
        points: 0,
      },
    },
    battlefields: {
      [bf1]: {
        id: bf1,
        cardId: 'bfcard1' as CardId,
        controllerId: null,
        units: [],
      },
    },
    turnNumber: 1,
    activePlayerId: p1,
    phase: 'Main',
    chain: { isOpen: false, items: [], priority: null, focus: null, showdown: null },
    resolutionStack: [],
    pendingDecision: null,
    rng: { seed: 12345 },
    scoredThisTurn: {},
    status: 'playing',
    winner: null,
    hotQueue: [],
    holdEligible: [],
    firstTurnSecondPlayer: false,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// createGame tests
// ---------------------------------------------------------------------------

describe('createGame()', () => {
  it('returns a GameState with status=setup', () => {
    const decks = { [p1]: makeValidDeck(), [p2]: makeValidDeck() } as Record<PlayerId, DeckConfig>
    const state = createGame({ players: [p1, p2], decks, seed: 42, matchId: 'match1' as MatchId })
    expect(state.status).toBe('setup')
  })

  it('returns correct playerIds', () => {
    const decks = { [p1]: makeValidDeck(), [p2]: makeValidDeck() } as Record<PlayerId, DeckConfig>
    const state = createGame({ players: [p1, p2], decks, seed: 42, matchId: 'match1' as MatchId })
    expect(state.playerIds).toEqual([p1, p2])
  })

  it('throws on mainDeck too short (< 40)', () => {
    const badDeck: DeckConfig = { ...makeValidDeck(), mainDeck: Array.from({ length: 39 }, () => def1) }
    const decks = { [p1]: badDeck, [p2]: makeValidDeck() } as Record<PlayerId, DeckConfig>
    expect(() => createGame({ players: [p1, p2], decks, seed: 1, matchId: 'match1' as MatchId })).toThrow(
      /mainDeck must have 40/,
    )
  })

  it('throws on mainDeck too long (> 60)', () => {
    const badDeck: DeckConfig = { ...makeValidDeck(), mainDeck: Array.from({ length: 61 }, () => def1) }
    const decks = { [p1]: badDeck, [p2]: makeValidDeck() } as Record<PlayerId, DeckConfig>
    expect(() => createGame({ players: [p1, p2], decks, seed: 1, matchId: 'match1' as MatchId })).toThrow(
      /mainDeck must have 40/,
    )
  })

  it('throws when runeDeck length is not 10', () => {
    const badDeck: DeckConfig = { ...makeValidDeck(), runeDeck: Array.from({ length: 9 }, () => def2) }
    const decks = { [p1]: badDeck, [p2]: makeValidDeck() } as Record<PlayerId, DeckConfig>
    expect(() => createGame({ players: [p1, p2], decks, seed: 1, matchId: 'match1' as MatchId })).toThrow(
      /runeDeck must have exactly 10/,
    )
  })

  it('throws when battlefields length is not 3', () => {
    const badDeck = { ...makeValidDeck(), battlefields: [def1, def1] as unknown as [CardDefId, CardDefId, CardDefId] }
    const decks = { [p1]: badDeck, [p2]: makeValidDeck() } as Record<PlayerId, DeckConfig>
    expect(() => createGame({ players: [p1, p2], decks, seed: 1, matchId: 'match1' as MatchId })).toThrow(
      /battlefields must have exactly 3/,
    )
  })

  it('sets pendingDecision to ChooseMulligan at start', () => {
    const decks = { [p1]: makeValidDeck(), [p2]: makeValidDeck() } as Record<PlayerId, DeckConfig>
    const state = createGame({ players: [p1, p2], decks, seed: 42, matchId: 'match1' as MatchId })
    expect(state.pendingDecision).not.toBeNull()
    expect(state.pendingDecision?.type).toBe('ChooseMulligan')
  })

  it('deals 5 cards to each player', () => {
    const decks = { [p1]: makeValidDeck(), [p2]: makeValidDeck() } as Record<PlayerId, DeckConfig>
    const state = createGame({ players: [p1, p2], decks, seed: 99, matchId: 'match1' as MatchId })
    expect(state.players[p1]?.hand).toHaveLength(5)
    expect(state.players[p2]?.hand).toHaveLength(5)
  })

  it('has 10 rune slots per player (all empty)', () => {
    const decks = { [p1]: makeValidDeck(), [p2]: makeValidDeck() } as Record<PlayerId, DeckConfig>
    const state = createGame({ players: [p1, p2], decks, seed: 1, matchId: 'match1' as MatchId })
    expect(state.players[p1]?.runePool).toHaveLength(10)
    expect(state.players[p1]?.runePool.every(slot => !slot.filled)).toBe(true)
  })

  it('creates battlefields for both players', () => {
    const decks = { [p1]: makeValidDeck(), [p2]: makeValidDeck() } as Record<PlayerId, DeckConfig>
    const state = createGame({ players: [p1, p2], decks, seed: 7, matchId: 'match1' as MatchId })
    const bfs = Object.values(state.battlefields)
    expect(bfs.length).toBeGreaterThanOrEqual(2)
  })

  it('stores the matchId', () => {
    const decks = { [p1]: makeValidDeck(), [p2]: makeValidDeck() } as Record<PlayerId, DeckConfig>
    const state = createGame({ players: [p1, p2], decks, seed: 5, matchId: 'my-match' as MatchId })
    expect(state.matchId).toBe('my-match')
  })
})

// ---------------------------------------------------------------------------
// submit tests
// ---------------------------------------------------------------------------

describe('submit()', () => {
  it('KeepHand transitions status from setup to playing', () => {
    const decks = { [p1]: makeValidDeck(), [p2]: makeValidDeck() } as Record<PlayerId, DeckConfig>
    const setupState = createGame({ players: [p1, p2], decks, seed: 1, matchId: 'match1' as MatchId })
    const firstPlayer = setupState.activePlayerId
    const { state: newState } = submit(setupState, { type: 'KeepHand', playerId: firstPlayer }, mockCatalog)
    expect(newState.status).toBe('playing')
    expect(newState.pendingDecision).toBeNull()
  })

  it('Mulligan reshuffles hand and transitions to playing', () => {
    const decks = { [p1]: makeValidDeck(), [p2]: makeValidDeck() } as Record<PlayerId, DeckConfig>
    const setupState = createGame({ players: [p1, p2], decks, seed: 1, matchId: 'match1' as MatchId })
    const firstPlayer = setupState.activePlayerId
    const { state: newState } = submit(setupState, { type: 'Mulligan', playerId: firstPlayer }, mockCatalog)
    expect(newState.status).toBe('playing')
    expect(newState.pendingDecision).toBeNull()
    // Hand should still have 5 cards after mulligan
    expect(newState.players[firstPlayer]?.hand).toHaveLength(5)
  })

  it('EndTurn changes phase (advanceTurn is called)', () => {
    const state = makeState({ phase: 'Main' })
    const { state: newState } = submit(state, { type: 'EndTurn', playerId: p1 }, mockCatalog)
    // advanceTurn runs Ending phase, cleanup, and turn rotation — phase won't be 'Main' after
    expect(newState.phase).not.toBe('Main')
  })

  it('throws when game is ended', () => {
    const state = makeState({ status: 'ended' })
    expect(() => submit(state, { type: 'EndTurn', playerId: p1 }, mockCatalog)).toThrow(
      /Cannot submit action to an ended game/,
    )
  })

  it('throws when playerId is unknown', () => {
    const state = makeState()
    const unknownPlayer = 'stranger' as PlayerId
    expect(() => submit(state, { type: 'EndTurn', playerId: unknownPlayer }, mockCatalog)).toThrow(
      /Unknown player/,
    )
  })

  it('PassPriority calls advance (returns state)', () => {
    const state = makeState()
    const { state: newState, events } = submit(state, { type: 'PassPriority', playerId: p1 }, mockCatalog)
    // advance is a no-op when stack is empty and no pending decision
    expect(newState).toBeDefined()
    expect(events).toBeInstanceOf(Array)
  })
})

// ---------------------------------------------------------------------------
// legalActions tests
// ---------------------------------------------------------------------------

describe('legalActions()', () => {
  it('returns KeepHand and Mulligan when pendingDecision is ChooseMulligan for this player', () => {
    const state = makeState({
      status: 'setup',
      pendingDecision: { type: 'ChooseMulligan', playerId: p1, handSize: 5 },
    })
    const actions = legalActions(state, p1, mockCatalog)
    const types = actions.map(a => a.type)
    expect(types).toContain('KeepHand')
    expect(types).toContain('Mulligan')
  })

  it('returns [] for other player when pendingDecision belongs to p1', () => {
    const state = makeState({
      pendingDecision: { type: 'ChooseMulligan', playerId: p1, handSize: 5 },
    })
    const actions = legalActions(state, p2, mockCatalog)
    expect(actions).toEqual([])
  })

  it('returns EndTurn when in Main phase with no chain and player is active', () => {
    const state = makeState({ phase: 'Main', activePlayerId: p1 })
    const actions = legalActions(state, p1, mockCatalog)
    const types = actions.map(a => a.type)
    expect(types).toContain('EndTurn')
  })

  it('returns [] for non-active player with no pending decision', () => {
    const state = makeState({ phase: 'Main', activePlayerId: p1 })
    const actions = legalActions(state, p2, mockCatalog)
    expect(actions).toEqual([])
  })

  it('returns PassPriority during Main phase for active player', () => {
    const state = makeState({ phase: 'Main', activePlayerId: p1 })
    const actions = legalActions(state, p1, mockCatalog)
    const types = actions.map(a => a.type)
    expect(types).toContain('PassPriority')
  })

  it('returns ChooseYesNo options (true/false) when pendingDecision is ChooseYesNo', () => {
    const decisionId = 'dec1' as import('@thejokersthief/riftbound-protocol').DecisionId
    const state = makeState({
      pendingDecision: { type: 'ChooseYesNo', playerId: p1, decisionId, prompt: 'Do it?' },
    })
    const actions = legalActions(state, p1, mockCatalog)
    expect(actions).toHaveLength(2)
    const choices = actions.map(a => (a as { choice?: boolean }).choice)
    expect(choices).toContain(true)
    expect(choices).toContain(false)
  })

  it('includes PassPriority and playable cards when pendingDecision is PriorityWindow', () => {
    const state = makeState({
      pendingDecision: { type: 'PriorityWindow', playerId: p1 },
    })
    const actions = legalActions(state, p1, mockCatalog)
    // PassPriority is always available
    expect(actions.some(a => a.type === 'PassPriority')).toBe(true)
    // p1 has a Unit (def1, cost energy:2/power:1) in hand with sufficient resources during Main phase
    expect(actions.some(a => a.type === 'PlayCard')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// serialize / deserialize round-trip
// ---------------------------------------------------------------------------

describe('serialize() / deserialize()', () => {
  it('round-trips a GameState without data loss', () => {
    const decks = { [p1]: makeValidDeck(), [p2]: makeValidDeck() } as Record<PlayerId, DeckConfig>
    const state = createGame({ players: [p1, p2], decks, seed: 77, matchId: 'match-rt' as MatchId })
    const serialized = serialize(state)
    const restored = deserialize(serialized)
    expect(restored.gameId).toBe(state.gameId)
    expect(restored.matchId).toBe(state.matchId)
    expect(restored.playerIds).toEqual(state.playerIds)
    expect(restored.status).toBe(state.status)
    expect(Object.keys(restored.cards)).toEqual(Object.keys(state.cards))
    expect(restored.players[p1]?.hand).toEqual(state.players[p1]?.hand)
    expect(restored.players[p2]?.hand).toEqual(state.players[p2]?.hand)
  })

  it('serialized output is a valid JSON string', () => {
    const state = makeState()
    const s = serialize(state)
    expect(() => JSON.parse(s)).not.toThrow()
  })

  it('deserialize throws on invalid JSON', () => {
    expect(() => deserialize('not-json')).toThrow()
  })

  it('deserialize throws on invalid GameState shape', () => {
    expect(() => deserialize(JSON.stringify({ invalid: true }))).toThrow()
  })
})
