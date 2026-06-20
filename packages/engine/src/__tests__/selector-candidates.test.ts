import { describe, it, expect } from "vitest";
import { selectCandidates } from "../interpreter/selectors.js";
import type { SelectorNode } from "@thejokersthief/riftbound-effect-ir";
import { toPlayerId, toCardDefId, toMatchId } from "@thejokersthief/riftbound-protocol";
import { createGame, createRulesQuery } from "../index.js";
import { createCardCatalog, defaultSnapshotSource } from "@thejokersthief/riftbound-card-catalog";
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

describe("selectCandidates", () => {
  it("returns all matching cards ignoring quantity", async () => {
    const catalog = await createCardCatalog(defaultSnapshotSource);
    const state = createGame({ players: [P1, P2], decks: { [P1]: deck(), [P2]: deck() }, seed: 1, matchId: toMatchId("m1") });
    const query = createRulesQuery(state, catalog);
    const sourceId = state.players[P1]!.hand[0]!;
    const selector: SelectorNode = {
      scope: "Any",
      objectType: "Card",
      location: { type: "InHand" },
      filters: [],
      quantity: { type: "One" },
      chooser: "You",
    };
    const candidates = selectCandidates(selector, state, sourceId, query, catalog);
    // Both players hold 5 cards; "One" quantity must NOT limit selectCandidates.
    expect(candidates.length).toBeGreaterThan(1);
  });
});

import { executeAction } from "../interpreter/actions.js";
import type { EffectFrame } from "../state/stack.js";

describe("Deal lethality", () => {
  it("kills a target whose accumulated damage reaches its might and trashes it", async () => {
    const catalog = await createCardCatalog(defaultSnapshotSource);
    let state = createGame({ players: [P1, P2], decks: { [P1]: deck(), [P2]: deck() }, seed: 1, matchId: toMatchId("m1") });
    // Find an enemy card with a non-zero might value.
    // ogn-001-298 is a Unit. We'll use a card in P2's hand.
    const enemy = Object.values(state.cards).find((c) => c!.ownerId === P2)!.id;
    const bfId = Object.keys(state.battlefields)[0]! as keyof typeof state.battlefields;
    // Place the enemy in a battlefield so it's a valid target.
    state = { ...state, battlefields: { ...state.battlefields, [bfId]: { ...state.battlefields[bfId]!, units: [enemy] } } };
    const query = createRulesQuery(state, catalog);
    const might = query.mightOf(enemy);
    const source = Object.values(state.cards).find((c) => c!.ownerId === P1)!.id;
    const frame: EffectFrame = { type: "Effect", sourceId: source, controller: P1, remaining: [], targets: [enemy] };
    const node = {
      type: "Deal" as const,
      amount: might > 0 ? might : 1,
      targets: {
        scope: "Enemy" as const,
        objectType: "Unit" as const,
        location: { type: "AtBattlefields" as const },
        filters: [],
        quantity: { type: "One" as const },
        chooser: "You" as const,
      },
    };
    const result = executeAction(node, frame, state, query, catalog);
    expect(result.events.some((e) => e.type === "CardKilled")).toBe(true);
    expect(result.state.players[P2]!.trash).toContain(enemy);
  });
});
