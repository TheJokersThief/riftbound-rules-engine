import type { GameEvent, BattlefieldId, PlayerId, CardId, ZoneId } from '@thejokersthief/riftbound-protocol'
import type { CardCatalog } from '@thejokersthief/riftbound-card-catalog'
import type { EffectProgram } from '@thejokersthief/riftbound-effect-ir'
import type { GameState } from '../state/types.js'
import type { RulesQuery } from '../rules-query/index.js'
import { fold } from '../state/fold.js'
import { collectTriggers } from '../chain/hot.js'

// ---------------------------------------------------------------------------
// resolveDeaths
// ---------------------------------------------------------------------------

export function resolveDeaths(
  state: GameState,
  damageDealt: Map<CardId, number>,
  query: RulesQuery,
  programs?: ReadonlyMap<string, EffectProgram>,
  catalog?: CardCatalog,
): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = []

  for (const [cardId, totalDamage] of damageDealt) {
    const card = state.cards[cardId]
    if (!card) continue

    const might = query.mightOf(cardId)
    const isDead =
      (might === 0 && totalDamage > 0) || (might > 0 && totalDamage >= might)

    if (!isDead) continue

    // Emit CardKilled
    const killedEvent: GameEvent = { type: 'CardKilled', cardId }
    events.push(killedEvent)
    state = fold(state, killedEvent)

    // Emit CardMoved — battlefield → discard zone
    const fromZone = `battlefield-${cardId}` as ZoneId
    const toZone = `discard-${card.ownerId}` as ZoneId
    const movedEvent: GameEvent = {
      type: 'CardMoved',
      cardId,
      fromZone,
      toZone,
    }
    events.push(movedEvent)
    state = fold(state, movedEvent)

    // Collect WhenKilled triggers into hotQueue
    if (programs && catalog) {
      state = collectTriggers(state, [killedEvent], programs, catalog, query)
    }
  }

  return { state, events }
}

// ---------------------------------------------------------------------------
// resolveControl
// ---------------------------------------------------------------------------

export function resolveControl(
  state: GameState,
  battlefieldId: BattlefieldId,
  contestingPlayerId: PlayerId,
): { state: GameState; events: GameEvent[] } {
  const bf = state.battlefields[battlefieldId]
  if (!bf) return { state, events: [] }

  const remainingUnits = bf.units

  const contestingUnits = remainingUnits.filter(id => {
    const card = state.cards[id]
    return card?.ownerId === contestingPlayerId
  })

  const defendingUnits = remainingUnits.filter(id => {
    const card = state.cards[id]
    return card !== undefined && card.ownerId !== contestingPlayerId
  })

  if (contestingUnits.length > 0 && defendingUnits.length === 0) {
    const event: GameEvent = {
      type: 'ControlChanged',
      battlefieldId,
      newControllerId: contestingPlayerId,
    }
    const newState = fold(state, event)
    return { state: newState, events: [event] }
  }

  return { state, events: [] }
}
