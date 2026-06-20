import type { CardCatalog } from "@thejokersthief/riftbound-card-catalog";
import type { EffectProgram } from "@thejokersthief/riftbound-effect-ir";
import type { GameEvent } from "@thejokersthief/riftbound-protocol";
import { toZoneId } from "@thejokersthief/riftbound-protocol";
import { step } from "../interpreter/index.js";
import type { RulesQuery } from "../rules-query/index.js";
import { fold } from "../state/fold.js";
import type { EffectFrame } from "../state/stack.js";
import type { GameState } from "../state/types.js";
import { drainHot } from "./hot.js";

// ---------------------------------------------------------------------------
// feprStep — one iteration of the FEPR loop
// ---------------------------------------------------------------------------

export function feprStep(
  state: GameState,
  query: RulesQuery,
  catalog: CardCatalog,
  programs: ReadonlyMap<string, EffectProgram>,
): { state: GameState; events: GameEvent[] } {
  const allEvents: GameEvent[] = [];

  const hotResult = drainHot(state, query, catalog, programs);
  state = hotResult.state;
  allEvents.push(...hotResult.events);

  if (state.pendingDecision !== null) {
    return { state, events: allEvents };
  }

  const topFrame = state.resolutionStack[state.resolutionStack.length - 1];
  if (!topFrame || topFrame.type !== "Chain") {
    return { state, events: allEvents };
  }

  switch (topFrame.resumeAt) {
    case "Finalize": {
      const updatedFrame = { ...topFrame, resumeAt: "Execute" as const };
      state = {
        ...state,
        resolutionStack: [...state.resolutionStack.slice(0, -1), updatedFrame],
      };
      return feprStep(state, query, catalog, programs);
    }

    case "Execute": {
      state = {
        ...state,
        pendingDecision: {
          type: "PriorityWindow",
          playerId: state.chain.priority ?? state.activePlayerId,
        },
      };
      return { state, events: allEvents };
    }

    case "Pass": {
      const updatedFrame = { ...topFrame, resumeAt: "Resolve" as const };
      state = {
        ...state,
        resolutionStack: [...state.resolutionStack.slice(0, -1), updatedFrame],
      };
      return feprStep(state, query, catalog, programs);
    }

    case "Resolve": {
      const unresolved = [...state.chain.items].reverse().find((item) => !item.resolved);

      if (!unresolved) {
        const chainClosedEvent: GameEvent = { type: "ChainClosed" };
        state = fold(state, chainClosedEvent);
        allEvents.push(chainClosedEvent);
        state = {
          ...state,
          resolutionStack: state.resolutionStack.slice(0, -1),
        };
        return { state, events: allEvents };
      }

      const trashIfSpell = (s: GameState): GameState => {
        const sourceDef = catalog.find(unresolved.defId);
        if (sourceDef?.cardType !== "Spell") return s;
        const owner = s.cards[unresolved.sourceId]?.ownerId;
        if (!owner) return s;
        const moveEvent: GameEvent = {
          type: "CardMoved",
          cardId: unresolved.sourceId,
          fromZone: toZoneId("inflight"),
          toZone: toZoneId(`discard-${owner}`),
        };
        allEvents.push(moveEvent);
        return fold(s, moveEvent);
      };

      const program = programs.get(unresolved.defId);
      if (!program || program.type === "Unparsed") {
        state = {
          ...state,
          chain: {
            ...state.chain,
            items: state.chain.items.map((item) =>
              item.id === unresolved.id ? { ...item, resolved: true } : item,
            ),
          },
        };
        state = trashIfSpell(state);
        return feprStep(state, query, catalog, programs);
      }

      state = {
        ...state,
        chain: {
          ...state.chain,
          items: state.chain.items.map((item) =>
            item.id === unresolved.id ? { ...item, resolved: true } : item,
          ),
        },
      };

      const playAbility = program.abilities.find(
        (a): a is Extract<typeof a, { type: "Triggered" | "Activated" }> => a.type !== "Static",
      );
      if (playAbility) {
        const effectNodes =
          playAbility.effect.type === "Sequence"
            ? playAbility.effect.effects
            : [playAbility.effect];

        const frame: EffectFrame = {
          type: "Effect",
          sourceId: unresolved.sourceId,
          controller: unresolved.controller,
          remaining: effectNodes,
          targets: unresolved.targets,
        };
        state = { ...state, resolutionStack: [...state.resolutionStack, frame] };

        let stepResult = step(state, query, catalog);
        while (
          stepResult.state.pendingDecision === null &&
          stepResult.state.resolutionStack.length > 0 &&
          stepResult.state.resolutionStack[stepResult.state.resolutionStack.length - 1]?.type ===
            "Effect"
        ) {
          allEvents.push(...stepResult.events);
          state = stepResult.state;
          stepResult = step(state, query, catalog);
        }
        allEvents.push(...stepResult.events);
        state = stepResult.state;
      }

      state = trashIfSpell(state);
      return { state, events: allEvents };
    }
  }
}
