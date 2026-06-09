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
import type { EffectNode, SelectorNode } from '@thejokersthief/riftbound-effect-ir'
import { createRulesQuery } from '../rules-query/index.js'
import {
  step,
  resolveSelector,
  evalCondition,
  evalNumberExpr,
} from '../interpreter/index.js'

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
  keywords: ['Rush'],
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
// Helper: all-battlefield selector
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
// step() tests
// ---------------------------------------------------------------------------

describe('step()', () => {
  it('returns state unchanged when stack is empty', () => {
    const state = makeState()
    const query = createRulesQuery(state, mockCatalog)
    const result = step(state, query, mockCatalog)
    expect(result.state).toBe(state)
    expect(result.events).toHaveLength(0)
  })

  it('pops a frame with no remaining nodes', () => {
    const frame = makeEffectFrame([])
    const state = makeState({ resolutionStack: [frame] })
    const query = createRulesQuery(state, mockCatalog)
    const result = step(state, query, mockCatalog)
    expect(result.state.resolutionStack).toHaveLength(0)
    expect(result.events).toHaveLength(0)
  })

  it('does not advance for non-Effect top frame', () => {
    const chainFrame = { type: 'Chain' as const, resumeAt: 'Finalize' as const }
    const state = makeState({ resolutionStack: [chainFrame] })
    const query = createRulesQuery(state, mockCatalog)
    const result = step(state, query, mockCatalog)
    expect(result.state.resolutionStack).toHaveLength(1)
    expect(result.events).toHaveLength(0)
  })

  it('flattens a Sequence node into remaining', () => {
    const innerA: EffectNode = { type: 'Ready', targets: battlefieldSelector }
    const innerB: EffectNode = { type: 'Ready', targets: battlefieldSelector }
    const seqNode: EffectNode = { type: 'Sequence', effects: [innerA, innerB] }
    const frame = makeEffectFrame([seqNode])
    const state = makeState({ resolutionStack: [frame] })
    const query = createRulesQuery(state, mockCatalog)

    const result = step(state, query, mockCatalog)
    const topFrame = result.state.resolutionStack[
      result.state.resolutionStack.length - 1
    ] as EffectFrame
    expect(topFrame.remaining).toHaveLength(2)
    expect(topFrame.remaining[0]!.type).toBe('Ready')
    expect(topFrame.remaining[1]!.type).toBe('Ready')
    expect(result.events).toHaveLength(0)
  })

  it('emits CardDrawn events for a Draw action', () => {
    const drawNode: EffectNode = { type: 'Draw', player: 'You', count: 2 }
    const frame = makeEffectFrame([drawNode])
    const state = makeState({ resolutionStack: [frame] })
    const query = createRulesQuery(state, mockCatalog)

    const result = step(state, query, mockCatalog)
    // Draw 2 cards → 2 CardDrawn events
    expect(result.events).toHaveLength(2)
    expect(result.events[0]!.type).toBe('CardDrawn')
    expect(result.events[1]!.type).toBe('CardDrawn')
    // State should reflect the drawn cards
    expect(result.state.players[p1]!.mainDeck.length).toBe(0)
    expect(result.state.players[p1]!.hand.length).toBe(2)
  })

  it('emits CardBuffed event for a Buff action', () => {
    const buffNode: EffectNode = {
      type: 'Buff',
      targets: battlefieldSelector,
      amount: 2,
    }
    const frame = makeEffectFrame([buffNode])
    const state = makeState({ resolutionStack: [frame] })
    const query = createRulesQuery(state, mockCatalog)

    const result = step(state, query, mockCatalog)
    expect(result.events).toHaveLength(1)
    expect(result.events[0]!.type).toBe('CardBuffed')
    const ev = result.events[0]!
    if (ev.type === 'CardBuffed') {
      expect(ev.cardId).toBe(card1)
      expect(ev.amount).toBe(2)
    }
    expect(result.state.cards[card1]!.buffAmount).toBe(2)
  })

  it('adds then-node to remaining when Conditional is true', () => {
    const thenNode: EffectNode = { type: 'Ready', targets: battlefieldSelector }
    const condNode: EffectNode = {
      type: 'Conditional',
      condition: { type: 'IsMyTurn' },
      then: thenNode,
    }
    const frame = makeEffectFrame([condNode])
    // p1 is activePlayerId and card1 owner — IsMyTurn is true
    const state = makeState({ resolutionStack: [frame] })
    const query = createRulesQuery(state, mockCatalog)

    const result = step(state, query, mockCatalog)
    const topFrame = result.state.resolutionStack[
      result.state.resolutionStack.length - 1
    ] as EffectFrame
    expect(topFrame.remaining).toHaveLength(1)
    expect(topFrame.remaining[0]!.type).toBe('Ready')
    expect(result.events).toHaveLength(0)
  })

  it('skips the node when Conditional is false and there is no else', () => {
    const thenNode: EffectNode = { type: 'Ready', targets: battlefieldSelector }
    const condNode: EffectNode = {
      type: 'Conditional',
      // IsPhase 'Channel' — state is 'Main', so false
      condition: { type: 'IsPhase', phase: 'Channel' },
      then: thenNode,
    }
    const frame = makeEffectFrame([condNode])
    const state = makeState({ resolutionStack: [frame] })
    const query = createRulesQuery(state, mockCatalog)

    const result = step(state, query, mockCatalog)
    // Frame should be popped (remaining was empty after consuming condNode)
    expect(result.state.resolutionStack).toHaveLength(0)
    expect(result.events).toHaveLength(0)
  })

  it('creates a ChooseYesNo decision for Optional node', () => {
    const innerNode: EffectNode = { type: 'Ready', targets: battlefieldSelector }
    const optNode: EffectNode = {
      type: 'Optional',
      effect: innerNode,
      prompt: 'Ready a unit?',
    }
    const frame = makeEffectFrame([optNode])
    const state = makeState({ resolutionStack: [frame] })
    const query = createRulesQuery(state, mockCatalog)

    const result = step(state, query, mockCatalog)
    expect(result.state.pendingDecision).not.toBeNull()
    expect(result.state.pendingDecision?.type).toBe('ChooseYesNo')
    const dec = result.state.pendingDecision
    if (dec?.type === 'ChooseYesNo') {
      expect(dec.prompt).toBe('Ready a unit?')
      expect(dec.playerId).toBe(p1)
    }
    expect(result.events).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// resolveSelector() tests
// ---------------------------------------------------------------------------

describe('resolveSelector()', () => {
  it('returns battlefield cards with scope=Any, location=AtBattlefields', () => {
    const state = makeState()
    const query = createRulesQuery(state, mockCatalog)
    const result = resolveSelector(battlefieldSelector, state, card1, query, mockCatalog)
    expect(result).toContain(card1)
  })

  it('returns empty array when no cards match', () => {
    const state = makeState()
    const query = createRulesQuery(state, mockCatalog)
    const selector: SelectorNode = {
      scope: 'Any',
      objectType: 'Unit',
      location: { type: 'InHand' },
      filters: [],
      quantity: { type: 'All' },
      chooser: 'None',
    }
    const result = resolveSelector(selector, state, card1, query, mockCatalog)
    expect(result).toHaveLength(0)
  })

  it('filters by MightGE correctly', () => {
    const state = makeState({
      cards: {
        [card1]: {
          id: card1,
          defId: def1, // might: 3
          ownerId: p1,
          exhausted: false,
          buffAmount: 0,
          keywords: [],
          xp: 0,
          counters: {},
          faceDown: false,
        },
        [card2]: {
          id: card2,
          defId: def2, // might: 1
          ownerId: p1,
          exhausted: false,
          buffAmount: 0,
          keywords: [],
          xp: 0,
          counters: {},
          faceDown: false,
        },
      },
      battlefields: {
        [bf1]: {
          id: bf1,
          cardId: 'bfcard1' as CardId,
          controllerId: null,
          units: [card1, card2],
        },
      },
    })
    const query = createRulesQuery(state, mockCatalog)
    const selector: SelectorNode = {
      scope: 'Any',
      objectType: 'Unit',
      location: { type: 'AtBattlefields' },
      filters: [{ type: 'MightGE', value: 3 }],
      quantity: { type: 'All' },
      chooser: 'None',
    }
    const result = resolveSelector(selector, state, card1, query, mockCatalog)
    expect(result).toContain(card1)
    expect(result).not.toContain(card2)
  })

  it('respects Friendly scope and excludes enemy cards', () => {
    const state = makeState({
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
        [card2]: {
          id: card2,
          defId: def2,
          ownerId: p2, // owned by opponent
          exhausted: false,
          buffAmount: 0,
          keywords: [],
          xp: 0,
          counters: {},
          faceDown: false,
        },
      },
      battlefields: {
        [bf1]: {
          id: bf1,
          cardId: 'bfcard1' as CardId,
          controllerId: null,
          units: [card1, card2],
        },
      },
    })
    const query = createRulesQuery(state, mockCatalog)
    const selector: SelectorNode = {
      scope: 'Friendly',
      objectType: 'Unit',
      location: { type: 'AtBattlefields' },
      filters: [],
      quantity: { type: 'All' },
      chooser: 'None',
    }
    const result = resolveSelector(selector, state, card1, query, mockCatalog)
    expect(result).toContain(card1)
    expect(result).not.toContain(card2)
  })
})

// ---------------------------------------------------------------------------
// evalNumberExpr() tests
// ---------------------------------------------------------------------------

describe('evalNumberExpr()', () => {
  it('returns the literal number directly', () => {
    const state = makeState()
    const query = createRulesQuery(state, mockCatalog)
    expect(evalNumberExpr(5, state, card1, query, mockCatalog)).toBe(5)
    expect(evalNumberExpr(0, state, card1, query, mockCatalog)).toBe(0)
  })

  it('returns selector result count for CountOf', () => {
    const state = makeState()
    const query = createRulesQuery(state, mockCatalog)
    const expr = { type: 'CountOf' as const, selector: battlefieldSelector }
    // card1 is on battlefield
    expect(evalNumberExpr(expr, state, card1, query, mockCatalog)).toBe(1)
  })

  it('returns might of first match for MightOf', () => {
    const state = makeState()
    const query = createRulesQuery(state, mockCatalog)
    const expr = { type: 'MightOf' as const, target: battlefieldSelector }
    // card1 has def1 with might:3, buffAmount:0
    expect(evalNumberExpr(expr, state, card1, query, mockCatalog)).toBe(3)
  })

  it('returns 0 for MightOf when selector matches nothing', () => {
    const state = makeState()
    const query = createRulesQuery(state, mockCatalog)
    const emptySelector: SelectorNode = {
      scope: 'Any',
      objectType: 'Unit',
      location: { type: 'InHand' },
      filters: [],
      quantity: { type: 'All' },
      chooser: 'None',
    }
    const expr = { type: 'MightOf' as const, target: emptySelector }
    expect(evalNumberExpr(expr, state, card1, query, mockCatalog)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// evalCondition() tests
// ---------------------------------------------------------------------------

describe('evalCondition()', () => {
  it('returns true for IsMyTurn when activePlayer owns the source card', () => {
    const state = makeState({ activePlayerId: p1 })
    const query = createRulesQuery(state, mockCatalog)
    expect(evalCondition({ type: 'IsMyTurn' }, state, card1, query, mockCatalog)).toBe(true)
  })

  it('returns false for IsMyTurn when it is not the source owner\'s turn', () => {
    const state = makeState({ activePlayerId: p2 })
    const query = createRulesQuery(state, mockCatalog)
    expect(evalCondition({ type: 'IsMyTurn' }, state, card1, query, mockCatalog)).toBe(false)
  })

  it('returns true for And when all conditions are true', () => {
    const state = makeState({ activePlayerId: p1, phase: 'Main' })
    const query = createRulesQuery(state, mockCatalog)
    const cond = {
      type: 'And' as const,
      conditions: [
        { type: 'IsMyTurn' as const },
        { type: 'IsPhase' as const, phase: 'Main' as const },
      ],
    }
    expect(evalCondition(cond, state, card1, query, mockCatalog)).toBe(true)
  })

  it('returns false for And when any condition is false', () => {
    const state = makeState({ activePlayerId: p1, phase: 'Main' })
    const query = createRulesQuery(state, mockCatalog)
    const cond = {
      type: 'And' as const,
      conditions: [
        { type: 'IsMyTurn' as const },
        { type: 'IsPhase' as const, phase: 'Channel' as const },
      ],
    }
    expect(evalCondition(cond, state, card1, query, mockCatalog)).toBe(false)
  })

  it('inverts result for Not', () => {
    const state = makeState({ activePlayerId: p2 })
    const query = createRulesQuery(state, mockCatalog)
    // IsMyTurn is false (p2 is active, card1 is owned by p1)
    const cond = { type: 'Not' as const, condition: { type: 'IsMyTurn' as const } }
    expect(evalCondition(cond, state, card1, query, mockCatalog)).toBe(true)
  })

  it('returns true for IsPhase when phase matches', () => {
    const state = makeState({ phase: 'Main' })
    const query = createRulesQuery(state, mockCatalog)
    expect(
      evalCondition({ type: 'IsPhase', phase: 'Main' }, state, card1, query, mockCatalog),
    ).toBe(true)
  })

  it('returns true for SelectorNonEmpty when selector has results', () => {
    const state = makeState()
    const query = createRulesQuery(state, mockCatalog)
    const cond = { type: 'SelectorNonEmpty' as const, selector: battlefieldSelector }
    expect(evalCondition(cond, state, card1, query, mockCatalog)).toBe(true)
  })

  it('returns false for SelectorNonEmpty when selector is empty', () => {
    const state = makeState()
    const query = createRulesQuery(state, mockCatalog)
    const emptySelector: SelectorNode = {
      scope: 'Any',
      objectType: 'Unit',
      location: { type: 'InHand' },
      filters: [],
      quantity: { type: 'All' },
      chooser: 'None',
    }
    const cond = { type: 'SelectorNonEmpty' as const, selector: emptySelector }
    expect(evalCondition(cond, state, card1, query, mockCatalog)).toBe(false)
  })
})
