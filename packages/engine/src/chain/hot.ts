import type { CardId, PlayerId, GameEvent } from '@thejokersthief/riftbound-protocol'
import type { CardCatalog } from '@thejokersthief/riftbound-card-catalog'
import type { EffectProgram, TriggerEvent } from '@thejokersthief/riftbound-effect-ir'
import type { GameState, TriggeredAbilityTask } from '../state/types.js'
import type { RulesQuery } from '../rules-query/index.js'
import type { EffectFrame } from '../state/stack.js'
import { step } from '../interpreter/index.js'
import { evalCondition } from '../interpreter/selectors.js'

// ---------------------------------------------------------------------------
// Helpers — active card IDs
// ---------------------------------------------------------------------------

function getActiveCardIds(state: GameState): CardId[] {
  const ids: CardId[] = []

  // battlefield units
  for (const bf of Object.values(state.battlefields)) {
    if (!bf) continue
    for (const id of bf.units) {
      ids.push(id)
    }
  }

  // base cards + champion + legend zones
  for (const player of Object.values(state.players)) {
    if (!player) continue
    for (const id of player.base) {
      ids.push(id)
    }
    ids.push(player.championZone)
    ids.push(player.legendZone)
  }

  return ids
}

// ---------------------------------------------------------------------------
// eventMatchesTrigger
// ---------------------------------------------------------------------------

function eventMatchesTrigger(
  trigger: TriggerEvent,
  event: GameEvent,
  cardId: CardId,
  state: GameState,
): boolean {
  const card = state.cards[cardId]
  const cardOwner = card?.ownerId

  switch (trigger.type) {
    case 'WhenPlayed':
      return event.type === 'CardPlayed'

    case 'WhenAttacks':
      return event.type === 'ShowdownOpened' && event.kind === 'Combat'

    case 'WhenDealtDamage':
      return event.type === 'DamageDealt' && event.targetId === cardId

    case 'WhenKilled':
      return event.type === 'CardKilled' && event.cardId === cardId

    case 'WhenFriendlyDies': {
      if (event.type !== 'CardKilled') return false
      const killedCard = state.cards[event.cardId]
      return killedCard?.ownerId === cardOwner && event.cardId !== cardId
    }

    case 'WhenEnemyDies': {
      if (event.type !== 'CardKilled') return false
      const killedCard = state.cards[event.cardId]
      return killedCard?.ownerId !== cardOwner
    }

    case 'WhenChanneled':
      return event.type === 'RuneChanneled'

    case 'AtStartOfTurn':
      return event.type === 'TurnStarted'

    case 'AtEndOfTurn':
      return event.type === 'TurnEnded'

    case 'WhenEntersPlay':
      return event.type === 'CardPlayed' || event.type === 'TokenCreated'

    case 'WhenConquer':
      return event.type === 'PointScored' && event.method === 'Conquer'

    case 'WhenHold':
      return event.type === 'PointScored' && event.method === 'Hold'
  }
}

// ---------------------------------------------------------------------------
// collectTriggers
// ---------------------------------------------------------------------------

export function collectTriggers(
  state: GameState,
  events: GameEvent[],
  programs: ReadonlyMap<string, EffectProgram>,
  catalog: CardCatalog,
  query: RulesQuery,
): GameState {
  if (events.length === 0 || programs.size === 0) return state

  // Collect tasks, active player first then opponent
  const [activePlayer, opponentPlayer] = state.playerIds
  const orderedPlayers: PlayerId[] = opponentPlayer !== undefined
    ? [activePlayer!, opponentPlayer]
    : [activePlayer!]

  const newTasks: TriggeredAbilityTask[] = []

  for (const playerId of orderedPlayers) {
    const activeCardIds = getActiveCardIds(state).filter(id => {
      const card = state.cards[id]
      return card?.ownerId === playerId
    })

    for (const cardId of activeCardIds) {
      const card = state.cards[cardId]
      if (!card) continue

      const program = programs.get(card.defId)
      if (!program || program.type === 'Unparsed') continue

      program.abilities.forEach((ability, abilityIndex) => {
        if (ability.type !== 'Triggered') return

        for (const event of events) {
          if (!eventMatchesTrigger(ability.event, event, cardId, state)) continue

          // Check optional condition
          if (ability.condition !== undefined) {
            const condMet = evalCondition(ability.condition, state, cardId, query, catalog)
            if (!condMet) continue
          }

          newTasks.push({
            sourceId: cardId,
            abilityIndex,
            controller: card.ownerId,
            context: { triggerEvent: ability.event },
          })
          // Only add once per event per ability (first matching event wins)
          break
        }
      })
    }
  }

  if (newTasks.length === 0) return state
  return { ...state, hotQueue: [...state.hotQueue, ...newTasks] }
}

// ---------------------------------------------------------------------------
// drainHot
// ---------------------------------------------------------------------------

export function drainHot(
  state: GameState,
  query: RulesQuery,
  catalog: CardCatalog,
  programs: ReadonlyMap<string, EffectProgram>,
): { state: GameState; events: GameEvent[] } {
  const allEvents: GameEvent[] = []

  while (state.hotQueue.length > 0 && state.pendingDecision === null) {
    const task = state.hotQueue[0]!
    state = { ...state, hotQueue: state.hotQueue.slice(1) }

    const card = state.cards[task.sourceId]
    if (!card) continue

    const program = programs.get(card.defId)
    if (!program || program.type === 'Unparsed') continue

    const ability = program.abilities[task.abilityIndex]
    if (!ability || ability.type !== 'Triggered') continue

    // Flatten the triggered effect into EffectNode[]
    const effectNodes = ability.effect.type === 'Sequence'
      ? ability.effect.effects
      : [ability.effect]

    const frame: EffectFrame = {
      type: 'Effect',
      sourceId: task.sourceId,
      controller: task.controller,
      remaining: effectNodes,
      targets: task.context.targets ?? [],
    }

    state = { ...state, resolutionStack: [...state.resolutionStack, frame] }

    // Run step loop until empty or suspended
    let stepResult = step(state, query, catalog)
    while (
      stepResult.state.pendingDecision === null &&
      stepResult.state.resolutionStack.length > 0 &&
      stepResult.state.resolutionStack[stepResult.state.resolutionStack.length - 1]?.type === 'Effect'
    ) {
      allEvents.push(...stepResult.events)
      state = stepResult.state
      stepResult = step(state, query, catalog)
    }
    allEvents.push(...stepResult.events)
    state = stepResult.state
  }

  return { state, events: allEvents }
}
