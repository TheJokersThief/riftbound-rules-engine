import type {
  BattlefieldId,
  CardDefId,
  CardId,
  GameId,
  MatchId,
  PlayerId,
} from '@thejokersthief/riftbound-protocol'
import {
  toBattlefieldId,
  toCardDefId,
  toCardId,
  toGameId,
  toMatchId,
  toPlayerId,
} from '@thejokersthief/riftbound-protocol'
import { describe, expect, it } from 'vitest'
import { nextInt, nextRng, shuffle } from './rng.js'
import { fold } from './state/fold.js'
import { deserialize, serialize } from './state/serialization.js'
import { StackFrameSchema } from './state/stack.js'
import type { GameState } from './state/types.js'
import { GameStateSchema } from './state/types.js'

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const p1 = toPlayerId('player1')
const p2 = toPlayerId('player2')
const card1 = toCardId('card001')
const bf1 = toBattlefieldId('bf001')

function makeState(): GameState {
  return {
    gameId: toGameId('game1'),
    matchId: toMatchId('match1'),
    playerIds: [p1, p2],
    cards: {
      [card1]: {
        id: card1,
        defId: toCardDefId('def001'),
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
        hand: [],
        mainDeck: [],
        runeDeck: [],
        runePool: [],
        legendZone: toCardId('leg1'),
        championZone: toCardId('chm1'),
        base: [],
        resources: { energy: 3, power: 2 },
        points: 0,
      },
      [p2]: {
        hand: [],
        mainDeck: [],
        runeDeck: [],
        runePool: [],
        legendZone: toCardId('leg2'),
        championZone: toCardId('chm2'),
        base: [],
        resources: { energy: 3, power: 2 },
        points: 0,
      },
    },
    battlefields: {
      [bf1]: {
        id: bf1,
        cardId: toCardId('bfcard1'),
        controllerId: null,
        units: [],
      },
    },
    turnNumber: 1,
    activePlayerId: p1,
    phase: 'Start',
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
  }
}

// ---------------------------------------------------------------------------
// RNG tests
// ---------------------------------------------------------------------------

describe('nextRng', () => {
  it('is deterministic and value is in [0, 1)', () => {
    const { value, next } = nextRng({ seed: 0 })
    expect(value).toBeGreaterThanOrEqual(0)
    expect(value).toBeLessThan(1)
    // Same seed produces same output
    const { value: value2 } = nextRng({ seed: 0 })
    expect(value).toBe(value2)
    // Next seed differs from initial
    expect(next.seed).not.toBe(0)
  })
})

describe('nextInt', () => {
  it('returns value in [0, max)', () => {
    const { value } = nextInt({ seed: 42 }, 10)
    expect(value).toBeGreaterThanOrEqual(0)
    expect(value).toBeLessThan(10)
    expect(Number.isInteger(value)).toBe(true)
  })
})

describe('shuffle', () => {
  it('returns a permutation of the input', () => {
    const input = [1, 2, 3, 4, 5]
    const { result } = shuffle(input, { seed: 1 })
    expect(result).toHaveLength(input.length)
    expect(result.sort((a, b) => a - b)).toEqual(input)
  })

  it('is deterministic — same input, same output', () => {
    const input = [1, 2, 3, 4, 5]
    const { result: r1 } = shuffle(input, { seed: 1 })
    const { result: r2 } = shuffle(input, { seed: 1 })
    expect(r1).toEqual(r2)
  })
})

// ---------------------------------------------------------------------------
// fold tests
// ---------------------------------------------------------------------------

describe('fold', () => {
  it('CardExhausted — card is exhausted, original state unchanged', () => {
    const state = makeState()
    const next = fold(state, { type: 'CardExhausted', cardId: card1 })
    expect(next.cards[card1]!.exhausted).toBe(true)
    // Immutability: original unchanged
    expect(state.cards[card1]!.exhausted).toBe(false)
  })

  it('CardReadied — card is unexhausted', () => {
    const state: GameState = {
      ...makeState(),
      cards: {
        [card1]: { ...makeState().cards[card1]!, exhausted: true },
      },
    }
    const next = fold(state, { type: 'CardReadied', cardId: card1 })
    expect(next.cards[card1]!.exhausted).toBe(false)
  })

  it('ResourceAdded — resources updated', () => {
    const state = makeState()
    const next = fold(state, { type: 'ResourceAdded', playerId: p1, energy: 2, power: 1 })
    expect(next.players[p1]!.resources.energy).toBe(5)
    expect(next.players[p1]!.resources.power).toBe(3)
  })

  it('PointScored — points incremented', () => {
    const state = makeState()
    const next = fold(state, {
      type: 'PointScored',
      playerId: p1,
      method: 'Conquer',
      battlefieldId: null,
    })
    expect(next.players[p1]!.points).toBe(1)
  })

  it('CardBuffed — buffAmount updated', () => {
    const state = makeState()
    const next = fold(state, { type: 'CardBuffed', cardId: card1, amount: 2 })
    expect(next.cards[card1]!.buffAmount).toBe(2)
  })

  it('KeywordGranted — keyword added', () => {
    const state = makeState()
    const next = fold(state, { type: 'KeywordGranted', cardId: card1, keyword: 'Swift' })
    expect(next.cards[card1]!.keywords).toContain('Swift')
  })

  it('GameEnded — status=ended, winner set', () => {
    const state = makeState()
    const next = fold(state, { type: 'GameEnded', gameId: toGameId('game1'), winner: p1 })
    expect(next.status).toBe('ended')
    expect(next.winner).toBe(p1)
  })

  it('ChainOpened — chain.isOpen = true', () => {
    const state = makeState()
    const next = fold(state, { type: 'ChainOpened' })
    expect(next.chain.isOpen).toBe(true)
  })

  it('PriorityPassed — chain.priority updated', () => {
    const state = makeState()
    const next = fold(state, { type: 'PriorityPassed', playerId: p2 })
    expect(next.chain.priority).toBe(p2)
  })
})

// ---------------------------------------------------------------------------
// Serialization round-trip
// ---------------------------------------------------------------------------

describe('serialization', () => {
  it('serialize then deserialize round-trips to equal state', () => {
    const state = makeState()
    const json = serialize(state)
    const restored = deserialize(json)
    // Compare serialized forms (accounts for branded string transforms)
    expect(JSON.parse(serialize(restored))).toEqual(JSON.parse(json))
  })
})

// ---------------------------------------------------------------------------
// Schema parsing
// ---------------------------------------------------------------------------

describe('GameStateSchema', () => {
  it('parses a valid GameState', () => {
    const state = makeState()
    const result = GameStateSchema.safeParse(state)
    expect(result.success).toBe(true)
  })
})

describe('StackFrameSchema', () => {
  it('parses an EffectFrame correctly', () => {
    const frame = {
      type: 'Effect' as const,
      sourceId: card1,
      controller: p1,
      remaining: [],
      targets: [],
    }
    const result = StackFrameSchema.safeParse(frame)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.type).toBe('Effect')
    }
  })
})
