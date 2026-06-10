import type { GameEvent, PlayerId, BattlefieldId } from '@thejokersthief/riftbound-protocol'
import type { CardCatalog } from '@thejokersthief/riftbound-card-catalog'
import type { EffectProgram } from '@thejokersthief/riftbound-effect-ir'
import type { GameState } from '../state/types.js'
import type { RulesQuery } from '../rules-query/index.js'
import { fold } from '../state/fold.js'
import { advance } from '../chain/index.js'
import { checkScoring } from './scoring.js'

// ---------------------------------------------------------------------------
// checkWinCondition
// ---------------------------------------------------------------------------

export function checkWinCondition(state: GameState): GameState {
  const [p1, p2] = state.playerIds
  const pts1 = state.players[p1]!.points
  const pts2 = state.players[p2]!.points
  const victoryScore = 8

  if (pts1 >= victoryScore && pts1 > pts2) {
    return fold(state, { type: 'GameEnded', gameId: state.gameId, winner: p1 })
  }
  if (pts2 >= victoryScore && pts2 > pts1) {
    return fold(state, { type: 'GameEnded', gameId: state.gameId, winner: p2 })
  }
  return state
}

// ---------------------------------------------------------------------------
// runCleanup
// ---------------------------------------------------------------------------

export function runCleanup(
  state: GameState,
  playerId: PlayerId,
  query: RulesQuery,
  catalog: CardCatalog,
  programs?: ReadonlyMap<string, EffectProgram>,
): { state: GameState; events: GameEvent[] } {
  const allEvents: GameEvent[] = []

  const scoringResult = checkScoring(state, playerId, query)
  state = scoringResult.state
  allEvents.push(...scoringResult.events)

  const chainResult = advance(state, query, catalog, programs)
  state = chainResult.state
  allEvents.push(...chainResult.events)

  state = checkWinCondition(state)

  state = {
    ...state,
    scoredThisTurn: {
      ...state.scoredThisTurn,
      [playerId]: [] as BattlefieldId[],
    },
    holdEligible: [],
  }

  return { state, events: allEvents }
}
