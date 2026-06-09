import type { CardId, ZoneId, PlayerId } from '@thejokersthief/riftbound-protocol'
import type { CardCatalog } from '@thejokersthief/riftbound-card-catalog'
import type { ActionNode } from '@thejokersthief/riftbound-effect-ir'
import type { GameEvent } from '@thejokersthief/riftbound-protocol'
import type { GameState } from '../state/types.js'
import type { EffectFrame } from '../state/stack.js'
import type { RulesQuery } from '../rules-query/index.js'
import { fold } from '../state/fold.js'
import { resolveSelector, evalNumberExpr, resolvePlayerRef } from './selectors.js'

// ---------------------------------------------------------------------------
// Helper: map a ZoneRef string to a ZoneId
// We cast since ZoneId is a branded string.
// ---------------------------------------------------------------------------

function zoneRefToZoneId(ref: string): ZoneId {
  return ref as ZoneId
}

// ---------------------------------------------------------------------------
// Helper: find which zone a card currently lives in (best-effort)
// ---------------------------------------------------------------------------

function currentZoneOfCard(state: GameState, cardId: CardId): ZoneId {
  // Check battlefields
  for (const bf of Object.values(state.battlefields)) {
    if (!bf) continue
    if (bf.units.includes(cardId)) return 'battlefield' as ZoneId
  }
  // Check player hands / decks / base
  for (const [, player] of Object.entries(state.players)) {
    if (!player) continue
    if (player.hand.includes(cardId)) return 'hand' as ZoneId
    if (player.mainDeck.includes(cardId)) return 'mainDeck' as ZoneId
    if (player.base.includes(cardId)) return 'base' as ZoneId
    if (player.runeDeck.includes(cardId)) return 'runeDeck' as ZoneId
  }
  return 'unknown' as ZoneId
}

// ---------------------------------------------------------------------------
// executeAction
// ---------------------------------------------------------------------------

