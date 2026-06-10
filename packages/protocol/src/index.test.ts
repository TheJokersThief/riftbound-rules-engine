import { describe, expect, it } from 'vitest'
import { ActionSchema } from './actions.js'
import { DecisionRequestSchema } from './decisions.js'
import { GameEventSchema } from './events.js'
import { PlayerViewSchema } from './view.js'

describe('ActionSchema', () => {
  it('accepts a valid PlayCard action', () => {
    const result = ActionSchema.safeParse({ type: 'PlayCard', playerId: 'p1', cardId: 'c1' })
    expect(result.success).toBe(true)
  })

  it('rejects PlayCard missing cardId', () => {
    const result = ActionSchema.safeParse({ type: 'PlayCard', playerId: 'p1' })
    expect(result.success).toBe(false)
  })

  it('rejects an unknown action type', () => {
    const result = ActionSchema.safeParse({ type: 'UnknownType', playerId: 'p1' })
    expect(result.success).toBe(false)
  })
})

describe('GameEventSchema', () => {
  it('accepts a valid GameStarted event', () => {
    const result = GameEventSchema.safeParse({
      type: 'GameStarted',
      gameId: 'g1',
      playerIds: ['p1', 'p2'],
    })
    expect(result.success).toBe(true)
  })
})

describe('DecisionRequestSchema', () => {
  it('accepts a valid PriorityWindow decision', () => {
    const result = DecisionRequestSchema.safeParse({ type: 'PriorityWindow', playerId: 'p1' })
    expect(result.success).toBe(true)
  })

  it('rejects ChooseTargets with max: 0 (violates positive())', () => {
    const result = DecisionRequestSchema.safeParse({
      type: 'ChooseTargets',
      playerId: 'p1',
      decisionId: 'd1',
      prompt: 'Pick a target',
      min: 0,
      max: 0,
    })
    expect(result.success).toBe(false)
  })

  it('accepts a valid ChooseMulligan decision', () => {
    const result = DecisionRequestSchema.safeParse({
      type: 'ChooseMulligan',
      playerId: 'p1',
      handSize: 5,
    })
    expect(result.success).toBe(true)
  })
})

describe('PlayerViewSchema', () => {
  const minimalCardInstance = {
    cardId: 'c1',
    defId: null,
    exhausted: false,
    buffAmount: 0,
    keywords: [],
    counters: {},
    hidden: false,
    faceDown: false,
  }

  const minimalPlayerState = {
    playerId: 'p1',
    mainDeck: { count: 40 },
    runeDeck: { count: 10 },
    runePool: [],
    legend: minimalCardInstance,
    champion: minimalCardInstance,
    battlefield: null,
    base: [],
    resources: { energy: 0, power: 0 },
    points: 0,
  }

  it('accepts a valid PlayerView object', () => {
    const result = PlayerViewSchema.safeParse({
      self: { ...minimalPlayerState, hand: [] },
      opponent: { ...minimalPlayerState, playerId: 'p2', handCount: 3 },
      shared: {
        gameId: 'g1',
        matchId: 'm1',
        turnNumber: 1,
        activePlayerId: 'p1',
        phase: 'Main',
        chain: [],
        pendingDecision: null,
        matchRecord: { wins: {} },
      },
    })
    expect(result.success).toBe(true)
  })
})
