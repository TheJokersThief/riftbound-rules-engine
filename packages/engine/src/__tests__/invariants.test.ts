import { createCardCatalog, defaultSnapshotSource } from '@thejokersthief/riftbound-card-catalog'
import { playFuzzGame } from '@thejokersthief/riftbound-test-helpers'
import { describe, expect, it } from 'vitest'

const catalog = await createCardCatalog(defaultSnapshotSource)
const SEEDS = 10

describe('engine invariants', () => {
  it('card count is conserved across all state transitions', () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      const { states } = playFuzzGame(seed, catalog, 50)
      if (states.length === 0) continue
      const initial = Object.keys(states[0]!.cards).length
      for (const state of states) {
        expect(Object.keys(state.cards).length).toBe(initial)
      }
    }
  })

  it('points are non-decreasing for both players', () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      const { states } = playFuzzGame(seed, catalog, 50)
      for (let i = 1; i < states.length; i++) {
        const prev = states[i - 1]!
        const curr = states[i]!
        for (const pid of curr.playerIds) {
          expect(curr.players[pid]?.points ?? 0).toBeGreaterThanOrEqual(
            prev.players[pid]?.points ?? 0
          )
        }
      }
    }
  })

  it('scoredThisTurn has no duplicate battlefieldIds per player', () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      const { states } = playFuzzGame(seed, catalog, 50)
      for (const state of states) {
        for (const pid of state.playerIds) {
          const scored = state.scoredThisTurn[pid] ?? []
          expect(scored.length).toBe(new Set(scored).size)
        }
      }
    }
  })
})
