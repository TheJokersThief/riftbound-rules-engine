import type { CardCatalog } from '@thejokersthief/riftbound-card-catalog'
import type {
  ConditionNode,
  NumberExpr,
  PlayerRef,
  SelectorNode,
} from '@thejokersthief/riftbound-effect-ir'
import type { CardId, PlayerId } from '@thejokersthief/riftbound-protocol'
import { typedObjectKeys } from '@thejokersthief/riftbound-protocol'
import type { RulesQuery } from '../rules-query/index.js'
import type { BattlefieldState, GameState } from '../state/types.js'

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getCardsAtBattlefields(state: GameState): CardId[] {
  return Object.values(state.battlefields).flatMap((bf) => bf?.units ?? [])
}

function getCardsAtBase(state: GameState): CardId[] {
  return Object.values(state.players).flatMap((p) => p?.base ?? [])
}

function getCardsInHand(state: GameState): CardId[] {
  return Object.values(state.players).flatMap((p) => p?.hand ?? [])
}

function getBattlefieldOfCard(state: GameState, cardId: CardId): BattlefieldState | null {
  for (const bf of Object.values(state.battlefields)) {
    if (!bf) continue
    if (bf.units.includes(cardId)) return bf
  }
  return null
}

export function resolvePlayerRef(ref: PlayerRef, state: GameState, sourceId: CardId): PlayerId {
  if (ref === 'You') {
    return state.cards[sourceId]?.ownerId ?? state.playerIds[0]!
  }
  if (ref === 'Opponent') {
    const ownerId = state.cards[sourceId]?.ownerId ?? state.playerIds[0]!
    return state.playerIds[0] === ownerId ? state.playerIds[1]! : state.playerIds[0]!
  }
  if (ref === 'Controller') {
    return state.cards[sourceId]?.ownerId ?? state.activePlayerId
  }
  // 'NonController'
  const controllerId = state.cards[sourceId]?.ownerId ?? state.activePlayerId
  return state.playerIds[0] === controllerId ? state.playerIds[1]! : state.playerIds[0]!
}

// ---------------------------------------------------------------------------
// resolveSelector
// ---------------------------------------------------------------------------

export function resolveSelector(
  selector: SelectorNode,
  state: GameState,
  sourceId: CardId,
  query: RulesQuery,
  catalog: CardCatalog
): CardId[] {
  const sourceCard = state.cards[sourceId]
  const sourceOwner = sourceCard?.ownerId

  // Step 1 — Scope
  const candidates = typedObjectKeys(state.cards)
  const scoped = candidates.filter((id) => {
    const card = state.cards[id]!
    if (selector.scope === 'Friendly') return card.ownerId === sourceOwner
    if (selector.scope === 'Enemy') return card.ownerId !== sourceOwner
    return true // 'Any'
  })

  // Step 2 — ObjectType
  const typed = scoped.filter((id) => {
    const def = catalog.find(state.cards[id]!.defId)
    if (!def) return false
    if (selector.objectType === 'Card') return true
    if (selector.objectType === 'Unit') return def.cardType === 'Unit'
    if (selector.objectType === 'Gear') return def.cardType === 'Gear'
    if (selector.objectType === 'Spell') return def.cardType === 'Spell'
    if (selector.objectType === 'Player') return false
    return false
  })

  // Step 3 — Location
  const location = selector.location
  const located = typed.filter((id) => {
    switch (location.type) {
      case 'Here': {
        const sourceBf = getBattlefieldOfCard(state, sourceId)
        if (!sourceBf) return false
        return sourceBf.units.includes(id)
      }
      case 'AtBattlefields':
        return getCardsAtBattlefields(state).includes(id)
      case 'AtBase':
        return getCardsAtBase(state).includes(id)
      case 'InHand':
        return getCardsInHand(state).includes(id)
      case 'TopOfDeck': {
        const allDeckTops = Object.values(state.players).flatMap(
          (p) => p?.mainDeck.slice(0, location.count) ?? []
        )
        return allDeckTops.includes(id)
      }
    }
  })

  // Step 4 — Filters
  const filtered = located.filter((id) => {
    const card = state.cards[id]!
    return selector.filters.every((f) => {
      switch (f.type) {
        case 'MightLE':
          return query.mightOf(id) <= f.value
        case 'MightGE':
          return query.mightOf(id) >= f.value
        case 'IsReady':
          return !card.exhausted
        case 'IsExhausted':
          return card.exhausted
        case 'IsBuffed':
          return card.buffAmount > 0
        case 'HasKeyword':
          return query.keywordsOf(id).includes(f.keyword)
        case 'Named':
          return (catalog.find(card.defId)?.name ?? '') === f.name
        case 'IsThis':
          return id === sourceId
      }
    })
  })

  // Step 5 — Quantity
  const qty = selector.quantity
  switch (qty.type) {
    case 'All':
      return filtered
    case 'One':
      return filtered.slice(0, 1)
    case 'UpTo':
      return filtered.slice(0, qty.count)
    case 'Exactly':
      return filtered.length >= qty.count ? filtered.slice(0, qty.count) : []
  }
}

// ---------------------------------------------------------------------------
// evalNumberExpr
// ---------------------------------------------------------------------------

export function evalNumberExpr(
  expr: NumberExpr,
  state: GameState,
  sourceId: CardId,
  query: RulesQuery,
  catalog: CardCatalog
): number {
  if (typeof expr === 'number') return expr
  if (expr.type === 'MightOf') {
    const targets = resolveSelector(expr.target, state, sourceId, query, catalog)
    return targets.length > 0 ? query.mightOf(targets[0]!) : 0
  }
  // 'CountOf'
  return resolveSelector(expr.selector, state, sourceId, query, catalog).length
}

// ---------------------------------------------------------------------------
// evalCondition
// ---------------------------------------------------------------------------

export function evalCondition(
  cond: ConditionNode,
  state: GameState,
  sourceId: CardId,
  query: RulesQuery,
  catalog: CardCatalog
): boolean {
  switch (cond.type) {
    case 'And':
      return cond.conditions.every((c) => evalCondition(c, state, sourceId, query, catalog))
    case 'Or':
      return cond.conditions.some((c) => evalCondition(c, state, sourceId, query, catalog))
    case 'Not':
      return !evalCondition(cond.condition, state, sourceId, query, catalog)
    case 'SelectorNonEmpty':
      return resolveSelector(cond.selector, state, sourceId, query, catalog).length > 0
    case 'CardIsBuffed':
      return resolveSelector(cond.selector, state, sourceId, query, catalog).some(
        (id) => (state.cards[id]?.buffAmount ?? 0) > 0
      )
    case 'CardHasKeyword':
      return resolveSelector(cond.selector, state, sourceId, query, catalog).some((id) =>
        query.keywordsOf(id).includes(cond.keyword)
      )
    case 'ControlsBattlefield': {
      const playerId = resolvePlayerRef(cond.player, state, sourceId)
      return Object.values(state.battlefields).some((bf) => bf?.controllerId === playerId)
    }
    case 'PlayerHasPoints': {
      const playerId = resolvePlayerRef(cond.player, state, sourceId)
      return (state.players[playerId]?.points ?? 0) >= cond.atLeast
    }
    case 'IsPhase':
      return state.phase === cond.phase
    case 'IsMyTurn': {
      const srcCard = state.cards[sourceId]
      return state.activePlayerId === srcCard?.ownerId
    }
  }
}
