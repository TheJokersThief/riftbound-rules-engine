/**
 * Complex simulation: chains, focus/showdown, and win condition.
 *
 * Three scenarios exercised against the real engine submit/advance loop:
 *  1. Multi-item chain — P1 and P2 both play bolt spells on the same chain.
 *     Both spells resolve LIFO (P2's fires first), both targets killed, both
 *     spells sent to their owner's trash.
 *  2. PassFocus — openShowdown issues a FocusWindow; the active player
 *     passes focus, the showdown closes cleanly.
 *  3. Win condition — with a controlled battlefield and 7 points, EndTurn
 *     scoring pushes P1 to 8 and the game ends.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { toPlayerId, toCardDefId, toMatchId } from "@thejokersthief/riftbound-protocol";
import type { BattlefieldId, CardDefId, CardId } from "@thejokersthief/riftbound-protocol";
import type { EffectProgram } from "@thejokersthief/riftbound-effect-ir";
import { createCardCatalog } from "@thejokersthief/riftbound-card-catalog";
import type { CardCatalog, CardDataSource, ProgramDataSource, CardDefinition } from "@thejokersthief/riftbound-card-catalog";
import {
  createGame,
  submit,
  createRulesQuery,
  runStartPhase,
  runChannelPhase,
  startMainPhase,
} from "../index.js";
import { openShowdown } from "../chain/index.js";
import type { GameState } from "../state/types.js";

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

const P1 = toPlayerId("p1");
const P2 = toPlayerId("p2");

const BOLT    = toCardDefId("sim2-bolt");    // Triggered WhenPlayed: Deal 3 to chosen enemy Unit
const VANILLA = toCardDefId("sim2-vanilla"); // plain 3-might unit, no abilities
const LEGEND  = toCardDefId("sim2-legend");
const CHAMP   = toCardDefId("sim2-champ");
const BF      = toCardDefId("sim2-bf");
const RUNE    = toCardDefId("sim2-rune");

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

function def(id: CardDefId, cardType: CardDefinition["cardType"], extra: Partial<CardDefinition> = {}): CardDefinition {
  return {
    id, name: String(id), cardType, set: "sim2", rarity: null, abilityText: "",
    might: cardType === "Unit" ? 3 : null,
    playCost: { energy: 0, power: 0, runes: [] },
    deckZone: cardType === "Unit" || cardType === "Spell" ? "Main"
             : cardType === "Rune" ? "Rune"
             : cardType === "Legend" ? "Legend"
             : cardType === "ChosenChampion" ? "Champion"
             : "Battlefield",
    keywords: [],
    ...extra,
  };
}

const cardSource: CardDataSource = {
  async load() {
    return [
      def(BOLT,    "Spell"),
      def(VANILLA, "Unit"),
      def(LEGEND,  "Legend"),
      def(CHAMP,   "ChosenChampion"),
      def(BF,      "Battlefield"),
      def(RUNE,    "Rune"),
    ];
  },
};

const boltProgram: EffectProgram = {
  type: "Compiled",
  abilities: [{
    type: "Triggered",
    event: { type: "WhenPlayed" },
    effect: {
      type: "Deal",
      amount: 3,
      targets: {
        scope: "Enemy", objectType: "Unit",
        location: { type: "AtBattlefields" },
        filters: [], quantity: { type: "One" }, chooser: "You",
      },
    },
  }],
};

const programSource: ProgramDataSource = {
  async load() {
    return new Map<string, EffectProgram>([[BOLT, boltProgram]]);
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toMain(state: GameState, catalog: CardCatalog): GameState {
  const query = createRulesQuery(state, catalog);
  state = runStartPhase(state, query).state;
  state = runChannelPhase(state).state;
  state = startMainPhase(state).state;
  return state;
}

/** Take a card from the player's deck and re-tag it as `defId`, then move it to hand. */
function injectCard(state: GameState, playerId: string, defId: CardDefId): { state: GameState; cardId: CardId } {
  const pid = toPlayerId(playerId);
  const deckCardId = state.players[pid]!.mainDeck[0]!;
  state = {
    ...state,
    cards: { ...state.cards, [deckCardId]: { ...state.cards[deckCardId]!, defId } },
    players: {
      ...state.players,
      [pid]: {
        ...state.players[pid]!,
        hand: [...state.players[pid]!.hand, deckCardId],
        mainDeck: state.players[pid]!.mainDeck.slice(1),
      },
    },
  };
  return { state, cardId: deckCardId };
}


// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let catalog: CardCatalog;

beforeAll(async () => {
  catalog = await createCardCatalog(cardSource, programSource);
});

function freshGame(): GameState {
  let state = createGame({
    players: [P1, P2],
    decks: {
      [P1]: { legendId: LEGEND, championId: CHAMP, battlefields: [BF, BF, BF], mainDeck: Array(40).fill(VANILLA), runeDeck: Array(10).fill(RUNE) },
      [P2]: { legendId: LEGEND, championId: CHAMP, battlefields: [BF, BF, BF], mainDeck: Array(40).fill(VANILLA), runeDeck: Array(10).fill(RUNE) },
    },
    seed: 99, matchId: toMatchId("sim2-m1"),
  });
  const active = state.activePlayerId;
  state = submit(state, { type: "KeepHand", playerId: active }, catalog).state;
  return toMain(state, catalog);
}

// ---------------------------------------------------------------------------
// Test 1: Multi-item chain
// ---------------------------------------------------------------------------

describe("multi-item chain", () => {
  it("P1 plays bolt then P2 counter-plays bolt; both resolve LIFO, both spells trashed, both targets killed", () => {
    let state = freshGame();
    const active = state.activePlayerId;
    const opp = state.playerIds[0] === active ? state.playerIds[1]! : state.playerIds[0]!;

    // Need 2 candidates per player so ChooseTargets is issued for both bolts.
    // Put 2 opp-owned units on bf1 (P1 can choose which to target).
    // Put 2 active-owned units on bf2 (P2 can choose which to target).
    const bfKeys = Object.keys(state.battlefields) as BattlefieldId[];
    const bfKey1 = bfKeys[0]!;
    const bfKey2 = bfKeys[1]!;

    const oppUnitIds = Object.values(state.cards)
      .filter((c) => c?.ownerId === opp && c.defId === VANILLA)
      .slice(0, 2)
      .map((c) => c!.id);
    const actUnitIds = Object.values(state.cards)
      .filter((c) => c?.ownerId === active && c.defId === VANILLA)
      .slice(0, 2)
      .map((c) => c!.id);

    state = {
      ...state,
      battlefields: {
        ...state.battlefields,
        [bfKey1]: { ...state.battlefields[bfKey1]!, units: oppUnitIds },
        [bfKey2]: { ...state.battlefields[bfKey2]!, units: actUnitIds },
      },
    };

    const targetForP1 = oppUnitIds[0]!;  // P1 targets this P2 unit
    const targetForP2 = actUnitIds[0]!;  // P2 targets this P1 unit

    // Give both players a bolt spell.
    const { state: s1, cardId: p1BoltId } = injectCard(state, String(active), BOLT);
    state = s1;
    const { state: s2, cardId: p2BoltId } = injectCard(state, String(opp), BOLT);
    state = s2;

    // P1 plays bolt → ChooseTargets (2 enemy units in bf1).
    let r = submit(state, { type: "PlayCard", playerId: active, cardId: p1BoltId, targets: undefined }, catalog);
    state = r.state;
    expect(state.pendingDecision?.type).toBe("ChooseTargets");
    expect(state.pendingDecision?.playerId).toBe(active);

    // P1 chooses targetForP1.
    const dec1 = state.pendingDecision as Extract<typeof state.pendingDecision, { type: "ChooseTargets" }>;
    r = submit(state, { type: "ChooseTargets", playerId: active, decisionId: dec1!.decisionId, targets: [targetForP1] }, catalog);
    state = r.state;

    // After ChooseTargets, opponent (P2) has a PriorityWindow.
    expect(state.pendingDecision?.type).toBe("PriorityWindow");
    expect(state.pendingDecision?.playerId).toBe(opp);
    expect(state.chain.isOpen).toBe(true);
    expect(state.chain.items).toHaveLength(1);

    // P2 plays their bolt during their PriorityWindow → ChooseTargets (2 active units in bf2).
    r = submit(state, { type: "PlayCard", playerId: opp, cardId: p2BoltId, targets: undefined }, catalog);
    state = r.state;
    expect(state.pendingDecision?.type).toBe("ChooseTargets");
    expect(state.pendingDecision?.playerId).toBe(opp);

    // Chain now has 2 items (no duplicate frame was pushed).
    expect(state.chain.items).toHaveLength(2);

    // P2 chooses targetForP2.
    const dec2 = state.pendingDecision as Extract<typeof state.pendingDecision, { type: "ChooseTargets" }>;
    r = submit(state, { type: "ChooseTargets", playerId: opp, decisionId: dec2!.decisionId, targets: [targetForP2] }, catalog);
    state = r.state;

    // Active player (P1) gets priority after P2 added to chain.
    expect(state.pendingDecision?.type).toBe("PriorityWindow");
    expect(state.pendingDecision?.playerId).toBe(active);

    // Both players pass priority → chain resolves (both passes needed).
    state = submit(state, { type: "PassPriority", playerId: active }, catalog).state;
    expect(state.pendingDecision?.type).toBe("PriorityWindow");
    expect(state.pendingDecision?.playerId).toBe(opp);
    state = submit(state, { type: "PassPriority", playerId: opp }, catalog).state;

    // Chain fully resolved.
    expect(state.chain.isOpen).toBe(false);
    expect(state.resolutionStack).toHaveLength(0);

    // LIFO: P2's bolt (added last) resolved first → deals 3 to targetForP2 (P1's unit) → lethal.
    //        P1's bolt resolved second → deals 3 to targetForP1 (P2's unit) → lethal.
    expect(state.players[active]!.trash).toContain(targetForP2);
    expect(state.players[opp]!.trash).toContain(targetForP1);
    expect(state.battlefields[bfKey2]!.units).not.toContain(targetForP2);
    expect(state.battlefields[bfKey1]!.units).not.toContain(targetForP1);

    // Both spells in their casters' trash.
    expect(state.players[active]!.trash).toContain(p1BoltId);
    expect(state.players[opp]!.trash).toContain(p2BoltId);
  });
});

