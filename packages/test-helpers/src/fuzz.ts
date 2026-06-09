import type { CardCatalog } from '@thejokersthief/riftbound-card-catalog'
import type { GameState, MatchState } from '@thejokersthief/riftbound-engine'
import type { PlayerId } from '@thejokersthief/riftbound-protocol'
import { createMatchEngine } from '@thejokersthief/riftbound-engine'
import { buildMatch } from './fixtures.js'

export const FUZZ_ITERATIONS = 100

export type FuzzResult = {
  matchState: MatchState
  states: GameState[]
}

const FUZZ_PLAYER_1 = 'p1' as PlayerId
const FUZZ_PLAYER_2 = 'p2' as PlayerId

function pickRandom(seed: number, max: number): number {
  // Simple deterministic pick using mulberry32-inspired hash
  let t = (seed + 0x6d2b79f5) | 0
  t = Math.imul(t ^ (t >>> 15), t | 1)
  return Math.abs(t) % max
}

export function playFuzzGame(
  seed: number,
  catalog: CardCatalog,
  maxActions: number,
): FuzzResult {
  const matchEngine = createMatchEngine(catalog)
  let matchState = buildMatch({ players: [FUZZ_PLAYER_1, FUZZ_PLAYER_2], seed, catalog })
  const states: GameState[] = [matchState.currentGame]

  for (let i = 0; i < maxActions; i++) {
    if (matchState.status === 'ended') break
    const activeId =
      matchState.currentGame.pendingDecision?.playerId ??
      matchState.currentGame.activePlayerId
    const actions = matchEngine.legalMatchActions(matchState, activeId)
    if (actions.length === 0) break
    const actionIndex = pickRandom(seed + i, actions.length)
    const action = actions[actionIndex]
    if (!action) break
    const result = matchEngine.submitToMatch(matchState, action)
    matchState = result.matchState
    states.push(matchState.currentGame)
  }

  return { matchState, states }
}
