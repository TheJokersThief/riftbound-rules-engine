import type { GameEvent } from "@thejokersthief/riftbound-protocol";
import { typedObjectKeys } from "@thejokersthief/riftbound-protocol";
import type { RulesQuery } from "../rules-query/index.js";
import { fold } from "../state/fold.js";
import type { GameState } from "../state/types.js";

// ---------------------------------------------------------------------------
// runStartPhase
// ---------------------------------------------------------------------------

export function runStartPhase(
  state: GameState,
  _query: RulesQuery,
): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = [];

  const turnStarted: GameEvent = {
    type: "TurnStarted",
    turnNumber: state.turnNumber,
    activePlayerId: state.activePlayerId,
  };
  events.push(turnStarted);
  state = fold(state, turnStarted);

  const phaseStarted: GameEvent = { type: "PhaseStarted", phase: "Start" };
  events.push(phaseStarted);
  state = fold(state, phaseStarted);

  const holdEligibleIds = typedObjectKeys(state.battlefields).filter(
    (bfId) => state.battlefields[bfId]?.controllerId === state.activePlayerId,
  );

  state = { ...state, holdEligible: holdEligibleIds };

  const activePlayerId = state.activePlayerId;
  for (const card of Object.values(state.cards)) {
    if (card && card.ownerId === activePlayerId && card.exhausted) {
      const readyEvent: GameEvent = { type: "CardReadied", cardId: card.id };
      events.push(readyEvent);
      state = fold(state, readyEvent);
    }
  }

  return { state, events };
}

// ---------------------------------------------------------------------------
// runChannelPhase
// ---------------------------------------------------------------------------

export function runChannelPhase(state: GameState): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = [];

  const phaseStarted: GameEvent = { type: "PhaseStarted", phase: "Channel" };
  events.push(phaseStarted);
  state = fold(state, phaseStarted);

  state = channelOneRune(state, events);

  if (state.firstTurnSecondPlayer) {
    state = channelOneRune(state, events);
    state = { ...state, firstTurnSecondPlayer: false };
  }

  return { state, events };
}

function channelOneRune(state: GameState, events: GameEvent[]): GameState {
  const playerId = state.activePlayerId;
  const player = state.players[playerId];
  if (!player) return state;

  const runeDeck = player.runeDeck;
  if (runeDeck.length === 0) return state;

  const topCardId = runeDeck[0]!;

  const runeChanneled: GameEvent = {
    type: "RuneChanneled",
    playerId,
    cardId: topCardId,
  };
  events.push(runeChanneled);
  state = fold(state, runeChanneled);

  // fold.ts returns state unchanged for RuneChanneled, so manually update state
  const firstEmptyIndex = player.runePool.findIndex((slot) => slot.filled === false);

  const newRunePool =
    firstEmptyIndex >= 0
      ? player.runePool.map((slot, i) =>
          i === firstEmptyIndex ? { filled: true, runeCardId: topCardId } : slot,
        )
      : player.runePool;

  // Re-read player from potentially updated state reference after fold
  const currentPlayer = state.players[playerId]!;
  state = {
    ...state,
    players: {
      ...state.players,
      [playerId]: {
        ...currentPlayer,
        runeDeck: currentPlayer.runeDeck.slice(1),
        runePool: newRunePool,
      },
    },
  };

  return state;
}

// ---------------------------------------------------------------------------
// startMainPhase
// ---------------------------------------------------------------------------

export function startMainPhase(state: GameState): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  const phaseStarted: GameEvent = { type: "PhaseStarted", phase: "Main" };
  events.push(phaseStarted);
  state = fold(state, phaseStarted);
  return { state, events };
}

// ---------------------------------------------------------------------------
// startEndingPhase
// ---------------------------------------------------------------------------

export function startEndingPhase(state: GameState): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  const phaseStarted: GameEvent = { type: "PhaseStarted", phase: "Ending" };
  events.push(phaseStarted);
  state = fold(state, phaseStarted);
  return { state, events };
}

// ---------------------------------------------------------------------------
// advanceTurnEnd
// ---------------------------------------------------------------------------

export function advanceTurnEnd(state: GameState): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = [];

  const turnEnded: GameEvent = {
    type: "TurnEnded",
    turnNumber: state.turnNumber,
    activePlayerId: state.activePlayerId,
  };
  events.push(turnEnded);
  state = fold(state, turnEnded);

  const [p1, p2] = state.playerIds;
  const nextPlayerId = state.activePlayerId === p1 ? p2 : p1;

  state = {
    ...state,
    turnNumber: state.turnNumber + 1,
    activePlayerId: nextPlayerId,
  };

  return { state, events };
}
