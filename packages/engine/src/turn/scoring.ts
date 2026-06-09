import type { GameEvent } from '@thejokersthief/riftbound-protocol'
import type { PlayerId, BattlefieldId, CardId } from '@thejokersthief/riftbound-protocol'
import type { GameState } from '../state/types.js'
import type { RulesQuery } from '../rules-query/index.js'
import { fold } from '../state/fold.js'

// ---------------------------------------------------------------------------
// attemptScore
// ---------------------------------------------------------------------------

export function attemptScore(
  state: GameState,
  playerId: PlayerId,
  method: 'Hold' | 'Conquer',
  battlefieldId: BattlefieldId,
): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = []

  const player = state.players[playerId]
  if (!player) return { state, events }

  let shouldScore = true

  if (method === 'Conquer' && player.points >= 7) {
    // Winning Point guard: must have scored every battlefield this turn
    const allBattlefieldIds = Object.keys(state.battlefields) as BattlefieldId[]
    const scoredIds = state.scoredThisTurn[playerId] ?? []
    const allScored = allBattlefieldIds.every(bfId => scoredIds.includes(bfId))

    if (!allScored) {
      // Draw a card instead
      const drawPlayer = state.players[playerId]!
      const topCardId: CardId | null = drawPlayer.mainDeck[0] ?? null
      const drawEvent: GameEvent = { type: 'CardDrawn', playerId, cardId: topCardId }
      events.push(drawEvent)
      state = fold(state, drawEvent)
      return { state, events }
    }
  }

  if (shouldScore) {
    const scoredEvent: GameEvent = {
      type: 'PointScored',
      playerId,
      method,
      battlefieldId,
    }
    events.push(scoredEvent)
    state = fold(state, scoredEvent)

    // Track in scoredThisTurn
    const existingScored = state.scoredThisTurn[playerId] ?? []
    state = {
      ...state,
      scoredThisTurn: {
        ...state.scoredThisTurn,
        [playerId]: [...existingScored, battlefieldId],
      },
    }
  }

  return { state, events }
}

// ---------------------------------------------------------------------------
// checkScoring
// ---------------------------------------------------------------------------

export function checkScoring(
  state: GameState,
  playerId: PlayerId,
  _query: RulesQuery,
): { state: GameState; events: GameEvent[] } {
  const allEvents: GameEvent[] = []

  // Hold: iterate holdEligible, score if still controlled by the player
  for (const bfId of state.holdEligible) {
    if (state.battlefields[bfId]?.controllerId === playerId) {
      const result = attemptScore(state, playerId, 'Hold', bfId)
      state = result.state
      allEvents.push(...result.events)
    }
  }

  // Conquer: battlefields where controllerId === playerId and NOT in holdEligible
  const allBfIds = Object.keys(state.battlefields) as BattlefieldId[]
  for (const bfId of allBfIds) {
    if (
      state.battlefields[bfId]?.controllerId === playerId &&
      !state.holdEligible.includes(bfId)
    ) {
      const result = attemptScore(state, playerId, 'Conquer', bfId)
      state = result.state
      allEvents.push(...result.events)
    }
  }

  return { state, events: allEvents }
}
