import { describe, it, expect } from 'vitest'
import type {
  PlayerId,
  CardId,
  BattlefieldId,
  CardDefId,
  GameId,
  MatchId,
} from '@thejokersthief/riftbound-protocol'
import { PlayerViewSchema } from '@thejokersthief/riftbound-protocol'
import type { CardCatalog, CardDefinition } from '@thejokersthief/riftbound-card-catalog'
import type { GameState } from '../state/types.js'
import { viewFor } from '../visibility/index.js'

// ---------------------------------------------------------------------------
// Fixture identifiers
// ---------------------------------------------------------------------------

const p1 = 'player1' as PlayerId
const p2 = 'player2' as PlayerId
const handCard1 = 'hand001' as CardId
const handCard2 = 'hand002' as CardId
const legCard1 = 'leg001' as CardId
const legCard2 = 'leg002' as CardId
const chmCard1 = 'chm001' as CardId
const chmCard2 = 'chm002' as CardId
const baseCard1 = 'base001' as CardId
const baseCard2 = 'base002' as CardId
const deckCard1 = 'deck001' as CardId
const deckCard2 = 'deck002' as CardId
const def1 = 'def001' as CardDefId
const def2 = 'def002' as CardDefId
const bf1 = 'bf001' as BattlefieldId

// ---------------------------------------------------------------------------
// Mock catalog
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
  keywords: ['Brave'],
}

const unit2Def: CardDefinition = {
  id: def2,
  name: 'Cheap Unit',
  cardType: 'Unit',
  set: 'core',
  rarity: 'common',
  abilityText: '',
  might: 1,
  playCost: { energy: 1, power: 0, runes: [] },
  deckZone: 'Main',
  keywords: [],
}

