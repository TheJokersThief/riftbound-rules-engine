import type { CardCatalog } from '@thejokersthief/riftbound-card-catalog'
import type { GameState } from '@thejokersthief/riftbound-engine'
import { submit } from '@thejokersthief/riftbound-engine'
import type { Action, GameEvent } from '@thejokersthief/riftbound-protocol'

export type ScenarioResult = {
  finalState: GameState
  allEvents: GameEvent[][]
  flatEvents: GameEvent[]
}

export type Scenario = {
  name: string
  rules: string[]
  catalog: CardCatalog
  initial: GameState
  actions: Action[]
  assert: (result: ScenarioResult) => void
}

export function runScenario(scenario: Scenario): ScenarioResult {
  let state = scenario.initial
  const allEvents: GameEvent[][] = []
  for (const action of scenario.actions) {
    const result = submit(state, action, scenario.catalog)
    state = result.state
    allEvents.push(result.events)
  }
  const flatEvents = allEvents.flat()
  const result: ScenarioResult = { finalState: state, allEvents, flatEvents }
  scenario.assert(result)
  return result
}
