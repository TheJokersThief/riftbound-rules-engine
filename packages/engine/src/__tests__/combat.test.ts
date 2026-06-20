import type { CardCatalog, CardDefinition } from "@thejokersthief/riftbound-card-catalog";
import type { CardDefId, CardId, PlayerId } from "@thejokersthief/riftbound-protocol";
import {
  toBattlefieldId,
  toCardDefId,
  toCardId,
  toGameId,
  toMatchId,
  toPlayerId,
} from "@thejokersthief/riftbound-protocol";
import { describe, expect, it } from "vitest";
import {
  applyDamageAssignments,
  buildDefaultAssignments,
  computeDamagePool,
  resolveCombat,
  resolveControl,
  resolveDeaths,
} from "../combat/index.js";
import { createRulesQuery } from "../rules-query/index.js";
import type { GameState } from "../state/types.js";

// ---------------------------------------------------------------------------
// Fixture identifiers
// ---------------------------------------------------------------------------

const p1 = toPlayerId("player1");
const p2 = toPlayerId("player2");
const card1 = toCardId("card001"); // p1 attacker, might 3
const card2 = toCardId("card002"); // p2 defender, might 2
const card3 = toCardId("card003"); // p2 tank defender, might 1
const card4 = toCardId("card004"); // p1 attacker, might 2
const bf1 = toBattlefieldId("bf001");
const def1 = toCardDefId("def001"); // might 3, no keywords
const def2 = toCardDefId("def002"); // might 2, no keywords
const def3 = toCardDefId("def003"); // might 1, Tank keyword
const def4 = toCardDefId("def004"); // might 2, no keywords

// ---------------------------------------------------------------------------
// Card definition fixtures
// ---------------------------------------------------------------------------

const unitDef1: CardDefinition = {
  id: def1,
  name: "Attacker",
  cardType: "Unit",
  set: "core",
  rarity: "common",
  abilityText: "",
  might: 3,
  playCost: { energy: 2, power: 1, runes: [] },
  deckZone: "Main",
  keywords: [],
};

const unitDef2: CardDefinition = {
  id: def2,
  name: "Defender",
  cardType: "Unit",
  set: "core",
  rarity: "common",
  abilityText: "",
  might: 2,
  playCost: { energy: 1, power: 1, runes: [] },
  deckZone: "Main",
  keywords: [],
};

const tankDef: CardDefinition = {
  id: def3,
  name: "Tank Unit",
  cardType: "Unit",
  set: "core",
  rarity: "common",
  abilityText: "",
  might: 1,
  playCost: { energy: 1, power: 0, runes: [] },
  deckZone: "Main",
  keywords: ["Tank"],
};

const unitDef4: CardDefinition = {
  id: def4,
  name: "Attacker 2",
  cardType: "Unit",
  set: "core",
  rarity: "common",
  abilityText: "",
  might: 2,
  playCost: { energy: 1, power: 1, runes: [] },
  deckZone: "Main",
  keywords: [],
};

const defs: Record<CardDefId, CardDefinition> = {
  [def1]: unitDef1,
  [def2]: unitDef2,
  [def3]: tankDef,
  [def4]: unitDef4,
};

const mockCatalog: CardCatalog = {
  get: (id) => {
    const d = defs[id];
    if (!d) throw new Error(`unknown ${id}`);
    return d;
  },
  find: (id) => defs[id] ?? null,
  all: () => Object.values(defs),
};

// ---------------------------------------------------------------------------
// State factory
// ---------------------------------------------------------------------------

function makeCardInstance(
  id: CardId,
  defId: CardDefId,
  ownerId: PlayerId,
  extraKeywords: string[] = [],
) {
  return {
    id,
    defId,
    ownerId,
    exhausted: false,
    buffAmount: 0,
    damage: 0,
    keywords: extraKeywords,
    xp: 0,
    counters: {},
    faceDown: false,
  };
}

function makePlayerState(extra: Partial<{ legendZone: CardId; championZone: CardId }> = {}) {
  return {
    hand: [],
    mainDeck: [],
    runeDeck: [],
    runePool: [],
    legendZone: extra.legendZone ?? toCardId("leg-placeholder"),
    championZone: extra.championZone ?? toCardId("chm-placeholder"),
    base: [],
    trash: [],
    resources: { energy: 3, power: 2 },
    points: 0,
  };
}

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    gameId: toGameId("game1"),
    matchId: toMatchId("match1"),
    playerIds: [p1, p2],
    cards: {
      [card1]: makeCardInstance(card1, def1, p1),
      [card2]: makeCardInstance(card2, def2, p2),
      [card3]: makeCardInstance(card3, def3, p2), // tank
      [card4]: makeCardInstance(card4, def4, p1),
    },
    players: {
      [p1]: makePlayerState({ legendZone: toCardId("leg1"), championZone: toCardId("chm1") }),
      [p2]: makePlayerState({ legendZone: toCardId("leg2"), championZone: toCardId("chm2") }),
    },
    battlefields: {
      [bf1]: {
        id: bf1,
        cardId: toCardId("bfcard1"),
        controllerId: null,
        units: [card1, card2],
      },
    },
    turnNumber: 1,
    activePlayerId: p1,
    phase: "Main",
    chain: { isOpen: false, passes: 0, items: [], priority: null, focus: null, showdown: null },
    resolutionStack: [],
    pendingDecision: null,
    rng: { seed: 12345 },
    scoredThisTurn: {},
    status: "playing",
    winner: null,
    hotQueue: [],
    holdEligible: [],
    firstTurnSecondPlayer: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// computeDamagePool
