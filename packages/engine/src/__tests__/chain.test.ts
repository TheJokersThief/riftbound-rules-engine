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
import type { EffectFrame } from '../state/stack.js'
import type { EffectProgram, EffectNode, SelectorNode } from '@thejokersthief/riftbound-effect-ir'
import { createRulesQuery } from '../rules-query/index.js'
import { collectTriggers, drainHot, openShowdown, closeShowdown, advance } from '../chain/index.js'

// ---------------------------------------------------------------------------
// Fixture identifiers
// ---------------------------------------------------------------------------

const p1 = 'player1' as PlayerId
const p2 = 'player2' as PlayerId
const card1 = 'card001' as CardId
const card2 = 'card002' as CardId
const bf1 = 'bf001' as BattlefieldId
const def1 = 'def001' as CardDefId
const def2 = 'def002' as CardDefId

// ---------------------------------------------------------------------------
// Card definition fixtures
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
// Shared selector fixture
// ---------------------------------------------------------------------------

const battlefieldSelector: SelectorNode = {
  scope: 'Any',
  objectType: 'Unit',
  location: { type: 'AtBattlefields' },
  filters: [],
  quantity: { type: 'All' },
  chooser: 'None',
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
      [card1]: {
        id: card1,
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
        hand: [],
        mainDeck: ['deckCard1' as CardId, 'deckCard2' as CardId],
        runeDeck: [],
        runePool: [],
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
        units: [card1],
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

function makeEffectFrame(remaining: EffectNode[], targets: CardId[] = []): EffectFrame {
  return {
    type: 'Effect',
    sourceId: card1,
    controller: p1,
    remaining,
    targets,
  }
}

// ---------------------------------------------------------------------------
// collectTriggers tests
// ---------------------------------------------------------------------------

describe('collectTriggers()', () => {
  it('with no programs returns state unchanged (hotQueue still empty)', () => {
    const state = makeState()
    const query = createRulesQuery(state, mockCatalog)
    const programs: ReadonlyMap<string, EffectProgram> = new Map()
    const events = [{ type: 'CardPlayed' as const, playerId: p1, cardId: card1 }]

    const result = collectTriggers(state, events, programs, mockCatalog, query)
    expect(result).toBe(state) // exact same reference
    expect(result.hotQueue).toHaveLength(0)
  })

  it('with a WhenPlayed trigger and a CardPlayed event adds to hotQueue', () => {
    const state = makeState()
    const query = createRulesQuery(state, mockCatalog)

    const program: EffectProgram = {
      type: 'Compiled',
      abilities: [
        {
          type: 'Triggered',
          event: { type: 'WhenPlayed' },
          effect: { type: 'Draw', player: 'You', count: 1 },
        },
      ],
    }
    const programs: ReadonlyMap<string, EffectProgram> = new Map([[def1, program]])
    const events = [{ type: 'CardPlayed' as const, playerId: p1, cardId: card1 }]

    const result = collectTriggers(state, events, programs, mockCatalog, query)
    expect(result.hotQueue).toHaveLength(1)
    expect(result.hotQueue[0]!.sourceId).toBe(card1)
    expect(result.hotQueue[0]!.abilityIndex).toBe(0)
    expect(result.hotQueue[0]!.controller).toBe(p1)
    expect(result.hotQueue[0]!.context.triggerEvent.type).toBe('WhenPlayed')
  })

  it('with AtStartOfTurn trigger and TurnStarted event adds to hotQueue', () => {
    const state = makeState()
    const query = createRulesQuery(state, mockCatalog)

    const program: EffectProgram = {
      type: 'Compiled',
      abilities: [
        {
          type: 'Triggered',
          event: { type: 'AtStartOfTurn' },
          effect: { type: 'Draw', player: 'You', count: 1 },
        },
      ],
    }
    const programs: ReadonlyMap<string, EffectProgram> = new Map([[def1, program]])
    const events = [{ type: 'TurnStarted' as const, turnNumber: 2, activePlayerId: p1 }]

    const result = collectTriggers(state, events, programs, mockCatalog, query)
    expect(result.hotQueue).toHaveLength(1)
    expect(result.hotQueue[0]!.context.triggerEvent.type).toBe('AtStartOfTurn')
  })
})

// ---------------------------------------------------------------------------
// drainHot tests
// ---------------------------------------------------------------------------

describe('drainHot()', () => {
  it('with empty hotQueue returns state unchanged', () => {
    const state = makeState()
    const query = createRulesQuery(state, mockCatalog)
    const programs: ReadonlyMap<string, EffectProgram> = new Map()

    const result = drainHot(state, query, mockCatalog, programs)
    expect(result.events).toHaveLength(0)
    expect(result.state.hotQueue).toHaveLength(0)
  })

  it('processes a triggered ability and produces events', () => {
    const program: EffectProgram = {
      type: 'Compiled',
      abilities: [
        {
          type: 'Triggered',
          event: { type: 'WhenPlayed' },
          effect: { type: 'Ready', targets: battlefieldSelector },
        },
      ],
    }
    const programs: ReadonlyMap<string, EffectProgram> = new Map([[def1, program]])

    const state = makeState({
      hotQueue: [
        {
          sourceId: card1,
          abilityIndex: 0,
          controller: p1,
          context: { triggerEvent: { type: 'WhenPlayed' } },
        },
      ],
    })
    const query = createRulesQuery(state, mockCatalog)

    const result = drainHot(state, query, mockCatalog, programs)
    expect(result.state.hotQueue).toHaveLength(0)
    // Ready action emits CardReadied for card1
    expect(result.events.some(e => e.type === 'CardReadied')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// openShowdown tests
// ---------------------------------------------------------------------------

describe('openShowdown()', () => {
  it('emits ShowdownOpened and sets pendingDecision to FocusWindow', () => {
    const state = makeState()

    const result = openShowdown(state, bf1, 'Combat')

    expect(result.events).toHaveLength(1)
    expect(result.events[0]!.type).toBe('ShowdownOpened')

    expect(result.state.pendingDecision).not.toBeNull()
    expect(result.state.pendingDecision?.type).toBe('FocusWindow')
    const dec = result.state.pendingDecision
    if (dec?.type === 'FocusWindow') {
      expect(dec.playerId).toBe(p1)
      expect(dec.battlefieldId).toBe(bf1)
    }

    expect(result.state.chain.showdown).not.toBeNull()
    expect(result.state.chain.showdown?.battlefieldId).toBe(bf1)
    expect(result.state.chain.showdown?.kind).toBe('Combat')
  })
})

// ---------------------------------------------------------------------------
// closeShowdown tests
// ---------------------------------------------------------------------------

describe('closeShowdown()', () => {
  it('emits ShowdownClosed and clears chain.showdown', () => {
    const state = makeState({
      chain: {
        isOpen: true,
        items: [],
        priority: null,
        focus: p1,
        showdown: { battlefieldId: bf1, kind: 'Combat' },
      },
    })

    const result = closeShowdown(state)

    expect(result.events).toHaveLength(1)
    expect(result.events[0]!.type).toBe('ShowdownClosed')
    expect(result.state.chain.showdown).toBeNull()
    expect(result.state.chain.focus).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// advance() tests
// ---------------------------------------------------------------------------

describe('advance()', () => {
  it('with empty stack and no chain items returns state unchanged', () => {
    const state = makeState()
    const query = createRulesQuery(state, mockCatalog)

    const result = advance(state, query, mockCatalog)
    expect(result.events).toHaveLength(0)
    expect(result.state.resolutionStack).toHaveLength(0)
    expect(result.state.hotQueue).toHaveLength(0)
  })

  it('returns immediately when pendingDecision is already set', () => {
    const state = makeState({
      pendingDecision: { type: 'PriorityWindow', playerId: p1 },
    })
    const query = createRulesQuery(state, mockCatalog)

    const result = advance(state, query, mockCatalog)
    expect(result.events).toHaveLength(0)
    expect(result.state).toBe(state) // exact reference, nothing changed
  })

  it('with EffectFrame on stack runs step loop and produces events', () => {
    const drawNode: EffectNode = { type: 'Draw', player: 'You', count: 1 }
    const frame = makeEffectFrame([drawNode])
    const state = makeState({ resolutionStack: [frame] })
    const query = createRulesQuery(state, mockCatalog)

    const result = advance(state, query, mockCatalog)
    // Draw 1 card from p1's deck
    expect(result.events.some(e => e.type === 'CardDrawn')).toBe(true)
    expect(result.state.resolutionStack).toHaveLength(0)
  })

  it('drains hotQueue before running interpreter', () => {
    // Card1 has a WhenPlayed triggered ability that draws a card
    const program: EffectProgram = {
      type: 'Compiled',
      abilities: [
        {
          type: 'Triggered',
          event: { type: 'WhenPlayed' },
          effect: { type: 'Draw', player: 'You', count: 1 },
        },
      ],
    }
    const programs: ReadonlyMap<string, EffectProgram> = new Map([[def1, program]])

    const state = makeState({
      hotQueue: [
        {
          sourceId: card1,
          abilityIndex: 0,
          controller: p1,
          context: { triggerEvent: { type: 'WhenPlayed' } },
        },
      ],
    })
    const query = createRulesQuery(state, mockCatalog)

    const result = advance(state, query, mockCatalog, programs)
    expect(result.state.hotQueue).toHaveLength(0)
    expect(result.events.some(e => e.type === 'CardDrawn')).toBe(true)
  })
})
