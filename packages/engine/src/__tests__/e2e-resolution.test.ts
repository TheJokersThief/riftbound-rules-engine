import { describe, it, expect } from "vitest";
import { toPlayerId, toCardDefId, toMatchId } from "@thejokersthief/riftbound-protocol";
import type { CardDefId } from "@thejokersthief/riftbound-protocol";
import type { EffectProgram } from "@thejokersthief/riftbound-effect-ir";
import { createCardCatalog } from "@thejokersthief/riftbound-card-catalog";
import type { CardDataSource, ProgramDataSource, CardDefinition } from "@thejokersthief/riftbound-card-catalog";
import {
  createGame, submit, legalActions, createRulesQuery,
  runStartPhase, runChannelPhase, startMainPhase,
} from "../index.js";
import type { GameState } from "../state/types.js";

const P1 = toPlayerId("p1");
const P2 = toPlayerId("p2");

// --- Curated definitions ---
const SPELL = toCardDefId("test-bolt");      // deal 3 to a chosen enemy unit (lethal to might-3)
const UNIT = toCardDefId("test-drawer");      // WhenPlayed: Draw 1
const VANILLA = toCardDefId("test-vanilla");  // plain unit, no abilities
const LEGEND = toCardDefId("test-legend");
const CHAMP = toCardDefId("test-champ");
const BF = toCardDefId("test-bf");
const RUNE = toCardDefId("test-rune");

function def(id: CardDefId, cardType: CardDefinition["cardType"], extra: Partial<CardDefinition> = {}): CardDefinition {
  return {
    id, name: String(id), cardType, set: "test", rarity: null, abilityText: "",
    might: cardType === "Unit" ? 3 : null,
    playCost: { energy: 0, power: 0, runes: [] },
    deckZone: cardType === "Unit" || cardType === "Spell" ? "Main" : cardType === "Rune" ? "Rune" : cardType === "Legend" ? "Legend" : cardType === "ChosenChampion" ? "Champion" : "Battlefield",
    keywords: [],
    ...extra,
  };
}

const cardSource: CardDataSource = {
  async load() {
    return [
      def(SPELL, "Spell"),
      def(UNIT, "Unit"),
      def(VANILLA, "Unit"),
      def(LEGEND, "Legend"),
      def(CHAMP, "ChosenChampion"),
      def(BF, "Battlefield"),
      def(RUNE, "Rune"),
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
      targets: { scope: "Enemy", objectType: "Unit", location: { type: "AtBattlefields" }, filters: [], quantity: { type: "One" }, chooser: "You" },
    },
  }],
};

const drawerProgram: EffectProgram = {
  type: "Compiled",
  abilities: [{ type: "Triggered", event: { type: "WhenPlayed" }, effect: { type: "Draw", player: "You", count: 1 } }],
};

const programSource: ProgramDataSource = {
  async load() {
    return new Map<string, EffectProgram>([
      [SPELL, boltProgram],
      [UNIT, drawerProgram],
    ]);
  },
};

function toMain(state: GameState, catalog: Awaited<ReturnType<typeof createCardCatalog>>): GameState {
  const query = createRulesQuery(state, catalog);
  state = runStartPhase(state, query).state;
  state = runChannelPhase(state).state;
  state = startMainPhase(state).state;
  return state;
}

