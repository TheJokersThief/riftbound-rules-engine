import type { GameEvent } from '@thejokersthief/riftbound-protocol'
import type { CardCatalog } from '@thejokersthief/riftbound-card-catalog'
import type { EffectProgram } from '@thejokersthief/riftbound-effect-ir'
import type { GameState } from '../state/types.js'
import type { RulesQuery } from '../rules-query/index.js'
import { step } from '../interpreter/index.js'
import { drainHot } from './hot.js'

// ---------------------------------------------------------------------------
// advance — top-level chain entry point
// ---------------------------------------------------------------------------

export function advance(
  state: GameState,
  query: RulesQuery,
  catalog: CardCatalog,
  programs: ReadonlyMap<string, EffectProgram> = new Map(),
): { state: GameState; events: GameEvent[] } {
  if (state.pendingDecision !== null) {
    return { state, events: [] }
  }

  const allEvents: GameEvent[] = []

  const hotResult = drainHot(state, query, catalog, programs)
  state = hotResult.state
  allEvents.push(...hotResult.events)

  if (state.pendingDecision !== null) {
    return { state, events: allEvents }
  }

  let stepResult = step(state, query, catalog)
  while (
    stepResult.state.pendingDecision === null &&
    stepResult.state.resolutionStack.length > 0 &&
    stepResult.state.resolutionStack[stepResult.state.resolutionStack.length - 1]?.type === 'Effect'
  ) {
    allEvents.push(...stepResult.events)
    state = stepResult.state
    stepResult = step(state, query, catalog)
  }
  allEvents.push(...stepResult.events)
  state = stepResult.state

  return { state, events: allEvents }
}

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export { collectTriggers, drainHot } from './hot.js'
export { feprStep } from './fepr.js'
export { openShowdown, closeShowdown } from './showdown.js'
