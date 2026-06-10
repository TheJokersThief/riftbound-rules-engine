import type { CardCatalog } from "@thejokersthief/riftbound-card-catalog";
import type { EffectProgram } from "@thejokersthief/riftbound-effect-ir";
import type { BattlefieldId, CardId, GameEvent } from "@thejokersthief/riftbound-protocol";
import type { RulesQuery } from "../rules-query/index.js";
import type { GameState } from "../state/types.js";
import { applyDamageAssignments, buildDefaultAssignments } from "./damage.js";
import { resolveControl, resolveDeaths } from "./resolution.js";

export { buildDefaultAssignments, applyDamageAssignments, computeDamagePool } from "./damage.js";
export { resolveDeaths, resolveControl } from "./resolution.js";

// ---------------------------------------------------------------------------
// resolveCombat — entry point
// ---------------------------------------------------------------------------

export function resolveCombat(
  state: GameState,
  battlefieldId: BattlefieldId,
  query: RulesQuery,
  catalog: CardCatalog,
  programs?: ReadonlyMap<string, EffectProgram>,
): { state: GameState; events: GameEvent[] } {
  const bf = state.battlefields[battlefieldId];
  if (!bf) return { state, events: [] };

  const allEvents: GameEvent[] = [];
  const contestingPlayerId = state.activePlayerId;

  const attackers: CardId[] = bf.units.filter((id) => {
    const card = state.cards[id];
    return card?.ownerId === contestingPlayerId;
  });

  const defenders: CardId[] = bf.units.filter((id) => {
    const card = state.cards[id];
    return card !== undefined && card.ownerId !== contestingPlayerId;
  });

  if (attackers.length === 0 && defenders.length === 0) {
    return { state, events: [] };
  }

  const assignments = buildDefaultAssignments(attackers, defenders, query);
  const damageResult = applyDamageAssignments(state, assignments);
  state = damageResult.state;
  allEvents.push(...damageResult.events);

  const damageDealt = new Map<CardId, number>();
  for (const event of damageResult.events) {
    if (event.type === "DamageDealt") {
      const current = damageDealt.get(event.targetId) ?? 0;
      damageDealt.set(event.targetId, current + event.amount);
    }
  }

  const deathResult = resolveDeaths(state, damageDealt, query, programs, catalog);
  state = deathResult.state;
  allEvents.push(...deathResult.events);

  const controlResult = resolveControl(state, battlefieldId, contestingPlayerId);
  state = controlResult.state;
  allEvents.push(...controlResult.events);

  return { state, events: allEvents };
}
