import type { CardCatalog } from '@thejokersthief/riftbound-card-catalog'
import type { EffectProgram } from '@thejokersthief/riftbound-effect-ir'
import type { GameEvent } from '@thejokersthief/riftbound-protocol'
import type { RulesQuery } from '../rules-query/index.js'
import type { GameState } from '../state/types.js'
import { runCleanup } from './cleanup.js'
import { advanceTurnEnd, startEndingPhase } from './phases.js'

// ---------------------------------------------------------------------------
// advanceTurn — called when the active player ends their turn
// ---------------------------------------------------------------------------

export function advanceTurn(
  state: GameState,
  query: RulesQuery,
  catalog: CardCatalog,
  programs?: ReadonlyMap<string, EffectProgram>
): { state: GameState; events: GameEvent[] } {
  const allEvents: GameEvent[] = []

  const endingResult = startEndingPhase(state)
  state = endingResult.state
  allEvents.push(...endingResult.events)

  const cleanupResult = runCleanup(state, state.activePlayerId, query, catalog, programs)
  state = cleanupResult.state
  allEvents.push(...cleanupResult.events)

  const turnEndResult = advanceTurnEnd(state)
  state = turnEndResult.state
  allEvents.push(...turnEndResult.events)

  return { state, events: allEvents }
}

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export {
  runStartPhase,
  runChannelPhase,
  startMainPhase,
  startEndingPhase,
  advanceTurnEnd,
} from './phases.js'

export { attemptScore, checkScoring } from './scoring.js'

export { runCleanup, checkWinCondition } from './cleanup.js'
