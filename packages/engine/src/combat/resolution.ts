import type { CardCatalog } from '@thejokersthief/riftbound-card-catalog'
import type { EffectProgram } from '@thejokersthief/riftbound-effect-ir'
import type { BattlefieldId, CardId, GameEvent, PlayerId } from '@thejokersthief/riftbound-protocol'
import { toZoneId } from '@thejokersthief/riftbound-protocol'
import { collectTriggers } from '../chain/hot.js'
import type { RulesQuery } from '../rules-query/index.js'
import { fold } from '../state/fold.js'
import type { GameState } from '../state/types.js'

// ---------------------------------------------------------------------------
// resolveDeaths
// ---------------------------------------------------------------------------

export function resolveDeaths(
  state: GameState,
  damageDealt: Map<CardId, number>,
  query: RulesQuery,
  programs?: ReadonlyMap<string, EffectProgram>,
  catalog?: CardCatalog
): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = []

  for (const [cardId, totalDamage] of damageDealt) {
    const card = state.cards[cardId]
    if (!card) continue

    const might = query.mightOf(cardId)
    const isDead = (might === 0 && totalDamage > 0) || (might > 0 && totalDamage >= might)

    if (!isDead) continue

    const killedEvent: GameEvent = { type: 'CardKilled', cardId }
    events.push(killedEvent)
    state = fold(state, killedEvent)

    const fromZone = toZoneId(`battlefield-${cardId}`)
    const toZone = toZoneId(`discard-${card.ownerId}`)
    const movedEvent: GameEvent = {
      type: 'CardMoved',
      cardId,
      fromZone,
      toZone,
    }
    events.push(movedEvent)
    state = fold(state, movedEvent)

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
  contestingPlayerId: PlayerId
): { state: GameState; events: GameEvent[] } {
  const bf = state.battlefields[battlefieldId]
  if (!bf) return { state, events: [] }

  const remainingUnits = bf.units

  const contestingUnits = remainingUnits.filter((id) => {
    const card = state.cards[id]
    return card?.ownerId === contestingPlayerId
  })

  const defendingUnits = remainingUnits.filter((id) => {
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
