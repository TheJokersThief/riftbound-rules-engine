import type { CardCatalog, CardDefinition } from "@thejokersthief/riftbound-card-catalog";
import type {
  BattlefieldId,
  CardDefId,
  CardId,
  GameId,
  MatchId,
  PlayerId,
} from "@thejokersthief/riftbound-protocol";
import {
  toBattlefieldId,
  toCardDefId,
  toCardId,
  toGameId,
  toMatchId,
  toPlayerId,
  toZoneId,
} from "@thejokersthief/riftbound-protocol";
import { describe, expect, it } from "vitest";
import { createRulesQuery } from "../rules-query/index.js";
import { checkResources } from "../rules-query/timing.js";
import type { GameState } from "../state/types.js";

// ---------------------------------------------------------------------------
// Fixture identifiers
// ---------------------------------------------------------------------------

const p1 = toPlayerId("player1");
const p2 = toPlayerId("player2");
const card1 = toCardId("card001");
const card2 = toCardId("card002");
const bf1 = toBattlefieldId("bf001");
const def1 = toCardDefId("def001");
const def2 = toCardDefId("def002");

// ---------------------------------------------------------------------------
// Card definition fixtures
// ---------------------------------------------------------------------------

const unitDef: CardDefinition = {
  id: def1,
  name: "Test Unit",
  cardType: "Unit",
  set: "core",
  rarity: "common",
  abilityText: "",
  might: 3,
  playCost: { energy: 2, power: 1, runes: [] },
  deckZone: "Main",
  keywords: ["Rush"],
};

const cheapUnit: CardDefinition = {
  id: def2,
  name: "Cheap Unit",
  cardType: "Unit",
  set: "core",
  rarity: "common",
  abilityText: "",
  might: 0,
  playCost: { energy: 1, power: 0, runes: [] },
  deckZone: "Main",
  keywords: [],
};

