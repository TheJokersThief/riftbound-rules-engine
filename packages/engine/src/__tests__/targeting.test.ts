import { describe, it, expect } from "vitest";
import { toPlayerId, toCardDefId, toMatchId } from "@thejokersthief/riftbound-protocol";
import { createGame, submit, fold } from "../index.js";
import { createCardCatalog, defaultSnapshotSource } from "@thejokersthief/riftbound-card-catalog";
import type { GameState } from "../state/types.js";

const P1 = toPlayerId("p1");
const P2 = toPlayerId("p2");

describe("target selection for a damage spell", () => {
  it("offers one ChooseTargets action per candidate, then applies the chosen target", async () => {
    const catalog = await createCardCatalog(defaultSnapshotSource);
    let state = createGame({
      players: [P1, P2],
      decks: {
        [P1]: { legendId: toCardDefId("ogs-017-024"), championId: toCardDefId("ogs-021-024"), battlefields: [toCardDefId("unl-t01"), toCardDefId("unl-t03"), toCardDefId("unl-205-219")], mainDeck: Array(40).fill(toCardDefId("ogn-001-298")), runeDeck: Array(10).fill(toCardDefId("ogn-007-298")) },
        [P2]: { legendId: toCardDefId("ogs-019-024"), championId: toCardDefId("ogs-023-024"), battlefields: [toCardDefId("unl-206-219"), toCardDefId("sfd-207-221"), toCardDefId("unl-207-219")], mainDeck: Array(40).fill(toCardDefId("ogn-001-298")), runeDeck: Array(10).fill(toCardDefId("ogn-007-298")) },
      },
      seed: 1,
      matchId: toMatchId("m1"),
    });
    state = submit(state, { type: "KeepHand", playerId: state.activePlayerId }, catalog).state;

    // Craft a ChooseTargets pending decision directly
    const decisionId = "dec_test";
    const enemyA = Object.values(state.cards).find((c) => c!.ownerId === P2)!.id;
    const enemyB = Object.values(state.cards).filter((c) => c!.ownerId === P2)[1]!.id;
    const bfId = Object.keys(state.battlefields)[0]!;
    state = {
      ...state,
      battlefields: { ...state.battlefields, [bfId]: { ...state.battlefields[bfId as keyof typeof state.battlefields]!, units: [enemyA, enemyB] } },
    } as GameState;

    const item = { id: "ci1", sourceId: Object.values(state.cards).find((c) => c!.ownerId === P1)!.id, defId: toCardDefId("ogn-001-298"), controller: P1, targets: [], resolved: false };
    state = fold(state, { type: "ChainOpened" });
    state = {
      ...state,
      chain: { ...state.chain, items: [item] },
      resolutionStack: [{ type: "Chain", resumeAt: "Execute" }],
      pendingDecision: { type: "ChooseTargets", playerId: P1, decisionId, prompt: "Choose a target", min: 1, max: 1 },
    } as GameState;

    const chosen = enemyA;
    const result = submit(state, { type: "ChooseTargets", playerId: P1, decisionId, targets: [chosen] }, catalog);
    const item1 = result.state.chain.items.find((i) => i.id === "ci1");
    expect(item1?.targets).toContain(chosen);
    expect(result.state.pendingDecision?.type).not.toBe("ChooseTargets");
  });
});
