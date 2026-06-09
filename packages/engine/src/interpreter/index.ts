import type { CardCatalog } from '@thejokersthief/riftbound-card-catalog'
import type { ActionNode } from '@thejokersthief/riftbound-effect-ir'
import type { GameEvent } from '@thejokersthief/riftbound-protocol'
import type { GameState } from '../state/types.js'
import type { EffectFrame } from '../state/stack.js'
import type { RulesQuery } from '../rules-query/index.js'
import { executeAction } from './actions.js'
import { dispatchNode } from './nodes.js'

// ---------------------------------------------------------------------------
// Action type discriminator set
// ---------------------------------------------------------------------------

const ACTION_TYPES = new Set([
  'Deal',
  'Draw',
  'Discard',
  'Move',
  'Recall',
  'ReturnToHand',
  'Buff',
  'Ready',
  'Exhaust',
  'Kill',
  'Banish',
  'CreateToken',
  'Counter',
  'AddResource',
  'GainXP',
  'SpendXP',
  'Reveal',
  'Recycle',
  'GiveMight',
  'GrantKeyword',
  'TakeExtraTurn',
])

// ---------------------------------------------------------------------------
// step — advance the resolution stack by one node
// ---------------------------------------------------------------------------

export function step(
  state: GameState,
  query: RulesQuery,
  catalog: CardCatalog,
): { state: GameState; events: GameEvent[] } {
  const stack = state.resolutionStack
  if (stack.length === 0) return { state, events: [] }

  const topFrame = stack[stack.length - 1]!

  if (topFrame.type !== 'Effect') {
    // ChainFrame, CombatFrame, DecisionFrame — not handled here
    return { state, events: [] }
  }

  const frame = topFrame as EffectFrame

  if (frame.remaining.length === 0) {
    // Pop the exhausted frame
    const newStack = stack.slice(0, -1)
    return { state: { ...state, resolutionStack: newStack }, events: [] }
  }

  const [head, ...rest] = frame.remaining
  // head is guaranteed non-undefined because we checked length above
  const headNode = head!
  const updatedFrame: EffectFrame = { ...frame, remaining: rest }
  const stackWithUpdated = [...stack.slice(0, -1), updatedFrame]
  const stateWithUpdatedFrame: GameState = { ...state, resolutionStack: stackWithUpdated }

  if (ACTION_TYPES.has(headNode.type)) {
    return executeAction(headNode as ActionNode, updatedFrame, stateWithUpdatedFrame, query, catalog)
  }

  return dispatchNode(headNode, updatedFrame, stateWithUpdatedFrame, query, catalog)
}

export { resolveSelector, evalCondition, evalNumberExpr, resolvePlayerRef } from './selectors.js'
export { executeAction } from './actions.js'
export { dispatchNode } from './nodes.js'