const defs: Record<CardDefId, CardDefinition> = {
  [def1]: unitDef,
  [def2]: cheapUnit,
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

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    gameId: toGameId("game1"),
    matchId: toMatchId("match1"),
    playerIds: [p1, p2],
    cards: {
      [card1]: {
        id: card1,
        defId: def1,
        ownerId: p1,
        exhausted: false,
        buffAmount: 0,
        keywords: [],
        xp: 0,
        counters: {},
        faceDown: false,
      },
    },
    players: {
      [p1]: {
        hand: [card1],
        mainDeck: [],
        runeDeck: [],
        runePool: [],
        legendZone: toCardId("leg1"),
        championZone: toCardId("chm1"),
        base: [],
        resources: { energy: 3, power: 2 },
        points: 0,
      },
      [p2]: {
        hand: [],
        mainDeck: [],
        runeDeck: [],
        runePool: [],
        legendZone: toCardId("leg2"),
        championZone: toCardId("chm2"),
        base: [],
        resources: { energy: 3, power: 2 },
        points: 0,
      },
    },
    battlefields: {
      [bf1]: {
        id: bf1,
        cardId: toCardId("bfcard1"),
        controllerId: null,
        units: [],
      },
    },
    turnNumber: 1,
    activePlayerId: p1,
    phase: "Main",
    chain: { isOpen: false, items: [], priority: null, focus: null, showdown: null },
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
// mightOf tests
// ---------------------------------------------------------------------------

describe("mightOf", () => {
  it("returns base might from catalog when no buffs", () => {
    const state = makeState();
    const query = createRulesQuery(state, mockCatalog);
    expect(query.mightOf(card1)).toBe(3);
  });

  it("adds buffAmount from CardInstance to base might", () => {
    const state = makeState({
      cards: {
        [card1]: {
          id: card1,
          defId: def1,
          ownerId: p1,
          exhausted: false,
          buffAmount: 2,
          keywords: [],
          xp: 0,
          counters: {},
          faceDown: false,
        },
      },
    });
    const query = createRulesQuery(state, mockCatalog);
    expect(query.mightOf(card1)).toBe(5);
  });

  it("returns 0 for an unknown card id", () => {
    const state = makeState();
    const query = createRulesQuery(state, mockCatalog);
    expect(query.mightOf(toCardId("unknown-card"))).toBe(0);
  });

  it("caches results across repeated calls", () => {
    const state = makeState();
    const query = createRulesQuery(state, mockCatalog);
    const first = query.mightOf(card1);
    const second = query.mightOf(card1);
    expect(first).toBe(second);
  });
});

// ---------------------------------------------------------------------------
// isMighty tests
// ---------------------------------------------------------------------------

describe("isMighty", () => {
  it("returns false for a card with might 0", () => {
    const state = makeState({
      cards: {
        [card2]: {
          id: card2,
          defId: def2,
          ownerId: p1,
          exhausted: false,
          buffAmount: 0,
          keywords: [],
          xp: 0,
          counters: {},
          faceDown: false,
        },
      },
    });
    const query = createRulesQuery(state, mockCatalog);
    expect(query.isMighty(card2)).toBe(false);
  });

  it("returns true for a card with might > 0", () => {
    const state = makeState();
    const query = createRulesQuery(state, mockCatalog);
    // card1 has unitDef with might: 3
    expect(query.isMighty(card1)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// keywordsOf tests
// ---------------------------------------------------------------------------

describe("keywordsOf", () => {
  it("returns base keywords from the card definition", () => {
    const state = makeState();
    const query = createRulesQuery(state, mockCatalog);
    expect(query.keywordsOf(card1)).toContain("Rush");
  });

  it("includes instance-level granted keywords", () => {
    const state = makeState({
      cards: {
        [card1]: {
          id: card1,
          defId: def1,
          ownerId: p1,
          exhausted: false,
          buffAmount: 0,
          keywords: ["Swift"],
          xp: 0,
          counters: {},
          faceDown: false,
        },
      },
    });
    const query = createRulesQuery(state, mockCatalog);
    const kws = query.keywordsOf(card1);
    expect(kws).toContain("Rush");
    expect(kws).toContain("Swift");
  });

  it("deduplicates keywords that appear in both definition and instance", () => {
    const state = makeState({
      cards: {
        [card1]: {
          id: card1,
          defId: def1,
          ownerId: p1,
          exhausted: false,
          buffAmount: 0,
          keywords: ["Rush"], // already in def
          xp: 0,
          counters: {},
          faceDown: false,
        },
      },
    });
    const query = createRulesQuery(state, mockCatalog);
    const kws = query.keywordsOf(card1);
    expect(kws.filter((k) => k === "Rush").length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// canBePlayed tests
// ---------------------------------------------------------------------------

describe("canBePlayed", () => {
  it("returns false in Start phase (wrong timing)", () => {
    const state = makeState({ phase: "Start" });
    const query = createRulesQuery(state, mockCatalog);
    expect(query.canBePlayed(card1, p1)).toBe(false);
  });

  it("returns true for a Unit in Main phase with sufficient resources", () => {
    // p1 has energy:3, power:2; unitDef costs energy:2, power:1
    const state = makeState({ phase: "Main" });
    const query = createRulesQuery(state, mockCatalog);
    expect(query.canBePlayed(card1, p1)).toBe(true);
  });

  it("returns false when player has insufficient energy", () => {
    const state = makeState({
      phase: "Main",
      players: {
        [p1]: {
          hand: [card1],
          mainDeck: [],
          runeDeck: [],
          runePool: [],
          legendZone: toCardId("leg1"),
          championZone: toCardId("chm1"),
          base: [],
          resources: { energy: 1, power: 2 }, // needs 2 energy
          points: 0,
        },
        [p2]: {
          hand: [],
          mainDeck: [],
          runeDeck: [],
          runePool: [],
          legendZone: toCardId("leg2"),
          championZone: toCardId("chm2"),
          base: [],
          resources: { energy: 3, power: 2 },
          points: 0,
        },
      },
    });
    const query = createRulesQuery(state, mockCatalog);
    expect(query.canBePlayed(card1, p1)).toBe(false);
  });

  it("returns false for an unknown card", () => {
    const state = makeState({ phase: "Main" });
    const query = createRulesQuery(state, mockCatalog);
    expect(query.canBePlayed(toCardId("ghost-card"), p1)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkResources direct tests
// ---------------------------------------------------------------------------

describe("checkResources", () => {
  const richPlayer = {
    hand: [],
    mainDeck: [],
    runeDeck: [],
    runePool: [
      { filled: true, runeCardId: null },
      { filled: true, runeCardId: null },
    ],
    legendZone: toCardId("leg1"),
    championZone: toCardId("chm1"),
    base: [],
    resources: { energy: 5, power: 5 },
    points: 0,
  };

  it("returns false when playCost is null", () => {
    expect(checkResources(null, richPlayer)).toBe(false);
  });

  it("returns false when power is insufficient", () => {
    expect(checkResources({ energy: 1, power: 10, runes: [] }, richPlayer)).toBe(false);
  });

  it("returns false when energy is insufficient", () => {
    expect(checkResources({ energy: 10, power: 1, runes: [] }, richPlayer)).toBe(false);
  });

  it("returns false when not enough filled rune slots", () => {
    expect(
      checkResources(
        { energy: 1, power: 1, runes: ["Fire", "Fire", "Fire"] },
        richPlayer, // only 2 filled slots
      ),
    ).toBe(false);
  });

  it("returns true when all resources are sufficient", () => {
    expect(
      checkResources(
        { energy: 2, power: 2, runes: ["Fire", "Water"] },
        richPlayer, // has 2 filled slots, energy:5, power:5
      ),
    ).toBe(true);
  });
});
