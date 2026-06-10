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
import type { GameState } from "../state/types.js";
import {
  advanceTurnEnd,
  attemptScore,
  checkScoring,
  checkWinCondition,
  runChannelPhase,
  runStartPhase,
} from "../turn/index.js";

// ---------------------------------------------------------------------------
// Fixture identifiers
// ---------------------------------------------------------------------------

const p1 = toPlayerId("player1");
const p2 = toPlayerId("player2");
const card1 = toCardId("card001");
const card2 = toCardId("card002");
const rune1 = toCardId("rune001");
const bf1 = toBattlefieldId("bf001");
const bf2 = toBattlefieldId("bf002");
const def1 = toCardDefId("def001");

// ---------------------------------------------------------------------------
// Card catalog fixture
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
  keywords: [],
};

const defs: Record<CardDefId, CardDefinition> = {
  [def1]: unitDef,
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
        hand: [],
        mainDeck: [toCardId("deckCard1"), toCardId("deckCard2")],
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
        mainDeck: [toCardId("deckCard3")],
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
        units: [card1],
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
// runStartPhase tests
// ---------------------------------------------------------------------------

describe("runStartPhase()", () => {
  it("emits TurnStarted and PhaseStarted(Start)", () => {
    const state = makeState();
    const query = createRulesQuery(state, mockCatalog);
    const result = runStartPhase(state, query);

    const types = result.events.map((e) => e.type);
    expect(types).toContain("TurnStarted");
    expect(types).toContain("PhaseStarted");

    const phaseEvent = result.events.find((e) => e.type === "PhaseStarted");
    expect(phaseEvent).toMatchObject({ type: "PhaseStarted", phase: "Start" });

    const turnStarted = result.events.find((e) => e.type === "TurnStarted");
    expect(turnStarted).toMatchObject({ type: "TurnStarted", turnNumber: 1, activePlayerId: p1 });
  });

  it("readies exhausted cards owned by the active player", () => {
    const state = makeState({
      cards: {
        [card1]: {
          id: card1,
          defId: def1,
          ownerId: p1,
          exhausted: true,
          buffAmount: 0,
          keywords: [],
          xp: 0,
          counters: {},
          faceDown: false,
        },
        [card2]: {
          id: card2,
          defId: def1,
          ownerId: p2,
          exhausted: true,
          buffAmount: 0,
          keywords: [],
          xp: 0,
          counters: {},
          faceDown: false,
        },
      },
    });
    const query = createRulesQuery(state, mockCatalog);
    const result = runStartPhase(state, query);

    const readiedEvents = result.events.filter((e) => e.type === "CardReadied");
    // Only the active player's card should be readied
    expect(readiedEvents).toHaveLength(1);
    expect(readiedEvents[0]).toMatchObject({ type: "CardReadied", cardId: card1 });

    // State should have card1 no longer exhausted
    expect(result.state.cards[card1]?.exhausted).toBe(false);
    // card2 (p2's card) should remain exhausted
    expect(result.state.cards[card2]?.exhausted).toBe(true);
  });

  it("snapshots holdEligible for battlefields controlled by active player", () => {
    const state = makeState({
      battlefields: {
        [bf1]: {
          id: bf1,
          cardId: toCardId("bfcard1"),
          controllerId: p1,
          units: [],
        },
        [bf2]: {
          id: bf2,
          cardId: toCardId("bfcard2"),
          controllerId: p2,
          units: [],
        },
      },
    });
    const query = createRulesQuery(state, mockCatalog);
    const result = runStartPhase(state, query);

    expect(result.state.holdEligible).toContain(bf1);
    expect(result.state.holdEligible).not.toContain(bf2);
  });
});

// ---------------------------------------------------------------------------
// runChannelPhase tests
// ---------------------------------------------------------------------------

describe("runChannelPhase()", () => {
  it("emits RuneChanneled and removes card from runeDeck when runeDeck is non-empty", () => {
    const state = makeState({
      players: {
        [p1]: {
          hand: [],
          mainDeck: [],
          runeDeck: [rune1],
          runePool: [{ filled: false, runeCardId: null }],
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
    });

    const result = runChannelPhase(state);

    const runeEvents = result.events.filter((e) => e.type === "RuneChanneled");
    expect(runeEvents).toHaveLength(1);
    expect(runeEvents[0]).toMatchObject({ type: "RuneChanneled", playerId: p1, cardId: rune1 });

    // runeDeck should be empty now
    expect(result.state.players[p1]?.runeDeck).toHaveLength(0);
    // runePool slot should be filled
    expect(result.state.players[p1]?.runePool[0]).toMatchObject({
      filled: true,
      runeCardId: rune1,
    });
  });

  it("does nothing (no RuneChanneled) when runeDeck is empty", () => {
    const state = makeState();
    // p1 starts with empty runeDeck by default
    const result = runChannelPhase(state);

    const runeEvents = result.events.filter((e) => e.type === "RuneChanneled");
    expect(runeEvents).toHaveLength(0);
  });

  it("channels two runes when firstTurnSecondPlayer is true", () => {
    const rune2 = toCardId("rune002");
    const state = makeState({
      firstTurnSecondPlayer: true,
      players: {
        [p1]: {
          hand: [],
          mainDeck: [],
          runeDeck: [rune1, rune2],
          runePool: [
            { filled: false, runeCardId: null },
            { filled: false, runeCardId: null },
          ],
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
    });

    const result = runChannelPhase(state);

    const runeEvents = result.events.filter((e) => e.type === "RuneChanneled");
    expect(runeEvents).toHaveLength(2);
    expect(result.state.firstTurnSecondPlayer).toBe(false);
    expect(result.state.players[p1]?.runeDeck).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// attemptScore tests
// ---------------------------------------------------------------------------

describe("attemptScore()", () => {
  it("Hold: always scores a point", () => {
    const state = makeState({
      battlefields: {
        [bf1]: {
          id: bf1,
          cardId: toCardId("bfcard1"),
          controllerId: p1,
          units: [],
        },
      },
    });
    const result = attemptScore(state, p1, "Hold", bf1);

    const scored = result.events.find((e) => e.type === "PointScored");
    expect(scored).toMatchObject({
      type: "PointScored",
      playerId: p1,
      method: "Hold",
      battlefieldId: bf1,
    });
    expect(result.state.players[p1]?.points).toBe(1);
  });

  it("Conquer with points < 7: scores a point", () => {
    const state = makeState({
      players: {
        [p1]: {
          hand: [],
          mainDeck: [],
          runeDeck: [],
          runePool: [],
          legendZone: toCardId("leg1"),
          championZone: toCardId("chm1"),
          base: [],
          resources: { energy: 3, power: 2 },
          points: 5,
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
          controllerId: p1,
          units: [],
        },
      },
    });
    const result = attemptScore(state, p1, "Conquer", bf1);

    const scored = result.events.find((e) => e.type === "PointScored");
    expect(scored).toBeDefined();
    expect(result.state.players[p1]?.points).toBe(6);
  });

  it("Conquer with points >= 7 and not all battlefields scored: draws a card instead", () => {
    const state = makeState({
      players: {
        [p1]: {
          hand: [],
          mainDeck: [toCardId("deckCard1")],
          runeDeck: [],
          runePool: [],
          legendZone: toCardId("leg1"),
          championZone: toCardId("chm1"),
          base: [],
          resources: { energy: 3, power: 2 },
          points: 7,
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
          controllerId: p1,
          units: [],
        },
        [bf2]: {
          id: bf2,
          cardId: toCardId("bfcard2"),
          controllerId: null,
          units: [],
        },
      },
      // Only bf1 has been scored this turn, but bf2 has not — not all battlefields scored
      scoredThisTurn: { [p1]: [bf1] },
    });

    const result = attemptScore(state, p1, "Conquer", bf1);

    const scored = result.events.find((e) => e.type === "PointScored");
    expect(scored).toBeUndefined();

    const drawn = result.events.find((e) => e.type === "CardDrawn");
    expect(drawn).toBeDefined();
    // Points unchanged
    expect(result.state.players[p1]?.points).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// checkScoring tests
// ---------------------------------------------------------------------------

describe("checkScoring()", () => {
  it("scores Hold for each controlled battlefield in holdEligible", () => {
    const state = makeState({
      battlefields: {
        [bf1]: {
          id: bf1,
          cardId: toCardId("bfcard1"),
          controllerId: p1,
          units: [],
        },
        [bf2]: {
          id: bf2,
          cardId: toCardId("bfcard2"),
          controllerId: p2,
          units: [],
        },
      },
      holdEligible: [bf1, bf2],
    });
    const query = createRulesQuery(state, mockCatalog);
    const result = checkScoring(state, p1, query);

    const scored = result.events.filter((e) => e.type === "PointScored");
    // Only bf1 is controlled by p1
    expect(scored).toHaveLength(1);
    expect(scored[0]).toMatchObject({ battlefieldId: bf1, method: "Hold" });
  });
});

// ---------------------------------------------------------------------------
// checkWinCondition tests
// ---------------------------------------------------------------------------

describe("checkWinCondition()", () => {
  it("sets status=ended when a player reaches 8+ points and leads", () => {
    const state = makeState({
      players: {
        [p1]: {
          hand: [],
          mainDeck: [],
          runeDeck: [],
          runePool: [],
          legendZone: toCardId("leg1"),
          championZone: toCardId("chm1"),
          base: [],
          resources: { energy: 3, power: 2 },
          points: 8,
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
          points: 5,
        },
      },
    });

    const result = checkWinCondition(state);
    expect(result.status).toBe("ended");
    expect(result.winner).toBe(p1);
  });

  it("does not end game when tied at 8+", () => {
    const state = makeState({
      players: {
        [p1]: {
          hand: [],
          mainDeck: [],
          runeDeck: [],
          runePool: [],
          legendZone: toCardId("leg1"),
          championZone: toCardId("chm1"),
          base: [],
          resources: { energy: 3, power: 2 },
          points: 8,
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
          points: 8,
        },
      },
    });

    const result = checkWinCondition(state);
    expect(result.status).toBe("playing");
    expect(result.winner).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// advanceTurnEnd tests
// ---------------------------------------------------------------------------

describe("advanceTurnEnd()", () => {
  it("advances activePlayerId to the other player", () => {
    const state = makeState({ activePlayerId: p1, turnNumber: 1 });
    const result = advanceTurnEnd(state);

    expect(result.state.activePlayerId).toBe(p2);
    expect(result.state.turnNumber).toBe(2);

    const turnEndedEvent = result.events.find((e) => e.type === "TurnEnded");
    expect(turnEndedEvent).toMatchObject({ type: "TurnEnded", turnNumber: 1, activePlayerId: p1 });
  });

  it("advances from p2 back to p1", () => {
    const state = makeState({ activePlayerId: p2, turnNumber: 2 });
    const result = advanceTurnEnd(state);

    expect(result.state.activePlayerId).toBe(p1);
    expect(result.state.turnNumber).toBe(3);
  });
});
