import { describe, it, expect } from "vitest";
import { toPlayerId, toCardDefId, toMatchId } from "@thejokersthief/riftbound-protocol";
import { createGame, createRulesQuery, fold } from "../index.js";
import { advance } from "../chain/index.js";
import { createCardCatalog, defaultSnapshotSource } from "@thejokersthief/riftbound-card-catalog";
import type { DeckConfig } from "../match/state.js";
import type { ChainItem, GameState } from "../state/types.js";

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

describe("advance() drives a Chain frame", () => {
  function craftChain(state: GameState, resumeAt: "Execute" | "Resolve", priority = P2): GameState {
    const sourceId = state.players[P1]!.hand[0]!;
    const defId = state.cards[sourceId]!.defId;
    const item: ChainItem = { id: "ci1", sourceId, defId, controller: P1, targets: [], resolved: false };
    state = fold(state, { type: "ChainOpened" });
    return {
      ...state,
      pendingDecision: null,
      status: "playing" as const,
      chain: { ...state.chain, items: [item], priority },
      resolutionStack: [{ type: "Chain" as const, resumeAt }],
    };
  }

  it("in Execute, yields a PriorityWindow for the priority holder", async () => {
    const catalog = await createCardCatalog(defaultSnapshotSource);
    let state = createGame({ players: [P1, P2], decks: { [P1]: deck(), [P2]: deck() }, seed: 1, matchId: toMatchId("m1") });
    state = craftChain(state, "Execute", P2);
    const query = createRulesQuery(state, catalog);
    const result = advance(state, query, catalog, catalog.programs());
    expect(result.state.pendingDecision?.type).toBe("PriorityWindow");
    if (result.state.pendingDecision?.type === "PriorityWindow") {
      expect(result.state.pendingDecision.playerId).toBe(P2);
    }
    expect(result.state.resolutionStack.at(-1)?.type).toBe("Chain");
  });

  it("in Resolve, drains the chain item and closes the chain", async () => {
    const catalog = await createCardCatalog(defaultSnapshotSource);
    let state = createGame({ players: [P1, P2], decks: { [P1]: deck(), [P2]: deck() }, seed: 1, matchId: toMatchId("m1") });
    state = craftChain(state, "Resolve", P2);
    const query = createRulesQuery(state, catalog);
    const result = advance(state, query, catalog, catalog.programs());
    expect(result.state.resolutionStack.length).toBe(0);
    expect(result.state.chain.isOpen).toBe(false);
  });
});
