/**
 * Full-game simulation: real compiled card effects, greedy AI on both seats,
 * run to a real winner. End-to-end proof the engine + catalog + AI play a
 * complete game without throwing or looping forever.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { toPlayerId, toCardDefId, toMatchId } from "@thejokersthief/riftbound-protocol";
import type { Action, BattlefieldId, PlayerId } from "@thejokersthief/riftbound-protocol";
import {
  createCardCatalog,
  defaultSnapshotSource,
  defaultProgramSource,
} from "@thejokersthief/riftbound-card-catalog";
import type { CardCatalog } from "@thejokersthief/riftbound-card-catalog";
import type { DeckConfig, GameState } from "@thejokersthief/riftbound-engine";
import {
  createGame, submit, legalActions, createRulesQuery,
  runStartPhase, runChannelPhase, startMainPhase, resolveCombat,
} from "../index.js";

const HUMAN = toPlayerId("aria");
const AI = toPlayerId("bowen");

const RUNE_IDS = [
  "ogn-007-298","ogn-007a-298","ogn-042-298","ogn-042a-298","ogn-089a-298",
  "ogn-089-298","ogn-126a-298","ogn-126-298","ogn-166-298","ogn-166a-298",
].map(toCardDefId);
const UNIT_POOL = [
  "ogn-001-298","ogs-001-024","unl-001-219","sfd-002-221","ogn-002-298",
  "unl-002-219","ogn-003-298","unl-003-219","ogs-004-024","unl-004-219",
  "ogs-005-024","unl-005-219","ogs-006-024","sfd-006-221","ogn-004-298",
].map(toCardDefId);
function buildMainDeck() {
  const deck: typeof UNIT_POOL = [];
  let i = 0;
  while (deck.length < 40) { deck.push(UNIT_POOL[i % UNIT_POOL.length]!); i++; }
  return deck;
}
const ARIA_DECK: DeckConfig = {
  legendId: toCardDefId("ogs-017-024"), championId: toCardDefId("ogs-021-024"),
  battlefields: [toCardDefId("unl-t01"), toCardDefId("unl-t03"), toCardDefId("unl-205-219")],
  mainDeck: buildMainDeck(), runeDeck: RUNE_IDS,
};
const BOWEN_DECK: DeckConfig = {
  legendId: toCardDefId("ogs-019-024"), championId: toCardDefId("ogs-023-024"),
  battlefields: [toCardDefId("unl-206-219"), toCardDefId("sfd-207-221"), toCardDefId("unl-207-219")],
  mainDeck: buildMainDeck(), runeDeck: RUNE_IDS,
};

function greedyAi(state: GameState, playerId: PlayerId, catalog: CardCatalog): Action {
  const actions = legalActions(state, playerId, catalog);
  const byType = (t: string) => actions.find((a) => a.type === t);
  return (
    byType("KeepHand") ?? byType("ChooseTargets") ?? byType("PlayCard") ??
    byType("PassFocus") ?? byType("EndTurn") ?? byType("PassPriority") ?? actions[0]!
  );
}
function advanceToMain(state: GameState, catalog: CardCatalog): GameState {
  const query = createRulesQuery(state, catalog);
  state = runStartPhase(state, query).state;
  state = runChannelPhase(state).state;
  state = startMainPhase(state).state;
  return state;
}
function deployAndContest(state: GameState, active: PlayerId, catalog: CardCatalog): GameState {
  const baseUnits = state.players[active]?.base ?? [];
  if (baseUnits.length === 0) return state;
  const bfKeys = Object.keys(state.battlefields) as BattlefieldId[];
  const target = bfKeys.find((b) => state.battlefields[b]?.controllerId !== active) ?? bfKeys[0];
  if (!target) return state;
  state = {
    ...state,
    players: { ...state.players, [active]: { ...state.players[active]!, base: [] } },
    battlefields: {
      ...state.battlefields,
      [target]: { ...state.battlefields[target]!, units: [...state.battlefields[target]!.units, ...baseUnits] },
    },
  };
  const query = createRulesQuery(state, catalog);
  return resolveCombat(state, target, query, catalog).state;
}

let catalog: CardCatalog;
beforeAll(async () => { catalog = await createCardCatalog(defaultSnapshotSource, defaultProgramSource); });

describe("full-game simulation", () => {
  it("plays a complete game with real cards to a real winner", () => {
    let state = createGame({
      players: [HUMAN, AI],
      decks: { [HUMAN]: ARIA_DECK, [AI]: BOWEN_DECK },
      seed: 1234, matchId: toMatchId("sim-full-1"),
    });
    const MAX_ITERATIONS = 500;
    let iterations = 0;
    let lastTurnDeployed = -1;
    while (state.status !== "ended" && iterations < MAX_ITERATIONS) {
      iterations++;
      if (state.pendingDecision) {
        const decider = state.pendingDecision.playerId;
        state = submit(state, greedyAi(state, decider, catalog), catalog).state;
        continue;
      }
      const active = state.activePlayerId;
      if (state.phase !== "Main") { state = advanceToMain(state, catalog); continue; }
      const action = greedyAi(state, active, catalog);
      if (action.type === "PlayCard") { state = submit(state, action, catalog).state; continue; }
      if (lastTurnDeployed !== state.turnNumber) {
        lastTurnDeployed = state.turnNumber;
        state = deployAndContest(state, active, catalog);
        continue;
      }
      state = submit(state, { type: "EndTurn", playerId: active }, catalog).state;
    }
    expect(iterations).toBeLessThan(MAX_ITERATIONS);
    expect(state.status).toBe("ended");
    expect(state.winner).not.toBeNull();
    const winner = state.winner!;
    const loser = state.playerIds.find((p) => p !== winner)!;
    expect(state.players[winner]!.points).toBeGreaterThanOrEqual(8);
    expect(state.players[winner]!.points).toBeGreaterThan(state.players[loser]!.points);
  });
});
