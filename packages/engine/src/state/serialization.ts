import type { GameState } from "./types.js";
import { GameStateSchema } from "./types.js";

export function serialize(state: GameState): string {
  return JSON.stringify(state);
}

export function deserialize(s: string): GameState {
  return GameStateSchema.parse(JSON.parse(s));
}