describe("end-to-end card resolution", () => {
  it("damage spell: choose an enemy unit, deal 3 (lethal), unit dies into trash", async () => {
    const catalog = await createCardCatalog(cardSource, programSource);
    let state = createGame({
      players: [P1, P2],
      decks: {
        [P1]: { legendId: LEGEND, championId: CHAMP, battlefields: [BF, BF, BF], mainDeck: Array(40).fill(VANILLA), runeDeck: Array(10).fill(RUNE) },
        [P2]: { legendId: LEGEND, championId: CHAMP, battlefields: [BF, BF, BF], mainDeck: Array(40).fill(VANILLA), runeDeck: Array(10).fill(RUNE) },
      },
      seed: 7, matchId: toMatchId("m1"),
    });
    const active = state.activePlayerId;
    const opp = active === P1 ? P2 : P1;
    state = submit(state, { type: "KeepHand", playerId: active }, catalog).state;
    state = toMain(state, catalog);

    // Inject a spell card into the active player's hand directly.
    // We create a spell card instance by taking a card from the active player's deck
    // and retagging its defId to SPELL, then moving it to hand.
    const deckCardId = state.players[active]!.mainDeck[0]!;
    state = {
      ...state,
      cards: { ...state.cards, [deckCardId]: { ...state.cards[deckCardId]!, defId: SPELL } },
      players: {
        ...state.players,
        [active]: {
          ...state.players[active]!,
          hand: [...state.players[active]!.hand, deckCardId],
          mainDeck: state.players[active]!.mainDeck.slice(1),
        },
      },
    };
    const spellId = deckCardId;

    // Put two enemy (might-3) units on a battlefield so a choice is required.
    const enemyUnits = Object.values(state.cards).filter((c) => c!.ownerId === opp).slice(0, 2).map((c) => c!.id);
    const bfId = Object.keys(state.battlefields)[0]! as keyof typeof state.battlefields;
    state = { ...state, battlefields: { ...state.battlefields, [bfId]: { ...state.battlefields[bfId]!, units: enemyUnits } } };

    // Verify the spell is in the active player's hand.
    expect(state.players[active]!.hand).toContain(spellId);

    // Play the spell → ChooseTargets decision.
    let r = submit(state, { type: "PlayCard", playerId: active, cardId: spellId!, targets: undefined }, catalog);
    state = r.state;
    expect(state.pendingDecision?.type).toBe("ChooseTargets");

    // legalActions offers one ChooseTargets per enemy unit.
    const choices = legalActions(state, active, catalog).filter((a) => a.type === "ChooseTargets");
    expect(choices.length).toBe(2);

    // Choose the first enemy unit.
    const target = enemyUnits[0]!;
    r = submit(state, { type: "ChooseTargets", playerId: active, decisionId: (state.pendingDecision as any).decisionId, targets: [target] }, catalog);
    state = r.state;

    // Resolve the chain: opponent passes, then active passes.
    expect(state.pendingDecision?.type).toBe("PriorityWindow");
    state = submit(state, { type: "PassPriority", playerId: opp }, catalog).state;
    state = submit(state, { type: "PassPriority", playerId: active }, catalog).state;

    // 3 damage to a might-3 unit is lethal → CardKilled → target in opponent's trash;
    // chain closed; the spent spell is in the active player's trash.
    expect(state.players[opp]!.trash).toContain(target);
    expect(state.battlefields[bfId]!.units).not.toContain(target);
    expect(state.chain.isOpen).toBe(false);
    expect(state.players[active]!.trash).toContain(spellId);
  });

  it("unit ETB trigger: playing the drawer unit draws a card", async () => {
    const catalog = await createCardCatalog(cardSource, programSource);
    let state = createGame({
      players: [P1, P2],
      decks: {
        [P1]: { legendId: LEGEND, championId: CHAMP, battlefields: [BF, BF, BF], mainDeck: Array(40).fill(VANILLA), runeDeck: Array(10).fill(RUNE) },
        [P2]: { legendId: LEGEND, championId: CHAMP, battlefields: [BF, BF, BF], mainDeck: Array(40).fill(VANILLA), runeDeck: Array(10).fill(RUNE) },
      },
      seed: 7, matchId: toMatchId("m1"),
    });
    const active = state.activePlayerId;
    state = submit(state, { type: "KeepHand", playerId: active }, catalog).state;
    state = toMain(state, catalog);

    // Inject a unit card with the "drawer" defId into the active player's hand.
    const deckCardId = state.players[active]!.mainDeck[0]!;
    state = {
      ...state,
      cards: { ...state.cards, [deckCardId]: { ...state.cards[deckCardId]!, defId: UNIT } },
      players: {
        ...state.players,
        [active]: {
          ...state.players[active]!,
          hand: [...state.players[active]!.hand, deckCardId],
          mainDeck: state.players[active]!.mainDeck.slice(1),
        },
      },
    };
    const unitId = deckCardId;
    const handBefore = state.players[active]!.hand.length;

    const r = submit(state, { type: "PlayCard", playerId: active, cardId: unitId!, targets: undefined }, catalog);
    state = r.state;

    // Unit entered base; WhenPlayed → Draw 1 ran via HOT.
    expect(state.players[active]!.base).toContain(unitId);
    // Net hand change: -1 (played the unit) +1 (drew) = handBefore - 1 + 1 = handBefore.
    expect(state.players[active]!.hand.length).toBe(handBefore - 1 + 1);
  });
});