const defs: Record<CardDefId, CardDefinition> = {
  [def1]: unitDef,
  [def2]: unit2Def,
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
// State factory
// ---------------------------------------------------------------------------

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    gameId: 'game1' as GameId,
    matchId: 'match1' as MatchId,
    playerIds: [p1, p2],
    cards: {
      [handCard1]: {
        id: handCard1,
        defId: def1,
        ownerId: p1,
        exhausted: false,
        buffAmount: 5,
        keywords: ['Swift'],
        xp: 0,
        counters: {},
        faceDown: false,
      },
      [handCard2]: {
        id: handCard2,
        defId: def2,
        ownerId: p1,
        exhausted: true,
        buffAmount: 0,
        keywords: [],
        xp: 0,
        counters: { poison: 2 },
        faceDown: false,
      },
      [legCard1]: {
        id: legCard1,
        defId: def1,
        ownerId: p1,
        exhausted: false,
        buffAmount: 0,
        keywords: [],
        xp: 0,
        counters: {},
        faceDown: false,
      },
      [legCard2]: {
        id: legCard2,
        defId: def2,
        ownerId: p2,
        exhausted: false,
        buffAmount: 0,
        keywords: [],
        xp: 0,
        counters: {},
        faceDown: false,
      },
      [chmCard1]: {
        id: chmCard1,
        defId: def1,
        ownerId: p1,
        exhausted: false,
        buffAmount: 0,
        keywords: [],
        xp: 0,
        counters: {},
        faceDown: false,
      },
      [chmCard2]: {
        id: chmCard2,
        defId: def2,
        ownerId: p2,
        exhausted: false,
        buffAmount: 0,
        keywords: [],
        xp: 0,
        counters: {},
        faceDown: false,
      },
      [baseCard1]: {
        id: baseCard1,
        defId: def1,
        ownerId: p1,
        exhausted: false,
        buffAmount: 0,
        keywords: [],
        xp: 0,
        counters: {},
        faceDown: false,
      },
      [baseCard2]: {
        id: baseCard2,
        defId: def2,
        ownerId: p2,
        exhausted: false,
        buffAmount: 0,
        keywords: [],
        xp: 0,
        counters: {},
        faceDown: true, // face-down opponent base card
      },
    },
    players: {
      [p1]: {
        hand: [handCard1, handCard2],
        mainDeck: [deckCard1, deckCard2],
        runeDeck: [deckCard1],
        runePool: [],
        legendZone: legCard1,
        championZone: chmCard1,
        base: [baseCard1],
        resources: { energy: 3, power: 2 },
        points: 1,
      },
      [p2]: {
        hand: [baseCard2], // re-use a card id just to give p2 a hand card
        mainDeck: [],
        runeDeck: [],
        runePool: [],
        legendZone: legCard2,
        championZone: chmCard2,
        base: [baseCard2],
        resources: { energy: 1, power: 0 },
        points: 0,
      },
    },
    battlefields: {
      [bf1]: {
        id: bf1,
        cardId: baseCard1,
        controllerId: p1,
        units: [],
      },
    },
    turnNumber: 3,
    activePlayerId: p1,
    phase: 'Main',
    chain: { isOpen: false, items: [], priority: null, focus: null, showdown: null },
    resolutionStack: [],
    pendingDecision: null,
    rng: { seed: 42 },
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
// Tests
// ---------------------------------------------------------------------------

describe('viewFor()', () => {
  it('returns the correct playerId in self', () => {
    const state = makeState()
    const view = viewFor(state, p1, mockCatalog)
    expect(view.self.playerId).toBe(p1)
  })

  it('returns opponent handCount (not a hand array)', () => {
    const state = makeState()
    const view = viewFor(state, p1, mockCatalog)
    // p2 has 1 card in hand
    expect(view.opponent.handCount).toBe(1)
    // OpponentView has no `hand` property
    expect((view.opponent as Record<string, unknown>)['hand']).toBeUndefined()
  })

  it('reflects hand cards in self.hand as CardInstanceView', () => {
    const state = makeState()
    const view = viewFor(state, p1, mockCatalog)
    expect(view.self.hand).toHaveLength(2)
    const first = view.self.hand[0]!
    expect(first.cardId).toBe(handCard1)
    expect(first.defId).toBe(def1)
    expect(first.hidden).toBe(false)
    expect(first.buffAmount).toBe(5)
    // keywords should merge catalog base keywords + instance keywords
    expect(first.keywords).toContain('Brave') // from def
    expect(first.keywords).toContain('Swift') // from instance
  })

  it('reflects mainDeck.count correctly', () => {
    const state = makeState()
    const view = viewFor(state, p1, mockCatalog)
    // p1 has 2 main deck cards, p2 has 0
    expect(view.self.mainDeck.count).toBe(2)
    expect(view.opponent.mainDeck.count).toBe(0)
  })

  it('correctly redacts opponent face-down base cards (hidden: true, defId: null)', () => {
    const state = makeState()
    const view = viewFor(state, p1, mockCatalog)
    // p2 base has baseCard2 which is faceDown: true
    expect(view.opponent.base).toHaveLength(1)
    const oppBase = view.opponent.base[0]!
    expect(oppBase.hidden).toBe(true)
    expect(oppBase.defId).toBeNull()
    expect(oppBase.cardId).toBe(baseCard2)
  })

  it('shows opponent face-up base cards (hidden: false)', () => {
    // Make baseCard2 face-up
    const state = makeState()
    const faceUpState: GameState = {
      ...state,
      cards: {
        ...state.cards,
        [baseCard2]: {
          ...state.cards[baseCard2]!,
          faceDown: false,
        },
      },
    }
    const view = viewFor(faceUpState, p1, mockCatalog)
    const oppBase = view.opponent.base[0]!
    expect(oppBase.hidden).toBe(false)
    expect(oppBase.defId).toBe(def2)
  })

  it('shared.gameId matches state.gameId', () => {
    const state = makeState()
    const view = viewFor(state, p1, mockCatalog)
    expect(view.shared.gameId).toBe(state.gameId)
  })

  it('shared.pendingDecision is null when no decision is set', () => {
    const state = makeState()
    const view = viewFor(state, p1, mockCatalog)
    expect(view.shared.pendingDecision).toBeNull()
  })

  it('passes PlayerViewSchema validation with no errors', () => {
    const state = makeState()
    const view = viewFor(state, p1, mockCatalog)
    const result = PlayerViewSchema.safeParse(view)
    expect(result.success).toBe(true)
    if (!result.success) {
      // Surface any issues for debugging
      console.error(result.error.issues)
    }
  })

  it('reflects buffAmount for a card with a known buffAmount', () => {
    // handCard2 has buffAmount: 0; handCard1 has buffAmount: 5
    const state = makeState()
    const view = viewFor(state, p1, mockCatalog)
    const card = view.self.hand.find(c => c.cardId === handCard1)!
    expect(card.buffAmount).toBe(5)
    const card2 = view.self.hand.find(c => c.cardId === handCard2)!
    expect(card2.buffAmount).toBe(0)
  })
})
