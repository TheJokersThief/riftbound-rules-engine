import { describe, it, expect } from "vitest";
import { toPlayerId, toCardDefId, toMatchId, toZoneId } from "@thejokersthief/riftbound-protocol";
import { createGame, fold } from "../index.js";
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

function newGame() {
  return createGame({
    players: [P1, P2],
    decks: { [P1]: deck(), [P2]: deck() },
    seed: 1,
    matchId: toMatchId("m1"),
  });
}

describe("fold CardPlayed", () => {
  it("removes the played card from the owner's hand", () => {
    const state = newGame();
    const cardId = state.players[P1]!.hand[0]!;
    const next = fold(state, { type: "CardPlayed", playerId: P1, cardId });
    expect(next.players[P1]!.hand).not.toContain(cardId);
  });
});

describe("fold CardMoved", () => {
  it("moves a card from hand to base", () => {
    const state = newGame();
    const cardId = state.players[P1]!.hand[0]!;
    const next = fold(state, {
      type: "CardMoved",
      cardId,
      fromZone: toZoneId("hand"),
      toZone: toZoneId("base"),
    });
    expect(next.players[P1]!.hand).not.toContain(cardId);
    expect(next.players[P1]!.base).toContain(cardId);
  });

  it("routes a discard-* destination to the owner's trash", () => {
    const state = newGame();
    const cardId = state.players[P1]!.hand[0]!;
    const next = fold(state, {
      type: "CardMoved",
      cardId,
      fromZone: toZoneId("hand"),
      toZone: toZoneId(`discard-${P1}`),
    });
    expect(next.players[P1]!.trash).toContain(cardId);
  });
});
