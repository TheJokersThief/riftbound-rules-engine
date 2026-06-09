import { describe, expect, it } from 'vitest'
import { ActionSchema } from './actions.js'
import { DecisionRequestSchema } from './decisions.js'
import { GameEventSchema } from './events.js'

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
    const result = GameEventSchema.safeParse({ type: 'GameStarted', gameId: 'g1', playerIds: ['p1', 'p2'] })
    expect(result.success).toBe(true)
  })
})

describe('DecisionRequestSchema', () => {
  it('accepts a valid PriorityWindow decision', () => {
    const result = DecisionRequestSchema.safeParse({ type: 'PriorityWindow', playerId: 'p1' })
    expect(result.success).toBe(true)
  })
})
