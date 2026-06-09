import type { CardId, DecisionId } from '@thejokersthief/riftbound-protocol'
import type { CardCatalog } from '@thejokersthief/riftbound-card-catalog'
import type { EffectNode } from '@thejokersthief/riftbound-effect-ir'
import type { GameEvent } from '@thejokersthief/riftbound-protocol'
import type { GameState } from '../state/types.js'
import type { EffectFrame } from '../state/stack.js'
import type { RulesQuery } from '../rules-query/index.js'
import { evalCondition, resolveSelector } from './selectors.js'

// ---------------------------------------------------------------------------
// dispatchNode — handles non-action EffectNode variants
// ---------------------------------------------------------------------------

export function dispatchNode(
  node: EffectNode,
  frame: EffectFrame,
  state: GameState,
  query: RulesQuery,
  catalog: CardCatalog,
): { state: GameState; events: GameEvent[] } {
  switch (node.type) {
    case 'Sequence': {
      // Flatten sequence effects into the front of remaining
      const newRemaining = [...node.effects, ...frame.remaining]
      const newFrame: EffectFrame = { ...frame, remaining: newRemaining }
      const newStack = [...state.resolutionStack.slice(0, -1), newFrame]
      return { state: { ...state, resolutionStack: newStack }, events: [] }
    }

    case 'Optional': {
      const decisionId = `dec_${Math.random().toString(36).slice(2, 9)}` as DecisionId
      const resumeFrame: EffectFrame = {
        ...frame,
        remaining: [node.effect, ...frame.remaining],
      }
      const decisionFrame = {
        type: 'Decision' as const,
        decisionId,
        resumeFrame,
      }
      const pendingDecision = {
        type: 'ChooseYesNo' as const,
        playerId: frame.controller,
        decisionId,
        prompt: node.prompt ?? 'Do you want to use this effect?',
      }
      const newStack = [...state.resolutionStack.slice(0, -1), decisionFrame]
      return {
        state: { ...state, resolutionStack: newStack, pendingDecision },
        events: [],
      }
    }

    case 'ChooseOne': {
      const decisionId = `dec_${Math.random().toString(36).slice(2, 9)}` as DecisionId
      const resumeFrame: EffectFrame = { ...frame }
      const decisionFrame = {
        type: 'Decision' as const,
        decisionId,
        resumeFrame,
      }
      const pendingDecision = {
        type: 'ChooseOne' as const,
        playerId: frame.controller,
        decisionId,
        options: node.options.map((_, i) => `Option ${i + 1}`),
      }
      const newStack = [...state.resolutionStack.slice(0, -1), decisionFrame]
      return {
        state: { ...state, resolutionStack: newStack, pendingDecision },
        events: [],
      }
    }

    case 'Conditional': {
      const passes = evalCondition(node.condition, state, frame.sourceId, query, catalog)
      const next = passes ? node.then : node.else
      if (!next) {
        // condition false, no else — skip to next in frame
        if (frame.remaining.length === 0) {
          const newStack = state.resolutionStack.slice(0, -1)
          return { state: { ...state, resolutionStack: newStack }, events: [] }
        }
        const newStack = [...state.resolutionStack.slice(0, -1), frame]
        return { state: { ...state, resolutionStack: newStack }, events: [] }
      }
      const newRemaining = [next, ...frame.remaining]
      const newFrame: EffectFrame = { ...frame, remaining: newRemaining }
      const newStack = [...state.resolutionStack.slice(0, -1), newFrame]
      return { state: { ...state, resolutionStack: newStack }, events: [] }
    }

    case 'ForEach': {
      const targets = resolveSelector(node.selector, state, frame.sourceId, query, catalog)
      if (targets.length === 0) {
        if (frame.remaining.length === 0) {
          const newStack = state.resolutionStack.slice(0, -1)
          return { state: { ...state, resolutionStack: newStack }, events: [] }
        }
        const newStack = [...state.resolutionStack.slice(0, -1), frame]
        return { state: { ...state, resolutionStack: newStack }, events: [] }
      }
      // Push one EffectFrame per target
      const newFrames: EffectFrame[] = targets.map(targetId => ({
        type: 'Effect' as const,
        sourceId: frame.sourceId,
        controller: frame.controller,
        remaining: [node.effect],
        targets: [targetId] as CardId[],
      }))
      // Replace current frame with the per-target frames (plus remaining in last slot)
      // Keep frame.remaining on the last target's frame so execution continues after
      const lastIdx = newFrames.length - 1
      const lastFrame = newFrames[lastIdx]!
      newFrames[lastIdx] = {
        ...lastFrame,
        remaining: [...lastFrame.remaining, ...frame.remaining],
      }
      const newStack = [...state.resolutionStack.slice(0, -1), ...newFrames]
      return { state: { ...state, resolutionStack: newStack }, events: [] }
    }

    default: {
      // Should not reach here — action nodes are handled in step()
      return { state, events: [] }
    }
  }
}
