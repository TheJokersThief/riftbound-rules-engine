import type { GameEvent } from '@thejokersthief/riftbound-protocol'
import type { CardCatalog } from '@thejokersthief/riftbound-card-catalog'
import type { EffectProgram } from '@thejokersthief/riftbound-effect-ir'
import type { GameState } from '../state/types.js'
import type { RulesQuery } from '../rules-query/index.js'
import type { EffectFrame } from '../state/stack.js'
import { step } from '../interpreter/index.js'
import { drainHot } from './hot.js'
import { fold } from '../state/fold.js'

// ---------------------------------------------------------------------------
// feprStep — one iteration of the FEPR loop
// ---------------------------------------------------------------------------

export function feprStep(
  state: GameState,
  query: RulesQuery,
  catalog: CardCatalog,
  programs: ReadonlyMap<string, EffectProgram>,
): { state: GameState; events: GameEvent[] } {
  const allEvents: GameEvent[] = []

  // 1. Finalize — drain HOT queue
  const hotResult = drainHot(state, query, catalog, programs)
  state = hotResult.state
  allEvents.push(...hotResult.events)

  // If a decision is pending after draining, suspend
  if (state.pendingDecision !== null) {
    return { state, events: allEvents }
  }

  // 2. Check for a ChainFrame on the resolution stack
  const topFrame = state.resolutionStack[state.resolutionStack.length - 1]
  if (!topFrame || topFrame.type !== 'Chain') {
    return { state, events: allEvents }
  }

  const chainFrame = topFrame

  switch (chainFrame.resumeAt) {
    case 'Finalize': {
      // Drain is done above; advance to Execute
      const updatedFrame = { ...chainFrame, resumeAt: 'Execute' as const }
      state = {
        ...state,
        resolutionStack: [
          ...state.resolutionStack.slice(0, -1),
          updatedFrame,
        ],
      }
      // Fall through to Execute by recursing
      return feprStep(state, query, catalog, programs)
    }

    case 'Execute': {
      // Grant priority window to the active player
      state = {
        ...state,
        pendingDecision: {
          type: 'PriorityWindow',
          playerId: state.chain.priority ?? state.activePlayerId,
        },
      }
      return { state, events: allEvents }
    }

    case 'Pass': {
      // Both players passed — advance to Resolve
      const updatedFrame = { ...chainFrame, resumeAt: 'Resolve' as const }
      state = {
        ...state,
        resolutionStack: [
          ...state.resolutionStack.slice(0, -1),
          updatedFrame,
        ],
      }
      return feprStep(state, query, catalog, programs)
    }

    case 'Resolve': {
      // Find the newest unresolved chain item (LIFO)
      const unresolved = [...state.chain.items].reverse().find(item => !item.resolved)

      if (!unresolved) {
        // All items resolved — emit ChainClosed and pop the ChainFrame
        const chainClosedEvent: GameEvent = { type: 'ChainClosed' }
        state = fold(state, chainClosedEvent)
        allEvents.push(chainClosedEvent)
        state = {
          ...state,
          resolutionStack: state.resolutionStack.slice(0, -1),
        }
        return { state, events: allEvents }
      }

      // Get the program for this chain item
      const program = programs.get(unresolved.defId)
      if (!program || program.type === 'Unparsed') {
        // Mark resolved and continue
        state = {
          ...state,
          chain: {
            ...state.chain,
            items: state.chain.items.map(item =>
              item.id === unresolved.id ? { ...item, resolved: true } : item,
            ),
          },
        }
        return feprStep(state, query, catalog, programs)
      }

      // Mark item as resolved
      state = {
        ...state,
        chain: {
          ...state.chain,
          items: state.chain.items.map(item =>
            item.id === unresolved.id ? { ...item, resolved: true } : item,
          ),
        },
      }

      // Push an EffectFrame for the first compiled ability's effect (the play effect)
      const playAbility = program.abilities.find(
        (a): a is Extract<typeof a, { type: 'Triggered' | 'Activated' }> => a.type !== 'Static',
      )
      if (playAbility) {
        const effectNodes = playAbility.effect.type === 'Sequence'
          ? playAbility.effect.effects
          : [playAbility.effect]

        const frame: EffectFrame = {
          type: 'Effect',
          sourceId: unresolved.sourceId,
          controller: unresolved.controller,
          remaining: effectNodes,
          targets: unresolved.targets,
        }
        state = { ...state, resolutionStack: [...state.resolutionStack, frame] }

        // Run the step loop until empty or suspended
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
  }
}