export function executeAction(
  node: ActionNode,
  frame: EffectFrame,
  state: GameState,
  query: RulesQuery,
  catalog: CardCatalog,
): { state: GameState; events: GameEvent[] } {
  switch (node.type) {
    case 'Deal': {
      const targets = resolveSelector(node.targets, state, frame.sourceId, query, catalog)
      const events: GameEvent[] = []
      let s = state
      for (const targetId of targets) {
        const amount = evalNumberExpr(node.amount, s, frame.sourceId, query, catalog)
        const bonus = node.bonus ? evalNumberExpr(node.bonus, s, frame.sourceId, query, catalog) : 0
        const event: GameEvent = {
          type: 'DamageDealt',
          sourceId: frame.sourceId,
          targetId,
          amount,
          bonus,
        }
        events.push(event)
        s = fold(s, event)
      }
      return { state: s, events }
    }

    case 'Draw': {
      const playerId = resolvePlayerRef(node.player, state, frame.sourceId)
      const count = evalNumberExpr(node.count, state, frame.sourceId, query, catalog)
      const events: GameEvent[] = []
      let s = state
      for (let i = 0; i < count; i++) {
        const player = s.players[playerId]!
        const cardId = player.mainDeck[0] ?? null
        const event: GameEvent = { type: 'CardDrawn', playerId, cardId }
        events.push(event)
        s = fold(s, event)
      }
      return { state: s, events }
    }

    case 'Discard': {
      const targets = resolveSelector(node.targets, state, frame.sourceId, query, catalog)
      const events: GameEvent[] = []
      let s = state
      for (const cardId of targets) {
        const card = s.cards[cardId]
        if (!card) continue
        const event: GameEvent = { type: 'CardDiscarded', playerId: card.ownerId, cardId }
        events.push(event)
        s = fold(s, event)
      }
      return { state: s, events }
    }

    case 'Move': {
      const targets = resolveSelector(node.targets, state, frame.sourceId, query, catalog)
      const events: GameEvent[] = []
      let s = state
      for (const cardId of targets) {
        const fromZone = currentZoneOfCard(s, cardId)
        const toZone = zoneRefToZoneId(node.toZone)
        const event: GameEvent = { type: 'CardMoved', cardId, fromZone, toZone }
        events.push(event)
        s = fold(s, event)
      }
      return { state: s, events }
    }

    case 'Recall': {
      const targets = resolveSelector(node.targets, state, frame.sourceId, query, catalog)
      const events: GameEvent[] = []
      let s = state
      for (const cardId of targets) {
        const event: GameEvent = { type: 'CardRecalled', cardId }
        events.push(event)
        s = fold(s, event)
      }
      return { state: s, events }
    }

    case 'ReturnToHand': {
      const targets = resolveSelector(node.targets, state, frame.sourceId, query, catalog)
      const events: GameEvent[] = []
      let s = state
      for (const cardId of targets) {
        const card = s.cards[cardId]
        if (!card) continue
        const event: GameEvent = { type: 'CardReturnedToHand', cardId, playerId: card.ownerId }
        events.push(event)
        s = fold(s, event)
      }
      return { state: s, events }
    }

    case 'Buff': {
      const targets = resolveSelector(node.targets, state, frame.sourceId, query, catalog)
      const events: GameEvent[] = []
      let s = state
      for (const cardId of targets) {
        const amount = evalNumberExpr(node.amount, s, frame.sourceId, query, catalog)
        const event: GameEvent = { type: 'CardBuffed', cardId, amount }
        events.push(event)
        s = fold(s, event)
      }
      return { state: s, events }
    }

    case 'Ready': {
      const targets = resolveSelector(node.targets, state, frame.sourceId, query, catalog)
      const events: GameEvent[] = []
      let s = state
      for (const cardId of targets) {
        const event: GameEvent = { type: 'CardReadied', cardId }
        events.push(event)
        s = fold(s, event)
      }
      return { state: s, events }
    }

    case 'Exhaust': {
      const targets = resolveSelector(node.targets, state, frame.sourceId, query, catalog)
      const events: GameEvent[] = []
      let s = state
      for (const cardId of targets) {
        const event: GameEvent = { type: 'CardExhausted', cardId }
        events.push(event)
        s = fold(s, event)
      }
      return { state: s, events }
    }

    case 'Kill': {
      const targets = resolveSelector(node.targets, state, frame.sourceId, query, catalog)
      const events: GameEvent[] = []
      let s = state
      for (const cardId of targets) {
        const event: GameEvent = { type: 'CardKilled', cardId }
        events.push(event)
        s = fold(s, event)
      }
      return { state: s, events }
    }

    case 'Banish': {
      const targets = resolveSelector(node.targets, state, frame.sourceId, query, catalog)
      const events: GameEvent[] = []
      let s = state
      for (const cardId of targets) {
        const event: GameEvent = { type: 'CardBanished', cardId }
        events.push(event)
        s = fold(s, event)
      }
      return { state: s, events }
    }

    case 'CreateToken': {
      const count = evalNumberExpr(node.count, state, frame.sourceId, query, catalog)
      const events: GameEvent[] = []
      let s = state
      const zoneId = zoneRefToZoneId(node.zone)
      for (let i = 0; i < count; i++) {
        const cardId = `tok_${Math.random().toString(36).slice(2, 9)}` as CardId
        const event: GameEvent = { type: 'TokenCreated', cardId, defId: node.defId, zoneId }
        events.push(event)
        s = fold(s, event)
      }
      return { state: s, events }
    }

    case 'Counter': {
      const targets = resolveSelector(node.targets, state, frame.sourceId, query, catalog)
      const events: GameEvent[] = []
      let s = state
      for (const cardId of targets) {
        const event: GameEvent = { type: 'CardCountered', cardId }
        events.push(event)
        s = fold(s, event)
      }
      return { state: s, events }
    }

    case 'AddResource': {
      const playerId = resolvePlayerRef(node.player, state, frame.sourceId)
      const energy = evalNumberExpr(node.energy, state, frame.sourceId, query, catalog)
      const power = evalNumberExpr(node.power, state, frame.sourceId, query, catalog)
      const event: GameEvent = { type: 'ResourceAdded', playerId, energy, power }
      const s = fold(state, event)
      return { state: s, events: [event] }
    }

    case 'GainXP': {
      const targets = resolveSelector(node.targets, state, frame.sourceId, query, catalog)
      const events: GameEvent[] = []
      let s = state
      for (const cardId of targets) {
        const amount = evalNumberExpr(node.amount, s, frame.sourceId, query, catalog)
        const event: GameEvent = { type: 'XPGained', cardId, amount }
        events.push(event)
        s = fold(s, event)
      }
      return { state: s, events }
    }

    case 'SpendXP': {
      const targets = resolveSelector(node.targets, state, frame.sourceId, query, catalog)
      const events: GameEvent[] = []
      let s = state
      for (const cardId of targets) {
        const amount = evalNumberExpr(node.amount, s, frame.sourceId, query, catalog)
        const event: GameEvent = { type: 'XPSpent', cardId, amount }
        events.push(event)
        s = fold(s, event)
      }
      return { state: s, events }
    }

    case 'Reveal': {
      const targets = resolveSelector(node.targets, state, frame.sourceId, query, catalog)
      const events: GameEvent[] = []
      let s = state
      for (const cardId of targets) {
        const card = s.cards[cardId]
        if (!card) continue
        const def = catalog.find(card.defId)
        if (!def) continue
        const event: GameEvent = { type: 'CardRevealed', cardId, defId: card.defId }
        events.push(event)
        s = fold(s, event)
      }
      return { state: s, events }
    }

    case 'Recycle': {
      const targets = resolveSelector(node.targets, state, frame.sourceId, query, catalog)
      const events: GameEvent[] = []
      let s = state
      for (const cardId of targets) {
        const card = s.cards[cardId]
        if (!card) continue
        const event: GameEvent = { type: 'CardRecycled', cardId, playerId: card.ownerId }
        events.push(event)
        s = fold(s, event)
      }
      return { state: s, events }
    }

    case 'GiveMight': {
      const targets = resolveSelector(node.targets, state, frame.sourceId, query, catalog)
      const events: GameEvent[] = []
      let s = state
      for (const cardId of targets) {
        const amount = evalNumberExpr(node.amount, s, frame.sourceId, query, catalog)
        const event: GameEvent = { type: 'MightGiven', cardId, amount }
        events.push(event)
        s = fold(s, event)
      }
      return { state: s, events }
    }

    case 'GrantKeyword': {
      const targets = resolveSelector(node.targets, state, frame.sourceId, query, catalog)
      const events: GameEvent[] = []
      let s = state
      for (const cardId of targets) {
        const event: GameEvent = { type: 'KeywordGranted', cardId, keyword: node.keyword }
        events.push(event)
        s = fold(s, event)
      }
      return { state: s, events }
    }

    case 'TakeExtraTurn': {
      const playerId = resolvePlayerRef(node.player, state, frame.sourceId)
      const event: GameEvent = { type: 'ExtraTurnGranted', playerId }
      const s = fold(state, event)
      return { state: s, events: [event] }
    }
  }
}
