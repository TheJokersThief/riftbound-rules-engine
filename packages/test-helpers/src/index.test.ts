import { describe, it, expect } from 'vitest'
import { buildDeck } from './fixtures.js'

describe('test-helpers', () => {
  it('buildDeck returns a valid DeckConfig', () => {
    const deck = buildDeck()
    expect(deck.mainDeck.length).toBeGreaterThanOrEqual(40)
    expect(deck.runeDeck.length).toBe(10)
    expect(deck.battlefieldIds.length).toBe(3)
  })
})
