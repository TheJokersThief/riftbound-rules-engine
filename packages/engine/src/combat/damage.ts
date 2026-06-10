import type { GameEvent, BattlefieldId, PlayerId, CardId } from '@thejokersthief/riftbound-protocol'
import type { GameState } from '../state/types.js'
import type { RulesQuery } from '../rules-query/index.js'
import type { DamageAssignment } from '../state/stack.js'
import { fold } from '../state/fold.js'

// ---------------------------------------------------------------------------
// applyDamageAssignments
// ---------------------------------------------------------------------------

export function applyDamageAssignments(
  state: GameState,
  assignments: DamageAssignment[],
): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = []

  for (const assignment of assignments) {
    const event: GameEvent = {
      type: 'DamageDealt',
      sourceId: assignment.attackerId,
      targetId: assignment.targetId,
      amount: assignment.amount,
      bonus: 0,
    }
    events.push(event)
    state = fold(state, event)
  }

  return { state, events }
}

// ---------------------------------------------------------------------------
// computeDamagePool
// ---------------------------------------------------------------------------

export function computeDamagePool(
  battlefieldId: BattlefieldId,
  contestingPlayerId: PlayerId,
  state: GameState,
  query: RulesQuery,
): { attackers: CardId[]; totalDamage: number } {
  const bf = state.battlefields[battlefieldId]
  if (!bf) return { attackers: [], totalDamage: 0 }

  const attackers = bf.units.filter(id => {
    const card = state.cards[id]
    return card?.ownerId === contestingPlayerId
  })

  let totalDamage = 0
  for (const id of attackers) {
    totalDamage += query.mightOf(id)
  }

  return { attackers, totalDamage }
}

// ---------------------------------------------------------------------------
// buildDefaultAssignments
// ---------------------------------------------------------------------------

export function buildDefaultAssignments(
  attackers: CardId[],
  defenders: CardId[],
  query: RulesQuery,
): DamageAssignment[] {
  if (attackers.length === 0 || defenders.length === 0) return []

  const tankDefenders = defenders.filter(id => query.keywordsOf(id).includes('Tank'))
  const nonTankDefenders = defenders.filter(id => !query.keywordsOf(id).includes('Tank'))
  const orderedDefenders = [...tankDefenders, ...nonTankDefenders]

  const assignments: DamageAssignment[] = []
  let defenderIndex = 0

  for (const attackerId of attackers) {
    if (defenderIndex >= orderedDefenders.length) break
    const targetId = orderedDefenders[defenderIndex]
    if (!targetId) break
    const amount = query.mightOf(attackerId)
    assignments.push({ attackerId, targetId, amount })
    defenderIndex++
  }

  return assignments
}
