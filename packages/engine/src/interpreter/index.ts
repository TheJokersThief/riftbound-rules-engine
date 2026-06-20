import type { CardCatalog } from "@thejokersthief/riftbound-card-catalog";
import type { AbilityNode, ActionNode, EffectNode, EffectProgram, SelectorNode } from "@thejokersthief/riftbound-effect-ir";
import type { GameEvent } from "@thejokersthief/riftbound-protocol";
import type { RulesQuery } from "../rules-query/index.js";
import type { EffectFrame } from "../state/stack.js";
import type { GameState } from "../state/types.js";

export function drainEffectFrames(
  state: GameState,
  query: RulesQuery,
  catalog: CardCatalog,
): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  let stepResult = step(state, query, catalog);
  while (
    stepResult.state.pendingDecision === null &&
    stepResult.state.resolutionStack.length > 0 &&
    stepResult.state.resolutionStack[stepResult.state.resolutionStack.length - 1]?.type === "Effect"
  ) {
    events.push(...stepResult.events);
    state = stepResult.state;
    stepResult = step(state, query, catalog);
  }
  events.push(...stepResult.events);
  return { state: stepResult.state, events };
}
import { executeAction } from "./actions.js";
import { dispatchNode } from "./nodes.js";

// ---------------------------------------------------------------------------
// Action type discriminator set + type predicate
// ---------------------------------------------------------------------------

const ACTION_TYPES = new Set([
  "Deal",
  "Draw",
  "Discard",
  "Move",
  "Recall",
  "ReturnToHand",
  "Buff",
  "Ready",
  "Exhaust",
  "Kill",
  "Banish",
  "CreateToken",
  "Counter",
  "AddResource",
  "GainXP",
  "SpendXP",
  "Reveal",
  "Recycle",
  "GiveMight",
  "GrantKeyword",
  "TakeExtraTurn",
]);

function isActionNode(node: EffectNode): node is ActionNode {
  return ACTION_TYPES.has(node.type);
}

// ---------------------------------------------------------------------------
// step — advance the resolution stack by one node
// ---------------------------------------------------------------------------

export function step(
  state: GameState,
  query: RulesQuery,
  catalog: CardCatalog,
): { state: GameState; events: GameEvent[] } {
  const stack = state.resolutionStack;
  if (stack.length === 0) return { state, events: [] };

  const topFrame = stack[stack.length - 1]!;

  if (topFrame.type !== "Effect") {
    // ChainFrame, CombatFrame, DecisionFrame — not handled here
    return { state, events: [] };
  }

  const frame = topFrame;

  if (frame.remaining.length === 0) {
    // Pop the exhausted frame
    const newStack = stack.slice(0, -1);
    return { state: { ...state, resolutionStack: newStack }, events: [] };
  }

  const [head, ...rest] = frame.remaining;
  // head is guaranteed non-undefined because we checked length above
  const headNode = head!;
  const updatedFrame: EffectFrame = { ...frame, remaining: rest };
  const stackWithUpdated = [...stack.slice(0, -1), updatedFrame];
  const stateWithUpdatedFrame: GameState = { ...state, resolutionStack: stackWithUpdated };

  if (isActionNode(headNode)) {
    return executeAction(headNode, updatedFrame, stateWithUpdatedFrame, query, catalog);
  }

  return dispatchNode(headNode, updatedFrame, stateWithUpdatedFrame, query, catalog);
}

export { resolveSelector, evalCondition, evalNumberExpr, resolvePlayerRef, selectCandidates } from "./selectors.js";
export { executeAction } from "./actions.js";
export { dispatchNode } from "./nodes.js";

// ---------------------------------------------------------------------------
// Target-selector helpers for chain items
// ---------------------------------------------------------------------------

export function targetSelectorOf(node: EffectNode): SelectorNode | null {
  if (node.type === "Deal") return node.targets;
  return null;
}

export function firstEffectNode(ability: AbilityNode): EffectNode | null {
  if (ability.type === "Static") return null;
  return ability.effect.type === "Sequence" ? (ability.effect.effects[0] ?? null) : ability.effect;
}

export function chainItemTargetSelector(program: EffectProgram | undefined): SelectorNode | null {
  if (!program || program.type !== "Compiled") return null;
  const ability = program.abilities.find((a) => a.type !== "Static");
  if (!ability) return null;
  const effect = firstEffectNode(ability);
  return effect ? targetSelectorOf(effect) : null;
}
