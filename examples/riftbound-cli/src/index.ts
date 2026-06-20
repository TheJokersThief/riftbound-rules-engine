import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output, argv, exit } from "node:process";
import { toPlayerId, toMatchId } from "@thejokersthief/riftbound-protocol";
import type { BattlefieldId, PlayerId, GameEvent } from "@thejokersthief/riftbound-protocol";
import {
  createCardCatalog,
  defaultSnapshotSource,
  defaultProgramSource,
} from "@thejokersthief/riftbound-card-catalog";
import type { CardCatalog } from "@thejokersthief/riftbound-card-catalog";
import {
  createGame,
  submit,
  legalActions,
  createRulesQuery,
  runStartPhase,
  runChannelPhase,
  startMainPhase,
  resolveCombat,
} from "@thejokersthief/riftbound-engine";
import type { GameState } from "@thejokersthief/riftbound-engine";
import { DEFAULT_HUMAN_DECK, DEFAULT_AI_DECK, loadDeckFromFile } from "./decks.js";
import { aiAction } from "./ai.js";
import { printHeader, printBoard, printEvents, printActions } from "./display.js";

const HUMAN = toPlayerId("you");
const AI = toPlayerId("cpu");

function parseFlag(name: string): string | undefined {
  const idx = argv.indexOf(name);
  return idx >= 0 && idx + 1 < argv.length ? argv[idx + 1] : undefined;
}

function advanceToMain(state: GameState, catalog: CardCatalog): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  const query = createRulesQuery(state, catalog);
  let r = runStartPhase(state, query);
  state = r.state;
  events.push(...r.events);
  r = runChannelPhase(state);
  state = r.state;
  events.push(...r.events);
  r = startMainPhase(state);
  state = r.state;
  events.push(...r.events);
  return { state, events };
}

function deployAndContest(state: GameState, active: PlayerId, catalog: CardCatalog): GameState {
  const baseUnits = state.players[active]?.base ?? [];
  if (baseUnits.length === 0) return state;
  const bfKeys = Object.keys(state.battlefields) as BattlefieldId[];
  // Prefer a battlefield the active player does not already control; else the first.
  const target = bfKeys.find((bfId) => state.battlefields[bfId]?.controllerId !== active) ?? bfKeys[0];
  if (!target) return state;
  state = {
    ...state,
    players: { ...state.players, [active]: { ...state.players[active]!, base: [] } },
    battlefields: {
      ...state.battlefields,
      [target]: {
        ...state.battlefields[target]!,
        units: [...state.battlefields[target]!.units, ...baseUnits],
      },
    },
  };
  const query = createRulesQuery(state, catalog);
  return resolveCombat(state, target, query, catalog).state;
}

async function main(): Promise<void> {
  const rl = createInterface({ input, output });
  let interrupted = false;
  rl.on("SIGINT", () => {
    interrupted = true;
    rl.close();
  });
  rl.on("close", () => {
    interrupted = true;
  });

  /** Prompt for a 1-based choice; returns null if the input stream has closed (EOF/SIGINT). */
  async function promptChoice(prompt: string): Promise<number | null> {
    if (interrupted) return null;
    try {
      const answer = await rl.question(prompt);
      return Number.parseInt(answer.trim(), 10);
    } catch {
      interrupted = true;
      return null;
    }
  }

  const humanDeckPath = parseFlag("--human-deck");
  const aiDeckPath = parseFlag("--ai-deck");
  const humanDeck = humanDeckPath ? await loadDeckFromFile(humanDeckPath) : DEFAULT_HUMAN_DECK;
  const aiDeck = aiDeckPath ? await loadDeckFromFile(aiDeckPath) : DEFAULT_AI_DECK;

  const catalog = await createCardCatalog(defaultSnapshotSource, defaultProgramSource);

  let state = createGame({
    players: [HUMAN, AI],
    decks: { [HUMAN]: humanDeck, [AI]: aiDeck },
    seed: Date.now(),
    matchId: toMatchId(`cli-${Date.now()}`),
  });

  console.log("\n*** Riftbound CLI — you vs CPU ***");

  let lastTurnDeployed = -1;
  const MAX_ITERATIONS = 2000;
  let iterations = 0;

  while (state.status !== "ended" && !interrupted && iterations < MAX_ITERATIONS) {
    iterations++;

    // Resolve any pending decision (mulligan, targets, priority, focus) first.
    if (state.pendingDecision) {
      const decider = state.pendingDecision.playerId;
      if (decider === HUMAN) {
        const actions = legalActions(state, HUMAN, catalog);
        if (actions.length === 0) break;
        printActions(actions, state, catalog);
        const choice = await promptChoice(`> choose [1-${actions.length}]: `);
        if (choice === null) break;
        const action = actions[choice - 1] ?? actions[0]!;
        const r = submit(state, action, catalog);
        state = r.state;
        printEvents(r.events, state, catalog);
      } else {
        const action = aiAction(state, AI, catalog);
        console.log(`\nCPU: ${action.type}`);
        const r = submit(state, action, catalog);
        state = r.state;
        printEvents(r.events, state, catalog);
      }
      continue;
    }

    const active = state.activePlayerId;

    if (state.phase !== "Main") {
      const r = advanceToMain(state, catalog);
      state = r.state;
      printHeader(state.turnNumber, String(active));
      printEvents(r.events, state, catalog);
      continue;
    }

    if (active === HUMAN) {
      printBoard(state, HUMAN, catalog);
      const actions = legalActions(state, HUMAN, catalog);
      if (actions.length === 0) break;
      printActions(actions, state, catalog);
      const choice = await promptChoice(`> your action [1-${actions.length}]: `);
      if (choice === null) break;
      const action = actions[choice - 1] ?? actions[0]!;
      if (action.type === "EndTurn" && lastTurnDeployed !== state.turnNumber) {
        lastTurnDeployed = state.turnNumber;
        state = deployAndContest(state, HUMAN, catalog);
      }
      const r = submit(state, action, catalog);
      state = r.state;
      printEvents(r.events, state, catalog);
    } else {
      const action = aiAction(state, AI, catalog);
      console.log(`\nCPU: ${action.type}`);
      if (action.type === "EndTurn" && lastTurnDeployed !== state.turnNumber) {
        lastTurnDeployed = state.turnNumber;
        state = deployAndContest(state, AI, catalog);
      }
      const r = submit(state, action, catalog);
      state = r.state;
      printEvents(r.events, state, catalog);
    }
  }

  rl.close();

  if (state.status === "ended") {
    const winnerName = state.winner === HUMAN ? "YOU" : "CPU";
    console.log(`\n${"*".repeat(60)}`);
    console.log(`  GAME OVER — ${winnerName} win!`);
    console.log(`  Final points: you ${state.players[HUMAN]?.points ?? 0}, cpu ${state.players[AI]?.points ?? 0}`);
    console.log("*".repeat(60));
  } else {
    console.log(`\nGame exited before completion (status: ${state.status}, iterations: ${iterations}).`);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  exit(1);
});
