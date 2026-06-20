import type { CardCatalog } from "@thejokersthief/riftbound-card-catalog";
import type { EffectProgram } from "@thejokersthief/riftbound-effect-ir";
import type { GameEvent } from "@thejokersthief/riftbound-protocol";
import { drainEffectFrames } from "../interpreter/index.js";
import type { RulesQuery } from "../rules-query/index.js";
import type { GameState } from "../state/types.js";
import { feprStep } from "./fepr.js";
import { drainHot } from "./hot.js";

// ---------------------------------------------------------------------------
// advance — top-level chain entry point
// ---------------------------------------------------------------------------

export function advance(
  state: GameState,
  query: RulesQuery,
  catalog: CardCatalog,
  programs: ReadonlyMap<string, EffectProgram> = new Map(),
): { state: GameState; events: GameEvent[] } {
  if (state.pendingDecision !== null) {
    return { state, events: [] };
  }

  const allEvents: GameEvent[] = [];

  const progressSignal = (s: GameState): string => {
    const top = s.resolutionStack[s.resolutionStack.length - 1];
    const topTag = top ? (top.type === "Chain" ? `Chain:${top.resumeAt}` : top.type) : "none";
    const resolved = s.chain.items.filter((i) => i.resolved).length;
    return `${s.resolutionStack.length}|${topTag}|${resolved}|${s.pendingDecision?.type ?? "none"}`;
  };

  for (let guard = 0; guard < 10_000; guard++) {
    const hotResult = drainHot(state, query, catalog, programs);
    state = hotResult.state;
    allEvents.push(...hotResult.events);
    if (state.pendingDecision !== null) break;

    const top = state.resolutionStack[state.resolutionStack.length - 1];
    if (!top) break;

    const before = progressSignal(state);

    if (top.type === "Effect") {
      const r = drainEffectFrames(state, query, catalog);
      allEvents.push(...r.events);
      state = r.state;
    } else if (top.type === "Chain") {
      const r = feprStep(state, query, catalog, programs);
      allEvents.push(...r.events);
      state = r.state;
    } else {
      break;
    }

    if (state.pendingDecision !== null) break;
    if (progressSignal(state) === before) break;
  }

  return { state, events: allEvents };
}

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export { collectTriggers, drainHot } from "./hot.js";
export { feprStep } from "./fepr.js";
export { openShowdown, closeShowdown } from "./showdown.js";
