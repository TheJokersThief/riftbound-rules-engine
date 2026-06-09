import { describe, it, expect, vi } from 'vitest'
import type {
  PlayerId,
  CardId,
  BattlefieldId,
  CardDefId,
  GameId,
  MatchId,
  Action,
  PlayerView,
} from '@thejokersthief/riftbound-protocol'
import type { GameState } from '../state/types.js'
import type { DeckConfig } from '../match/state.js'
import {
  createMatch,
  submitToMatch,
  legalMatchActions,
  viewForMatch,
  type GameEngineFunctions,
} from '../match/index.js'

// ---------------------------------------------------------------------------
// Fixture identifiers
// ---------------------------------------------------------------------------

const p1 = 'player1' as PlayerId
const p2 = 'player2' as PlayerId
const card1 = 'card001' as CardId
const bf1 = 'bf001' as BattlefieldId
const def1 = 'def001' as CardDefId

// ---------------------------------------------------------------------------
// GameState factory
// ---------------------------------------------------------------------------

function makeGameState(
  players: readonly [PlayerId, PlayerId],
  overrides: Partial<GameState> = {},
): GameState {
  const [pa, pb] = players
  return {
    gameId: 'game1' as GameId,
    matchId: 'match1' as MatchId,
    playerIds: [pa, pb],
    cards: {
      [card1]: {
        id: card1,
        defId: def1,
        ownerId: pa,
        exhausted: false,
        buffAmount: 0,
        keywords: [],
        xp: 0,
        counters: {},
        faceDown: false,
      },
    },
    players: {
      [pa]: {
        hand: [],
        mainDeck: [],
        runeDeck: [],
        runePool: [],
        legendZone: 'leg1' as CardId,
        championZone: 'chm1' as CardId,
        base: [],
        resources: { energy: 3, power: 2 },
        points: 0,
      },
      [pb]: {
        hand: [],
        mainDeck: [],
        runeDeck: [],
        runePool: [],
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
    activePlayerId: pa,
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
// DeckConfig fixture
// ---------------------------------------------------------------------------

function makeDeckConfig(): DeckConfig {
  return {
    mainDeck: [def1],
    runeDeck: [],
    legendId: def1,
    championId: def1,
    battlefieldIds: [def1],
  }
}

// ---------------------------------------------------------------------------
// Mock engine
// ---------------------------------------------------------------------------

const mockEngine: GameEngineFunctions = {
  createGame: (config) => makeGameState(config.players),
  submit: (state, _action) => ({ state, events: [] }),
  legalActions: (_state, _playerId) => [],
  viewFor: (_state, _playerId) => ({}) as PlayerView,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createMatch', () => {
  it('initializes MatchState with status=playing, winner=null, gameWins=0', () => {
    const decks = { [p1]: makeDeckConfig(), [p2]: makeDeckConfig() } as Record<PlayerId, DeckConfig>
    const match = createMatch({ players: [p1, p2], decks, seed: 42 }, mockEngine)

    expect(match.status).toBe('playing')
    expect(match.winner).toBeNull()
    expect(match.gameWins[p1]).toBe(0)
    expect(match.gameWins[p2]).toBe(0)
  })

  it('sets currentGame from engine.createGame', () => {
    const decks = { [p1]: makeDeckConfig(), [p2]: makeDeckConfig() } as Record<PlayerId, DeckConfig>
    const createdGame = makeGameState([p1, p2])
    const engine: GameEngineFunctions = {
      ...mockEngine,
      createGame: vi.fn(() => createdGame),
    }
    const match = createMatch({ players: [p1, p2], decks, seed: 1 }, engine)

    expect(match.currentGame).toBe(createdGame)
    expect(engine.createGame).toHaveBeenCalledOnce()
  })

  it('stores playerIds and decks on the match', () => {
    const decks = { [p1]: makeDeckConfig(), [p2]: makeDeckConfig() } as Record<PlayerId, DeckConfig>
    const match = createMatch({ players: [p1, p2], decks, seed: 7 }, mockEngine)

    expect(match.playerIds).toEqual([p1, p2])
    expect(match.decks).toBe(decks)
  })
})

describe('submitToMatch', () => {
  it('delegates to engine.submit and updates currentGame', () => {
    const decks = { [p1]: makeDeckConfig(), [p2]: makeDeckConfig() } as Record<PlayerId, DeckConfig>
    const match = createMatch({ players: [p1, p2], decks, seed: 1 }, mockEngine)
    const newGame = makeGameState([p1, p2], { turnNumber: 2 })
    const engine: GameEngineFunctions = {
      ...mockEngine,
      submit: vi.fn(() => ({ state: newGame, events: [] })),
    }
    const action: Action = { type: 'EndTurn', playerId: p1 }
    const { matchState: updated } = submitToMatch(match, action, engine)

    expect(engine.submit).toHaveBeenCalledWith(match.currentGame, action)
    expect(updated.currentGame).toBe(newGame)
  })

  it('increments gameWins when a game ends with a winner', () => {
    const decks = { [p1]: makeDeckConfig(), [p2]: makeDeckConfig() } as Record<PlayerId, DeckConfig>
    const match = createMatch({ players: [p1, p2], decks, seed: 1 }, mockEngine)
    const endedGame = makeGameState([p1, p2], { status: 'ended', winner: p1 })
    const engine: GameEngineFunctions = {
      ...mockEngine,
      submit: () => ({ state: endedGame, events: [] }),
    }
    const action: Action = { type: 'EndTurn', playerId: p1 }
    const { matchState: updated } = submitToMatch(match, action, engine)

    expect(updated.gameWins[p1]).toBe(1)
    expect(updated.gameWins[p2]).toBe(0)
  })

  it('sets matchState.status to ended when gameWins[winner] >= 2', () => {
    const decks = { [p1]: makeDeckConfig(), [p2]: makeDeckConfig() } as Record<PlayerId, DeckConfig>
    // Start with p1 already having 1 win
    const initialMatch = createMatch({ players: [p1, p2], decks, seed: 1 }, mockEngine)
    const matchWithOneWin = { ...initialMatch, gameWins: { [p1]: 1, [p2]: 0 } as Record<PlayerId, number> }

    const endedGame = makeGameState([p1, p2], { status: 'ended', winner: p1 })
    const engine: GameEngineFunctions = {
      ...mockEngine,
      submit: () => ({ state: endedGame, events: [] }),
    }
    const action: Action = { type: 'EndTurn', playerId: p1 }
    const { matchState: updated } = submitToMatch(matchWithOneWin, action, engine)

    expect(updated.gameWins[p1]).toBe(2)
    expect(updated.status).toBe('ended')
    expect(updated.winner).toBe(p1)
  })

  it('does not end match when gameWins[winner] < 2', () => {
    const decks = { [p1]: makeDeckConfig(), [p2]: makeDeckConfig() } as Record<PlayerId, DeckConfig>
    const match = createMatch({ players: [p1, p2], decks, seed: 1 }, mockEngine)
    const endedGame = makeGameState([p1, p2], { status: 'ended', winner: p1 })
    const engine: GameEngineFunctions = {
      ...mockEngine,
      submit: () => ({ state: endedGame, events: [] }),
    }
    const action: Action = { type: 'EndTurn', playerId: p1 }
    const { matchState: updated } = submitToMatch(match, action, engine)

    expect(updated.status).toBe('playing')
    expect(updated.winner).toBeNull()
  })

  it('returns events from engine.submit', () => {
    const decks = { [p1]: makeDeckConfig(), [p2]: makeDeckConfig() } as Record<PlayerId, DeckConfig>
    const match = createMatch({ players: [p1, p2], decks, seed: 1 }, mockEngine)
    const stubEvents = [{ type: 'TurnStarted' as const, turnNumber: 2, activePlayerId: p2 }]
    const engine: GameEngineFunctions = {
      ...mockEngine,
      submit: () => ({ state: match.currentGame, events: stubEvents }),
    }
    const action: Action = { type: 'EndTurn', playerId: p1 }
    const { events } = submitToMatch(match, action, engine)

    expect(events).toBe(stubEvents)
  })
})

describe('legalMatchActions', () => {
  it('returns empty array when match is ended', () => {
    const decks = { [p1]: makeDeckConfig(), [p2]: makeDeckConfig() } as Record<PlayerId, DeckConfig>
    const match = createMatch({ players: [p1, p2], decks, seed: 1 }, mockEngine)
    const endedMatch = { ...match, status: 'ended' as const, winner: p1 }
    const engine: GameEngineFunctions = {
      ...mockEngine,
      legalActions: vi.fn(() => []),
    }
    const actions = legalMatchActions(endedMatch, p1, engine)

    expect(actions).toEqual([])
    expect(engine.legalActions).not.toHaveBeenCalled()
  })

  it('delegates to engine.legalActions when match is playing', () => {
    const decks = { [p1]: makeDeckConfig(), [p2]: makeDeckConfig() } as Record<PlayerId, DeckConfig>
    const match = createMatch({ players: [p1, p2], decks, seed: 1 }, mockEngine)
    const stubActions: Action[] = [{ type: 'EndTurn', playerId: p1 }]
    const engine: GameEngineFunctions = {
      ...mockEngine,
      legalActions: vi.fn(() => stubActions),
    }
    const actions = legalMatchActions(match, p1, engine)

    expect(engine.legalActions).toHaveBeenCalledWith(match.currentGame, p1)
    expect(actions).toBe(stubActions)
  })
})

describe('viewForMatch', () => {
  it('delegates to engine.viewFor', () => {
    const decks = { [p1]: makeDeckConfig(), [p2]: makeDeckConfig() } as Record<PlayerId, DeckConfig>
    const match = createMatch({ players: [p1, p2], decks, seed: 1 }, mockEngine)
    const stubView = { self: {}, opponent: {}, shared: {} } as unknown as PlayerView
    const engine: GameEngineFunctions = {
      ...mockEngine,
      viewFor: vi.fn(() => stubView),
    }
    const view = viewForMatch(match, p1, engine)

    expect(engine.viewFor).toHaveBeenCalledWith(match.currentGame, p1)
    expect(view).toBe(stubView)
  })
})
