import { legalActions } from "@thejokersthief/riftbound-engine";
import type { GameState } from "@thejokersthief/riftbound-engine";
import type { CardCatalog } from "@thejokersthief/riftbound-card-catalog";
import type { Action, PlayerId } from "@thejokersthief/riftbound-protocol";

/**
 * Greedy AI: resolve decisions in a fixed priority order, prefer playing cards,
 * fall back to ending the turn. Intentionally simple so games complete quickly.
 */
export function aiAction(state: GameState, playerId: PlayerId, catalog: CardCatalog): Action {
  const actions = legalActions(state, playerId, catalog);
  const byType = (t: string) => actions.find((a) => a.type === t);
  return (
    byType("KeepHand") ??
    byType("ChooseTargets") ??
    byType("PlayCard") ??
    byType("PassFocus") ??
    byType("EndTurn") ??
    byType("PassPriority") ??
    actions[0]!
  );
}
