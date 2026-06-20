import { describe, it, expect } from "vitest";
import { toPlayerId, toCardDefId, toMatchId } from "@thejokersthief/riftbound-protocol";
import { createGame, fold, createRulesQuery } from "../index.js";
import { runCleanup } from "../turn/cleanup.js";
import { createCardCatalog, defaultSnapshotSource } from "@thejokersthief/riftbound-card-catalog";
import type { DeckConfig } from "../match/state.js";

const P1 = toPlayerId("p1");
const P2 = toPlayerId("p2");
const catalog = await createCardCatalog(defaultSnapshotSource);

function deck(): DeckConfig {
  return {
    legendId: toCardDefId("ogs-017-024"),
    championId: toCardDefId("ogs-021-024"),
    battlefields: [toCardDefId("unl-t01"), toCardDefId("unl-t03"), toCardDefId("unl-205-219")],
    mainDeck: Array(40).fill(toCardDefId("ogn-001-298")),
    runeDeck: Array(10).fill(toCardDefId("ogn-007-298")),
  };
}

describe("cleanup resets damage", () => {
  it("clears all card damage during runCleanup", () => {
    let state = createGame({ players: [P1, P2], decks: { [P1]: deck(), [P2]: deck() }, seed: 1, matchId: toMatchId("m1") });
    const cardId = state.players[P1]!.hand[0]!;
    state = fold(state, { type: "DamageDealt", sourceId: cardId, targetId: cardId, amount: 3, bonus: 0 });
    expect(state.cards[cardId]!.damage).toBe(3);
    const query = createRulesQuery(state, catalog);
    const result = runCleanup(state, P1, query, catalog);
    expect(result.state.cards[cardId]!.damage).toBe(0);
  });
});