// ---------------------------------------------------------------------------

describe("computeDamagePool", () => {
  it("returns correct attackers and total damage for contesting player", () => {
    const state = makeState({
      battlefields: {
        [bf1]: {
          id: bf1,
          cardId: toCardId("bfcard1"),
          controllerId: null,
          units: [card1, card2], // card1 is p1, card2 is p2
        },
      },
    });
    const query = createRulesQuery(state, mockCatalog);
    const result = computeDamagePool(bf1, p1, state, query);
    expect(result.attackers).toEqual([card1]);
    expect(result.totalDamage).toBe(3); // def1 has might 3
  });

  it("returns zero damage when no units at battlefield", () => {
    const state = makeState({
      battlefields: {
        [bf1]: {
          id: bf1,
          cardId: toCardId("bfcard1"),
          controllerId: null,
          units: [],
        },
      },
    });
    const query = createRulesQuery(state, mockCatalog);
    const result = computeDamagePool(bf1, p1, state, query);
    expect(result.attackers).toEqual([]);
    expect(result.totalDamage).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// buildDefaultAssignments
// ---------------------------------------------------------------------------

describe("buildDefaultAssignments", () => {
  it("assigns attacker to defender in order", () => {
    const state = makeState();
    const query = createRulesQuery(state, mockCatalog);
    const assignments = buildDefaultAssignments([card1], [card2], query);
    expect(assignments).toHaveLength(1);
    expect(assignments[0]).toMatchObject({
      attackerId: card1,
      targetId: card2,
      amount: 3,
    });
  });

  it("assigns to Tank units first before non-Tank", () => {
    // card3 is tank (def3), card2 is non-tank (def2)
    const state = makeState();
    const query = createRulesQuery(state, mockCatalog);
    // Two attackers: card1 and card4; defenders: card2 (non-tank), card3 (tank)
    const assignments = buildDefaultAssignments([card1, card4], [card2, card3], query);
    // Tank (card3) should be targeted before non-tank (card2)
    expect(assignments).toHaveLength(2);
    expect(assignments[0]?.targetId).toBe(card3); // tank first
    expect(assignments[1]?.targetId).toBe(card2); // non-tank second
  });

  it("returns empty array when there are no defenders", () => {
    const state = makeState();
    const query = createRulesQuery(state, mockCatalog);
    const assignments = buildDefaultAssignments([card1], [], query);
    expect(assignments).toHaveLength(0);
  });

  it("returns empty array when there are no attackers", () => {
    const state = makeState();
    const query = createRulesQuery(state, mockCatalog);
    const assignments = buildDefaultAssignments([], [card2], query);
    expect(assignments).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// applyDamageAssignments
// ---------------------------------------------------------------------------

describe("applyDamageAssignments", () => {
  it("emits DamageDealt events for each assignment", () => {
    const state = makeState();
    const assignments = [{ attackerId: card1, targetId: card2, amount: 3 }];
    const result = applyDamageAssignments(state, assignments);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      type: "DamageDealt",
      sourceId: card1,
      targetId: card2,
      amount: 3,
      bonus: 0,
    });
  });

  it("folds each event into state and returns updated state", () => {
    const state = makeState();
    const assignments = [{ attackerId: card1, targetId: card2, amount: 3 }];
    const result = applyDamageAssignments(state, assignments);
    // DamageDealt is a no-op fold, so state should be same reference shape but stable
    expect(result.state).toBeDefined();
    expect(result.state.gameId).toBe("game1");
  });

  it("emits multiple events for multiple assignments", () => {
    const state = makeState();
    const assignments = [
      { attackerId: card1, targetId: card2, amount: 3 },
      { attackerId: card4, targetId: card3, amount: 2 },
    ];
    const result = applyDamageAssignments(state, assignments);
    expect(result.events).toHaveLength(2);
    expect(result.events[0]?.type).toBe("DamageDealt");
    expect(result.events[1]?.type).toBe("DamageDealt");
  });
});

// ---------------------------------------------------------------------------
// resolveDeaths
// ---------------------------------------------------------------------------

describe("resolveDeaths", () => {
  it("kills a unit when damage equals or exceeds might", () => {
    // card2 has might 2; deal 2 damage
    const state = makeState({
      battlefields: {
        [bf1]: {
          id: bf1,
          cardId: toCardId("bfcard1"),
          controllerId: null,
          units: [card1, card2],
        },
      },
    });
    const query = createRulesQuery(state, mockCatalog);
    const damageDealt = new Map<CardId, number>([[card2, 2]]);
    const result = resolveDeaths(state, damageDealt, query);
    const killedEvents = result.events.filter((e) => e.type === "CardKilled");
    expect(killedEvents).toHaveLength(1);
    expect(killedEvents[0]).toMatchObject({ type: "CardKilled", cardId: card2 });
    // card2 should be removed from the battlefield units
    expect(result.state.battlefields[bf1]?.units).not.toContain(card2);
  });

  it("does not kill a unit when damage is less than might", () => {
    // card2 has might 2; deal 1 damage
    const state = makeState({
      battlefields: {
        [bf1]: {
          id: bf1,
          cardId: toCardId("bfcard1"),
          controllerId: null,
          units: [card1, card2],
        },
      },
    });
    const query = createRulesQuery(state, mockCatalog);
    const damageDealt = new Map<CardId, number>([[card2, 1]]);
    const result = resolveDeaths(state, damageDealt, query);
    const killedEvents = result.events.filter((e) => e.type === "CardKilled");
    expect(killedEvents).toHaveLength(0);
    expect(result.state.battlefields[bf1]?.units).toContain(card2);
  });

  it("emits CardMoved after CardKilled", () => {
    const state = makeState({
      battlefields: {
        [bf1]: {
          id: bf1,
          cardId: toCardId("bfcard1"),
          controllerId: null,
          units: [card1, card2],
        },
      },
    });
    const query = createRulesQuery(state, mockCatalog);
    const damageDealt = new Map<CardId, number>([[card2, 2]]);
    const result = resolveDeaths(state, damageDealt, query);
    const movedEvents = result.events.filter((e) => e.type === "CardMoved");
    expect(movedEvents).toHaveLength(1);
    expect(movedEvents[0]).toMatchObject({
      type: "CardMoved",
      cardId: card2,
    });
  });
});

// ---------------------------------------------------------------------------
// resolveControl
// ---------------------------------------------------------------------------

describe("resolveControl", () => {
  it("emits ControlChanged when contesting player has units and defender has none", () => {
    // Only p1 units remain
    const state = makeState({
      battlefields: {
        [bf1]: {
          id: bf1,
          cardId: toCardId("bfcard1"),
          controllerId: null,
          units: [card1], // only p1's card
        },
      },
    });
    const result = resolveControl(state, bf1, p1);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      type: "ControlChanged",
      battlefieldId: bf1,
      newControllerId: p1,
    });
    expect(result.state.battlefields[bf1]?.controllerId).toBe(p1);
  });

  it("does not emit ControlChanged when both players have units", () => {
    // Both players have units
    const state = makeState({
      battlefields: {
        [bf1]: {
          id: bf1,
          cardId: toCardId("bfcard1"),
          controllerId: null,
          units: [card1, card2], // p1 and p2 units
        },
      },
    });
    const result = resolveControl(state, bf1, p1);
    expect(result.events).toHaveLength(0);
  });

  it("does not emit ControlChanged when contesting player has no units", () => {
    // Only p2 units remain, p1 is contesting
    const state = makeState({
      battlefields: {
        [bf1]: {
          id: bf1,
          cardId: toCardId("bfcard1"),
          controllerId: null,
          units: [card2], // only p2's card
        },
      },
    });
    const result = resolveControl(state, bf1, p1);
    expect(result.events).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// resolveCombat — end-to-end
// ---------------------------------------------------------------------------

describe("resolveCombat", () => {
  it("attacker kills defender and control changes", () => {
    // p1 (activePlayer) has card1 (might 3) vs p2 card2 (might 2)
    // 3 damage >= might 2, so card2 dies; only p1 unit remains → control changes
    const state = makeState({
      battlefields: {
        [bf1]: {
          id: bf1,
          cardId: toCardId("bfcard1"),
          controllerId: null,
          units: [card1, card2],
        },
      },
    });
    const query = createRulesQuery(state, mockCatalog);
    const result = resolveCombat(state, bf1, query, mockCatalog);

    const damageEvents = result.events.filter((e) => e.type === "DamageDealt");
    expect(damageEvents).toHaveLength(1);

    const killedEvents = result.events.filter((e) => e.type === "CardKilled");
    expect(killedEvents).toHaveLength(1);
    expect(killedEvents[0]).toMatchObject({ cardId: card2 });

    const controlEvents = result.events.filter((e) => e.type === "ControlChanged");
    expect(controlEvents).toHaveLength(1);
    expect(controlEvents[0]).toMatchObject({
      type: "ControlChanged",
      battlefieldId: bf1,
      newControllerId: p1,
    });
  });

  it("returns state unchanged when no units on battlefield", () => {
    const state = makeState({
      battlefields: {
        [bf1]: {
          id: bf1,
          cardId: toCardId("bfcard1"),
          controllerId: null,
          units: [],
        },
      },
    });
    const query = createRulesQuery(state, mockCatalog);
    const result = resolveCombat(state, bf1, query, mockCatalog);

    expect(result.events).toHaveLength(0);
    expect(result.state).toBe(state);
  });
});
