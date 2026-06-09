import type { CardId, PlayerId } from '@thejokersthief/riftbound-protocol'
import type { CardCatalog } from '@thejokersthief/riftbound-card-catalog'
import type { GameState } from '../state/types.js'
import { computeMight, computeKeywords } from './layers.js'
import { checkTiming, checkResources } from './timing.js'

export interface RulesQuery {
  /** Effective might of the card after all layer modifications. */
  mightOf(cardId: CardId): number
  /** True when effective might is greater than zero. */
  isMighty(cardId: CardId): boolean
  /** Deduplicated list of keywords (base definition ∪ instance-granted). */
  keywordsOf(cardId: CardId): string[]
  /** True when it is legal for the player to play this card right now. */
  canBePlayed(cardId: CardId, playerId: PlayerId): boolean
}

/**
 * Creates a RulesQuery bound to the given game state and card catalog.
 * Results are lazily computed and cached for the lifetime of this query object.
 * Create a new RulesQuery whenever the state changes.
 */
export function createRulesQuery(state: GameState, catalog: CardCatalog): RulesQuery {
  const mightCache = new Map<CardId, number>()
  const keywordsCache = new Map<CardId, string[]>()

  return {
    mightOf(cardId: CardId): number {
      const cached = mightCache.get(cardId)
      if (cached !== undefined) return cached
      const value = computeMight(state, catalog, cardId)
      mightCache.set(cardId, value)
      return value
    },

    isMighty(cardId: CardId): boolean {
      return this.mightOf(cardId) > 0
    },

    keywordsOf(cardId: CardId): string[] {
      const cached = keywordsCache.get(cardId)
      if (cached !== undefined) return cached
      const value = computeKeywords(state, catalog, cardId)
      keywordsCache.set(cardId, value)
      return value
    },

    canBePlayed(cardId: CardId, playerId: PlayerId): boolean {
      const instance = state.cards[cardId]
      if (!instance) return false

      const def = catalog.find(instance.defId)
      if (!def) return false

      const player = state.players[playerId]
      if (!player) return false

      if (!checkTiming(def, state)) return false
      if (!checkResources(def.playCost, player)) return false

      return true
    },
  }
}
