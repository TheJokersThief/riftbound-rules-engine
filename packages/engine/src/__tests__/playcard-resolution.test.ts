import { describe, it, expect } from "vitest";
import { toPlayerId, toCardDefId, toMatchId } from "@thejokersthief/riftbound-protocol";
import { createGame, submit, createRulesQuery, runStartPhase, runChannelPhase, startMainPhase } from "../index.js";
import { createCardCatalog, defaultSnapshotSource } from "@thejokersthief/riftbound-card-catalog";
import type { DeckConfig } from "../match/state.js";
import type { GameState } from "../state/types.js";

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

function toMain(state: GameState, catalog: Awaited<ReturnType<typeof createCardCatalog>>): GameState {
  const query = createRulesQuery(state, catalog);
  state = runStartPhase(state, query).state;
  state = runChannelPhase(state).state;
  state = startMainPhase(state).state;
  return state;
}

describe("PlayCard resolution", () => {
  it("a played unit leaves hand and enters base", async () => {
    const catalog = await createCardCatalog(defaultSnapshotSource);
    let state = createGame({ players: [P1, P2], decks: { [P1]: deck(), [P2]: deck() }, seed: 1, matchId: toMatchId("m1") });
    state = submit(state, { type: "KeepHand", playerId: state.activePlayerId }, catalog).state;
    const active = state.activePlayerId;
    state = toMain(state, catalog);
    // ogn-001-298 is a Unit. Find a unit card in hand.
    const unitCardId = state.players[active]!.hand.find(
      (id) => catalog.find(state.cards[id]!.defId)?.cardType === "Unit",
    );
    expect(unitCardId).toBeDefined();
    // Give the active player enough energy to afford any card in hand.
    state = {
      ...state,
      players: {
        ...state.players,
        [active]: { ...state.players[active]!, resources: { energy: 10, power: 10 } },
      },
    };
    const result = submit(state, { type: "PlayCard", playerId: active, cardId: unitCardId!, targets: undefined }, catalog);
    expect(result.state.players[active]!.hand).not.toContain(unitCardId);
    expect(result.state.players[active]!.base).toContain(unitCardId);
  });
});
