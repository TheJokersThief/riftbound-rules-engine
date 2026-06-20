import type { CardDefinition, PlayCost } from "@thejokersthief/riftbound-card-catalog";
import type { GameState, PlayerState } from "../state/types.js";

/**
 * Returns true if the card type may legally be played given the current game phase.
 */
export function checkTiming(def: CardDefinition, state: GameState): boolean {
  switch (def.cardType) {
    case "Unit":
    case "Gear":
      // Main phase only; chain open/closed does not restrict unit/gear play
      return state.phase === "Main";
    case "Spell":
      // Main phase. Playing a spell opens the chain if one is not already open.
      return state.phase === "Main";
    case "Rune":
      // Channel phase only
      return state.phase === "Channel";
    default:
      // Legends, Champions, Battlefields, ChosenChampion — not played from hand
      return false;
  }
}

/**
 * Returns true if the player has sufficient resources to pay the given play cost.
 */
export function checkResources(playCost: PlayCost | null, player: PlayerState): boolean {
  if (playCost === null) return false;
  if (player.resources.energy < playCost.energy) return false;
  if (player.resources.power < playCost.power) return false;

  // Check that the player has enough filled rune slots for all required runes
  const filledSlots = player.runePool.filter((slot) => slot.filled).length;
  if (filledSlots < playCost.runes.length) return false;

  return true;
}