// ---------------------------------------------------------------------------
// Test 2: PassFocus (showdown)
// ---------------------------------------------------------------------------

describe("PassFocus (showdown)", () => {
  it("openShowdown issues FocusWindow; PassFocus closes the showdown with no pending decision", () => {
    let state = freshGame();
    const bfKey = Object.keys(state.battlefields)[0]! as BattlefieldId;

    // Open a showdown.
    const { state: stateAfter } = openShowdown(state, bfKey, "Combat");
    state = stateAfter;

    expect(state.pendingDecision?.type).toBe("FocusWindow");
    expect((state.pendingDecision as Extract<typeof state.pendingDecision, { type: "FocusWindow" }>)?.battlefieldId).toBe(bfKey);
    expect(state.chain.showdown).not.toBeNull();

    // Pass focus.
    const active = state.activePlayerId;
    const r = submit(state, { type: "PassFocus", playerId: active }, catalog);
    state = r.state;

    // Showdown cleared, no pending decision.
    expect(state.pendingDecision).toBeNull();
    expect(state.chain.showdown).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Test 3: Win condition
// ---------------------------------------------------------------------------

describe("win condition", () => {
  it("reaching 8 points via EndTurn Hold scoring ends the game", () => {
    let state = freshGame();
    const active = state.activePlayerId;
    const bfKey = Object.keys(state.battlefields)[0]! as BattlefieldId;

    // Give P1 control of the first battlefield and set their points to 7.
    // Also set holdEligible to include that battlefield (simulating that it was
    // already controlled at turn start) so scoring uses Hold (not Conquer).
    state = {
      ...state,
      players: {
        ...state.players,
        [active]: { ...state.players[active]!, points: 7 },
      },
      battlefields: {
        ...state.battlefields,
        [bfKey]: { ...state.battlefields[bfKey]!, controllerId: active },
      },
      holdEligible: [bfKey],
    };

    expect(state.players[active]!.points).toBe(7);
    expect(state.status).toBe("playing");

    // EndTurn → runCleanup → checkScoring → Hold +1 → checkWinCondition → game ends.
    const r = submit(state, { type: "EndTurn", playerId: active }, catalog);
    state = r.state;

    expect(state.players[active]!.points).toBeGreaterThanOrEqual(8);
    expect(state.status).toBe("ended");
    expect(state.winner).toBe(active);
  });
});
