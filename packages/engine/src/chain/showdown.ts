import type { BattlefieldId, GameEvent } from '@thejokersthief/riftbound-protocol'
import { fold } from '../state/fold.js'
import type { GameState } from '../state/types.js'

// ---------------------------------------------------------------------------
// openShowdown
// ---------------------------------------------------------------------------

export function openShowdown(
  state: GameState,
  battlefieldId: BattlefieldId,
  kind: 'Combat' | 'Control'
): { state: GameState; events: GameEvent[] } {
  const event: GameEvent = { type: 'ShowdownOpened', battlefieldId, kind }
  state = fold(state, event)

  const focusPlayerId = state.activePlayerId
  state = { ...state, chain: { ...state.chain, focus: focusPlayerId } }

  state = {
    ...state,
    pendingDecision: {
      type: 'FocusWindow',
      playerId: focusPlayerId,
      battlefieldId,
    },
  }

  return { state, events: [event] }
}

// ---------------------------------------------------------------------------
// closeShowdown
// ---------------------------------------------------------------------------

export function closeShowdown(state: GameState): { state: GameState; events: GameEvent[] } {
  const battlefieldId = state.chain.showdown?.battlefieldId
  if (!battlefieldId) {
    return { state, events: [] }
  }

  const event: GameEvent = { type: 'ShowdownClosed', battlefieldId }
  state = fold(state, event)
  state = { ...state, chain: { ...state.chain, focus: null } }

  return { state, events: [event] }
}
