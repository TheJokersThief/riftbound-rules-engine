import { describe, it, expect } from "vitest";
import { toPlayerId, toCardDefId, toMatchId } from "@thejokersthief/riftbound-protocol";
import { createGame, serialize, deserialize } from "../index.js";
import type { DeckConfig } from "../match/state.js";

const P1 = toPlayerId("p1");
const P2 = toPlayerId("p2");

function deck(): DeckConfig {
  return {
    legendId: toCardDefId("ogs-017-024"),
    championId: toCardDefId("ogs-021-024"),
    battlefields: [toCardDefId("unl-t01"), toCardDefId("unl-t03"), toCardDefId("unl-205-219")],
    mainDeck: Array(40).fill(toCardDefId("ogn-001-298")),
    runeDeck: Array(10).fill(toCardDefId("ogn-007-298")),
  };
}

describe("new state fields", () => {
  it("initializes damage=0 on every card, trash=[] per player, passes=0", () => {
    const state = createGame({
      players: [P1, P2],
      decks: { [P1]: deck(), [P2]: deck() },
      seed: 1,
      matchId: toMatchId("m1"),
    });
    for (const card of Object.values(state.cards)) {
      expect(card!.damage).toBe(0);
    }
    expect(state.players[P1]!.trash).toEqual([]);
    expect(state.players[P2]!.trash).toEqual([]);
    expect(state.chain.passes).toBe(0);
  });

  it("round-trips the new fields through serialize/deserialize", () => {
    const state = createGame({
      players: [P1, P2],
      decks: { [P1]: deck(), [P2]: deck() },
      seed: 1,
      matchId: toMatchId("m1"),
    });
    const restored = deserialize(serialize(state));
    expect(restored.players[P1]!.trash).toEqual([]);
    expect(Object.values(restored.cards)[0]!.damage).toBe(0);
    expect(restored.chain.passes).toBe(0);
  });
});
