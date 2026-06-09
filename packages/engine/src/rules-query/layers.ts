import type { CardId, BattlefieldId } from '@thejokersthief/riftbound-protocol'
import type { CardCatalog } from '@thejokersthief/riftbound-card-catalog'
import type { GameState } from '../state/types.js'

/**
 * Returns all CardIds currently in an active zone:
 * battlefield units, base units, champions, and legends.
 */
export function getCardsInPlay(state: GameState): CardId[] {
  const ids: CardId[] = []

  for (const playerId of state.playerIds) {
    const player = state.players[playerId]
    if (!player) continue

    ids.push(player.legendZone)
    ids.push(player.championZone)

    for (const baseCardId of player.base) {
      ids.push(baseCardId)
    }
  }

  for (const bfId of Object.keys(state.battlefields) as BattlefieldId[]) {
    const bf = state.battlefields[bfId]
    if (!bf) continue
    for (const unitId of bf.units) {
      ids.push(unitId)
    }
  }

  return ids
}

/**
 * Computes the effective might of a card after applying buffAmount.
 *
 * v1 note: Static ability modifications (ModifyMight) from other cards' compiled
 * EffectPrograms are not yet wired — CardDefinition carries no program field.
 * buffAmount on CardInstance already reflects Buff/GiveMight actions applied via fold.
 */
export function computeMight(state: GameState, catalog: CardCatalog, cardId: CardId): number {
  const instance = state.cards[cardId]
  if (!instance) return 0

  const def = catalog.find(instance.defId)
  if (!def) return 0

  const might = (def.might ?? 0) + instance.buffAmount

  // Future: walk getCardsInPlay(state) and apply Static ModifyMight abilities
  // from each card's compiled EffectProgram once programs are wired to CardDefinition.

  return Math.max(0, might)
}

/**
 * Computes the effective keyword list for a card.
 * Merges base definition keywords with instance-level granted keywords and deduplicates.
 *
 * v1 note: Static AddKeyword/RemoveKeyword/RemoveAllKeywords modifications from other
 * cards' compiled EffectPrograms are not yet wired — CardDefinition carries no program
 * field. Instance-level keywords (applied via KeywordGranted fold events) are included.
 */
export function computeKeywords(state: GameState, catalog: CardCatalog, cardId: CardId): string[] {
  const instance = state.cards[cardId]
  if (!instance) return []

  const def = catalog.find(instance.defId)
  if (!def) return []

  const keywords = new Set<string>([...def.keywords, ...instance.keywords])

  // Future: walk getCardsInPlay(state) and apply Static AddKeyword / RemoveKeyword /
  // RemoveAllKeywords modifications from each card's compiled EffectProgram.

  return Array.from(keywords)
}
