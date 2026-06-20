# AI Opponent, CLI Game, and Full-Game Simulation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a full-game vitest simulation that runs the engine to a real winner using compiled card effects, plus a greedy AI module and an interactive CLI where a human plays against that AI.

**Architecture:** A shared greedy AI decision function drives both players in the engine test (inline copy) and the CPU opponent in the CLI (`examples/riftbound-cli/src/ai.ts`). The CLI is a thin readline loop over the same `createGame` / `submit` / `legalActions` engine API the tests use. A v1 "deploy-and-contest" workaround moves base units onto a battlefield and calls `resolveCombat` directly, since no `SendToShowdown` submit action exists yet.

**Tech Stack:** Vitest (test), Node.js `readline/promises` (CLI input), `tsx` (CLI runner), `createCardCatalog(defaultSnapshotSource, defaultProgramSource)` from `@thejokersthief/riftbound-card-catalog` (real compiled card effects).

**Spec:** `docs/superpowers/specs/2026-06-20-ai-cli-simulation-design.md`

---

## Reference: Verified Engine API

These signatures are confirmed against the current source. Use them exactly.

```ts
// @thejokersthief/riftbound-engine
createGame(config: {
  players: [PlayerId, PlayerId];
  decks: Record<PlayerId, DeckConfig>;
  seed: number;
  matchId: MatchId;
}): GameState
submit(state: GameState, action: Action, catalog: CardCatalog): { state: GameState; events: GameEvent[] }
legalActions(state: GameState, playerId: PlayerId, catalog: CardCatalog): Action[]
createRulesQuery(state: GameState, catalog: CardCatalog): RulesQuery
runStartPhase(state: GameState, query: RulesQuery): { state: GameState; events: GameEvent[] }
runChannelPhase(state: GameState): { state: GameState; events: GameEvent[] }
startMainPhase(state: GameState): { state: GameState; events: GameEvent[] }
resolveCombat(state: GameState, battlefieldId: BattlefieldId, query: RulesQuery, catalog: CardCatalog): { state: GameState; events: GameEvent[] }

// @thejokersthief/riftbound-card-catalog
createCardCatalog(source: CardDataSource, programSource?: ProgramDataSource): Promise<CardCatalog>
// defaultProgramSource is the default 2nd arg; defaultSnapshotSource is the card snapshot source.

// @thejokersthief/riftbound-protocol — branding helpers
toPlayerId(s: string): PlayerId
toCardDefId(s: string): CardDefId
toMatchId(s: string): MatchId
```

**Decks (from `examples/riftbound-example/src/index.ts`):**

```ts
// ARIA (human default)
legendId:    'ogs-017-024'
championId:  'ogs-021-024'
battlefields: ['unl-t01', 'unl-t03', 'unl-205-219']

// BOWEN (AI default)
legendId:    'ogs-019-024'
championId:  'ogs-023-024'
battlefields: ['unl-206-219', 'sfd-207-221', 'unl-207-219']
```

The example builds `mainDeck` (40 cards) from a `buildMainDeck()` helper over a card pool and shares one `RUNE_IDS` (10) list. The full-game test and CLI both reuse the same pool — see Task 1 / Task 2 for the exact card IDs to copy from `examples/riftbound-example/src/index.ts:57-97`.

**Game-loop driver pattern (per turn):**

```ts
function advanceToMain(state: GameState, catalog: CardCatalog): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  const query = createRulesQuery(state, catalog);
  let r = runStartPhase(state, query);   state = r.state; events.push(...r.events);
  r = runChannelPhase(state);            state = r.state; events.push(...r.events);
  r = startMainPhase(state);             state = r.state; events.push(...r.events);
  return { state, events };
}
```

**Deploy-and-contest helper (v1 workaround, identical in test and CLI):**

```ts
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
```

---

## File Structure

| Path | Action | Responsibility |
|------|--------|----------------|
| `packages/engine/src/__tests__/sim-full-game.test.ts` | Create | Full-game vitest test; inline greedy AI; runs to `status: 'ended'` |
| `examples/riftbound-cli/package.json` | Create | Package metadata, `start` script |
| `examples/riftbound-cli/tsconfig.json` | Create | TypeScript config (mirrors `riftbound-example`) |
| `examples/riftbound-cli/src/decks.ts` | Create | Default ARIA/BOWEN decks + JSON deck loader |
| `examples/riftbound-cli/src/ai.ts` | Create | `aiAction()` greedy AI; exported for the CLI |
| `examples/riftbound-cli/src/display.ts` | Create | Board printer + event narrator + action lister |
| `examples/riftbound-cli/src/index.ts` | Create | CLI entry point; interactive game loop |

---

## Task 1: Full-Game Simulation Test

**Files:**
- Create: `packages/engine/src/__tests__/sim-full-game.test.ts`
- Reference (read for deck IDs): `examples/riftbound-example/src/index.ts:57-97`
- Reference (test patterns): `packages/engine/src/__tests__/sim-complex.test.ts`

- [ ] **Step 1: Read the example deck definitions**

Open `examples/riftbound-example/src/index.ts` and copy the literal arrays from `ARIA_DECK`, `BOWEN_DECK`, the main-deck card pool used by `buildMainDeck()`, and `RUNE_IDS`. You need the exact `CardDefId` strings so the test uses real cards with real compiled programs.

- [ ] **Step 2: Write the failing test skeleton**

Create `packages/engine/src/__tests__/sim-full-game.test.ts`:

```ts
/**
 * Full-game simulation: real compiled card effects, greedy AI on both seats,
 * run to a real winner. This is the end-to-end integration proof that the
 * engine + catalog + AI play a complete game without throwing or looping.
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
import type { DeckConfig } from "@thejokersthief/riftbound-engine";
import {
  createGame,
  submit,
  legalActions,
  createRulesQuery,
  runStartPhase,
  runChannelPhase,
  startMainPhase,
  resolveCombat,
} from "../index.js";
import type { GameState } from "../state/types.js";

const HUMAN = toPlayerId("aria");
const AI = toPlayerId("bowen");

// --- Decks (copied verbatim from examples/riftbound-example/src/index.ts) ----
const RUNE_IDS = [
  // TODO Step 1: paste the 10 rune CardDefId strings here, wrapped in toCardDefId
].map(toCardDefId);

const MAIN_POOL = [
  // TODO Step 1: paste the main-deck pool CardDefId strings here
].map(toCardDefId);

function buildMainDeck(): typeof MAIN_POOL {
  const deck: typeof MAIN_POOL = [];
  let i = 0;
  while (deck.length < 40) { deck.push(MAIN_POOL[i % MAIN_POOL.length]!); i++; }
  return deck;
}

const ARIA_DECK: DeckConfig = {
  legendId: toCardDefId("ogs-017-024"),
  championId: toCardDefId("ogs-021-024"),
  battlefields: [toCardDefId("unl-t01"), toCardDefId("unl-t03"), toCardDefId("unl-205-219")],
  mainDeck: buildMainDeck(),
  runeDeck: RUNE_IDS,
};

const BOWEN_DECK: DeckConfig = {
  legendId: toCardDefId("ogs-019-024"),
  championId: toCardDefId("ogs-023-024"),
  battlefields: [toCardDefId("unl-206-219"), toCardDefId("sfd-207-221"), toCardDefId("unl-207-219")],
  mainDeck: buildMainDeck(),
  runeDeck: RUNE_IDS,
};

// --- Inline greedy AI (mirror of examples/riftbound-cli/src/ai.ts) -----------
function greedyAi(state: GameState, playerId: PlayerId, catalog: CardCatalog): Action {
  const actions = legalActions(state, playerId, catalog);
  const byType = (t: string) => actions.find((a) => a.type === t);
  return (
    byType("KeepHand") ??
    byType("ChooseTargets") ??
    byType("PlayCard") ??
    byType("PassFocus") ??
    byType("EndTurn") ??
    byType("PassPriority") ??
    actions[0]!
  );
}

// --- Loop helpers ------------------------------------------------------------
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
beforeAll(async () => {
  catalog = await createCardCatalog(defaultSnapshotSource, defaultProgramSource);
});

describe("full-game simulation", () => {
  it("plays a complete game with real cards to a real winner", () => {
    let state = createGame({
      players: [HUMAN, AI],
      decks: { [HUMAN]: ARIA_DECK, [AI]: BOWEN_DECK },
      seed: 1234,
      matchId: toMatchId("sim-full-1"),
    });

    const MAX_ITERATIONS = 500;
    let iterations = 0;
    let lastTurnDeployed = -1;

    while (state.status === "playing" && iterations < MAX_ITERATIONS) {
      iterations++;

      // Resolve any pending decision (mulligan, targets, priority, focus) first.
      if (state.pendingDecision) {
        const decider = state.pendingDecision.playerId;
        const action = greedyAi(state, decider, catalog);
        state = submit(state, action, catalog).state;
        continue;
      }

      // No pending decision: drive the active player's turn.
      const active = state.activePlayerId;

      // Auto-advance phases until we reach Main.
      if (state.phase !== "Main") {
        state = advanceToMain(state, catalog);
        continue;
      }

      // In Main: play a card if the AI wants to, else deploy-and-contest once, else EndTurn.
      const action = greedyAi(state, active, catalog);
      if (action.type === "PlayCard") {
        state = submit(state, action, catalog).state;
        continue;
      }
      if (lastTurnDeployed !== state.turnNumber) {
        lastTurnDeployed = state.turnNumber;
        state = deployAndContest(state, active, catalog);
        continue;
      }
      // Nothing left to do this turn: end it.
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
```

- [ ] **Step 3: Fill in the deck card IDs from Step 1**

Replace the two `// TODO Step 1` markers with the real arrays you read in Step 1. Remove the TODO comments.

- [ ] **Step 4: Run the test to verify it fails (or surfaces a real issue)**

Run: `pnpm --filter @thejokersthief/riftbound-engine test sim-full-game`
Expected initially: FAIL — likely the TODO arrays are empty (deck validation error in `createGame`) until Step 3 is done. After Step 3, the test should either PASS or fail on a real engine/loop issue.

- [ ] **Step 5: Debug to green**

If the loop hits `MAX_ITERATIONS`, the game is stalling. Most likely causes and fixes:
- The greedy AI keeps choosing `PlayCard` with no resources — confirm `legalActions` stops returning `PlayCard` when the player cannot pay. If it does not, the deploy/EndTurn fallthrough still fires because `byType("PlayCard")` returns undefined.
- Hold scoring never triggers because no unit ever controls a battlefield at turn start. The `deployAndContest` step moves units onto battlefields each turn; over several turns one player should hold a battlefield into their next turn start (→ `holdEligible`) and score. If scoring never advances, log `state.players[active].points` and `state.holdEligible` per turn to confirm progress.
- If the game genuinely never reaches 8 points within 500 iterations, raise `MAX_ITERATIONS` only after confirming points ARE climbing (do not mask a stall).

Use `superpowers:systematic-debugging` if you hit a non-obvious stall.

- [ ] **Step 6: Run the full engine test suite**

Run: `pnpm --filter @thejokersthief/riftbound-engine test`
Expected: PASS (all existing tests + the new sim-full-game test).

- [ ] **Step 7: Commit**

```bash
git add packages/engine/src/__tests__/sim-full-game.test.ts
git commit -m "test(engine): full-game simulation with real cards to a real winner"
```

---

## Task 2: CLI Package Scaffold — decks + AI

**Files:**
- Create: `examples/riftbound-cli/package.json`
- Create: `examples/riftbound-cli/tsconfig.json`
- Create: `examples/riftbound-cli/src/decks.ts`
- Create: `examples/riftbound-cli/src/ai.ts`
- Reference: `examples/riftbound-example/package.json`, `examples/riftbound-example/tsconfig.json`

- [ ] **Step 1: Create `examples/riftbound-cli/package.json`**

```json
{
  "name": "@thejokersthief/riftbound-cli",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "tsx src/index.ts"
  },
  "dependencies": {
    "@thejokersthief/riftbound-engine": "workspace:*",
    "@thejokersthief/riftbound-card-catalog": "workspace:*",
    "@thejokersthief/riftbound-protocol": "workspace:*"
  },
  "devDependencies": {
    "tsx": "*",
    "typescript": "*"
  }
}
```

- [ ] **Step 2: Create `examples/riftbound-cli/tsconfig.json`**

Read `examples/riftbound-example/tsconfig.json` and copy it verbatim (same compiler options, same module resolution). The CLI has identical needs.

- [ ] **Step 3: Create `examples/riftbound-cli/src/decks.ts`**

```ts
import { readFile } from "node:fs/promises";
import { toCardDefId } from "@thejokersthief/riftbound-protocol";
import type { DeckConfig } from "@thejokersthief/riftbound-engine";

const RUNE_IDS = [
  // TODO: paste the 10 rune CardDefId strings from examples/riftbound-example/src/index.ts
].map(toCardDefId);

const MAIN_POOL = [
  // TODO: paste the main-deck pool CardDefId strings from examples/riftbound-example/src/index.ts
].map(toCardDefId);

function buildMainDeck(): typeof MAIN_POOL {
  const deck: typeof MAIN_POOL = [];
  let i = 0;
  while (deck.length < 40) { deck.push(MAIN_POOL[i % MAIN_POOL.length]!); i++; }
  return deck;
}

export const DEFAULT_HUMAN_DECK: DeckConfig = {
  legendId: toCardDefId("ogs-017-024"),
  championId: toCardDefId("ogs-021-024"),
  battlefields: [toCardDefId("unl-t01"), toCardDefId("unl-t03"), toCardDefId("unl-205-219")],
  mainDeck: buildMainDeck(),
  runeDeck: RUNE_IDS,
};

export const DEFAULT_AI_DECK: DeckConfig = {
  legendId: toCardDefId("ogs-019-024"),
  championId: toCardDefId("ogs-023-024"),
  battlefields: [toCardDefId("unl-206-219"), toCardDefId("sfd-207-221"), toCardDefId("unl-207-219")],
  mainDeck: buildMainDeck(),
  runeDeck: RUNE_IDS,
};

interface RawDeck {
  legendId: string;
  championId: string;
  battlefields: string[];
  mainDeck: string[];
  runeDeck: string[];
}

export async function loadDeckFromFile(path: string): Promise<DeckConfig> {
  const text = await readFile(path, "utf8");
  let raw: RawDeck;
  try {
    raw = JSON.parse(text) as RawDeck;
  } catch (err) {
    throw new Error(`Deck file ${path} is not valid JSON: ${(err as Error).message}`);
  }
  if (typeof raw.legendId !== "string") throw new Error(`Deck ${path}: missing legendId`);
  if (typeof raw.championId !== "string") throw new Error(`Deck ${path}: missing championId`);
  if (!Array.isArray(raw.battlefields) || raw.battlefields.length !== 3)
    throw new Error(`Deck ${path}: battlefields must be an array of exactly 3 IDs`);
  if (!Array.isArray(raw.mainDeck) || raw.mainDeck.length < 40 || raw.mainDeck.length > 60)
    throw new Error(`Deck ${path}: mainDeck must have 40-60 cards`);
  if (!Array.isArray(raw.runeDeck) || raw.runeDeck.length !== 10)
    throw new Error(`Deck ${path}: runeDeck must have exactly 10 runes`);
  return {
    legendId: toCardDefId(raw.legendId),
    championId: toCardDefId(raw.championId),
    battlefields: [
      toCardDefId(raw.battlefields[0]!),
      toCardDefId(raw.battlefields[1]!),
      toCardDefId(raw.battlefields[2]!),
    ],
    mainDeck: raw.mainDeck.map(toCardDefId),
    runeDeck: raw.runeDeck.map(toCardDefId),
  };
}
```

Replace the two `// TODO` markers with the same arrays used in Task 1 Step 1.

- [ ] **Step 4: Create `examples/riftbound-cli/src/ai.ts`**

```ts
import { legalActions } from "@thejokersthief/riftbound-engine";
import type { GameState } from "@thejokersthief/riftbound-engine";
import type { CardCatalog } from "@thejokersthief/riftbound-card-catalog";
import type { Action, PlayerId } from "@thejokersthief/riftbound-protocol";

/**
 * Greedy AI: resolve decisions in a fixed priority order, prefer playing cards,
 * fall back to ending the turn. Intentionally simple so games complete quickly.
 */
export function aiAction(state: GameState, playerId: PlayerId, catalog: CardCatalog): Action {
  const actions = legalActions(state, playerId, catalog);
  const byType = (t: string) => actions.find((a) => a.type === t);
  return (
    byType("KeepHand") ??
    byType("ChooseTargets") ??
    byType("PlayCard") ??
    byType("PassFocus") ??
    byType("EndTurn") ??
    byType("PassPriority") ??
    actions[0]!
  );
}
```

> Verified import map (confirmed against source): `GameState` and `DeckConfig` are re-exported from `@thejokersthief/riftbound-engine`. `Action`, `GameEvent`, `PlayerId`, `CardId`, `CardDefId`, `BattlefieldId`, `MatchId`, and the `toX` brand helpers come from `@thejokersthief/riftbound-protocol`. `CardCatalog`, `createCardCatalog`, `defaultSnapshotSource`, `defaultProgramSource` come from `@thejokersthief/riftbound-card-catalog`.

- [ ] **Step 5: Install and type-check**

Run: `pnpm install`
Run: `pnpm --filter @thejokersthief/riftbound-cli exec tsc --noEmit`
Expected: PASS (no type errors). If `GameState` / `Action` / `DeckConfig` are not exported from `@thejokersthief/riftbound-engine`, fix the imports to the correct public export path and re-run.

- [ ] **Step 6: Commit**

```bash
git add examples/riftbound-cli/package.json examples/riftbound-cli/tsconfig.json examples/riftbound-cli/src/decks.ts examples/riftbound-cli/src/ai.ts pnpm-lock.yaml
git commit -m "feat(cli): scaffold riftbound-cli package with decks and greedy AI"
```

---

## Task 3: CLI Display Module

**Files:**
- Create: `examples/riftbound-cli/src/display.ts`
- Reference (event narration patterns): `examples/riftbound-example/src/index.ts` (its `logEvents` helper)

- [ ] **Step 1: Create `examples/riftbound-cli/src/display.ts`**

```ts
import type { GameState } from "@thejokersthief/riftbound-engine";
import type { CardCatalog } from "@thejokersthief/riftbound-card-catalog";
import type { Action, GameEvent, PlayerId, CardId } from "@thejokersthief/riftbound-protocol";

function cardName(state: GameState, catalog: CardCatalog, cardId: CardId): string {
  const inst = state.cards[cardId];
  if (!inst) return String(cardId);
  const def = catalog.get(inst.defId);
  return def?.name ?? String(inst.defId);
}

export function printHeader(turnNumber: number, activePlayer: string): void {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  Turn ${turnNumber} — active: ${activePlayer}`);
  console.log("=".repeat(60));
}

export function printBoard(state: GameState, humanId: PlayerId, catalog: CardCatalog): void {
  const human = state.players[humanId]!;
  const oppId = state.playerIds.find((p) => p !== humanId)!;
  const opp = state.players[oppId]!;

  const filled = human.runePool.filter((s) => s.filled).length;
  console.log(`\nYour points: ${human.points}   Runes: ${filled}/${human.runePool.length}`);
  console.log("Your hand:");
  for (const cid of human.hand) {
    const inst = state.cards[cid]!;
    const def = catalog.get(inst.defId);
    const cost = def?.playCost;
    const costStr = cost ? `(E${cost.energy}/P${cost.power})` : "";
    console.log(`  - ${cardName(state, catalog, cid)} ${costStr}`);
  }

  const oppFilled = opp.runePool.filter((s) => s.filled).length;
  console.log(`\nOpponent (${String(oppId)}): points ${opp.points}, hand ${opp.hand.length}, runes ${oppFilled}/${opp.runePool.length}`);

  console.log("\nBattlefields:");
  for (const [bfId, bf] of Object.entries(state.battlefields)) {
    const unitNames = bf!.units.map((u) => cardName(state, catalog, u)).join(", ") || "(empty)";
    console.log(`  ${bfId} — controller: ${bf!.controllerId ?? "none"} — units: ${unitNames}`);
  }
}

export function printEvents(events: GameEvent[], state: GameState, catalog: CardCatalog): void {
  for (const ev of events) {
    switch (ev.type) {
      case "CardDrawn":
        console.log(`  · ${String(ev.playerId)} draws a card`);
        break;
      case "CardPlayed":
        console.log(`  · ${cardName(state, catalog, ev.cardId)} is played`);
        break;
      case "CardKilled":
        console.log(`  · ${cardName(state, catalog, ev.cardId)} is destroyed`);
        break;
      case "DamageDealt":
        console.log(`  · ${ev.amount} damage dealt`);
        break;
      case "PointsScored":
        console.log(`  · ${String(ev.playerId)} scores points`);
        break;
      case "PhaseStarted":
        console.log(`  · phase: ${ev.phase}`);
        break;
      default:
        console.log(`  · ${ev.type}`);
    }
  }
}

export function printActions(actions: Action[], state: GameState, catalog: CardCatalog): void {
  console.log("\nYour options:");
  actions.forEach((a, i) => {
    let detail = "";
    if (a.type === "PlayCard" && "cardId" in a) detail = ` ${cardName(state, catalog, a.cardId)}`;
    if (a.type === "ChooseTargets" && "targets" in a && Array.isArray(a.targets))
      detail = ` → ${a.targets.map((t) => cardName(state, catalog, t as CardId)).join(", ")}`;
    console.log(`  [${i + 1}] ${a.type}${detail}`);
  });
}
```

> The exact `GameEvent` variant names and their payload fields must match the engine's `GameEvent` union. Before relying on the `switch` cases above, open the engine's event type (search `GameEvent` in `packages/engine/src`) and correct any case name / field that does not match (e.g. `CardPlayed` may be `CardEntered`, `amount` may be named differently). The `default` branch keeps unknown events printable, so wrong case names degrade gracefully rather than crash — but fix the common ones (drawn / played / killed / damage / phase) so narration reads well.

- [ ] **Step 2: Type-check**

Run: `pnpm --filter @thejokersthief/riftbound-cli exec tsc --noEmit`
Expected: PASS. Fix any field/case mismatches against the real `GameEvent` and `Action` unions and the `CardCatalog.get` signature.

- [ ] **Step 3: Commit**

```bash
git add examples/riftbound-cli/src/display.ts
git commit -m "feat(cli): add board printer and event narrator"
```

---

## Task 4: CLI Interactive Game Loop

**Files:**
- Create: `examples/riftbound-cli/src/index.ts`
- Reference: `examples/riftbound-cli/src/{decks,ai,display}.ts` (Tasks 2-3)

- [ ] **Step 1: Create `examples/riftbound-cli/src/index.ts`**

```ts
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output, argv, exit } from "node:process";
import { toPlayerId, toMatchId } from "@thejokersthief/riftbound-protocol";
import type { BattlefieldId, PlayerId } from "@thejokersthief/riftbound-protocol";
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

function advanceToMain(state: GameState, catalog: CardCatalog): { state: GameState; events: unknown[] } {
  const events: unknown[] = [];
  const query = createRulesQuery(state, catalog);
  let r = runStartPhase(state, query); state = r.state; events.push(...r.events);
  r = runChannelPhase(state);          state = r.state; events.push(...r.events);
  r = startMainPhase(state);           state = r.state; events.push(...r.events);
  return { state, events };
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

async function main(): Promise<void> {
  const rl = createInterface({ input, output });
  let interrupted = false;
  rl.on("SIGINT", () => { interrupted = true; rl.close(); });

  const humanDeck = parseFlag("--human-deck")
    ? await loadDeckFromFile(parseFlag("--human-deck")!)
    : DEFAULT_HUMAN_DECK;
  const aiDeck = parseFlag("--ai-deck")
    ? await loadDeckFromFile(parseFlag("--ai-deck")!)
    : DEFAULT_AI_DECK;

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

  while (state.status === "playing" && !interrupted && iterations < MAX_ITERATIONS) {
    iterations++;

    // Resolve any pending decision.
    if (state.pendingDecision) {
      const decider = state.pendingDecision.playerId;
      if (decider === HUMAN) {
        const actions = legalActions(state, HUMAN, catalog);
        printActions(actions, state, catalog);
        const answer = await rl.question(`> choose [1-${actions.length}]: `);
        const choice = Number.parseInt(answer.trim(), 10);
        const action = actions[choice - 1] ?? actions[0]!;
        const r = submit(state, action, catalog); state = r.state;
        printEvents(r.events, state, catalog);
      } else {
        const action = aiAction(state, AI, catalog);
        console.log(`\nCPU: ${action.type}`);
        const r = submit(state, action, catalog); state = r.state;
        printEvents(r.events, state, catalog);
      }
      continue;
    }

    const active = state.activePlayerId;

    if (state.phase !== "Main") {
      const r = advanceToMain(state, catalog);
      state = r.state;
      printHeader(state.turnNumber, String(active));
      continue;
    }

    if (active === HUMAN) {
      printBoard(state, HUMAN, catalog);
      const actions = legalActions(state, HUMAN, catalog);
      printActions(actions, state, catalog);
      const answer = await rl.question(`> your action [1-${actions.length}]: `);
      const choice = Number.parseInt(answer.trim(), 10);
      const action = actions[choice - 1] ?? actions[0]!;
      if (action.type === "EndTurn" && lastTurnDeployed !== state.turnNumber) {
        lastTurnDeployed = state.turnNumber;
        state = deployAndContest(state, HUMAN, catalog);
      }
      const r = submit(state, action, catalog); state = r.state;
      printEvents(r.events, state, catalog);
    } else {
      const action = aiAction(state, AI, catalog);
      console.log(`\nCPU: ${action.type}`);
      if (action.type === "EndTurn" && lastTurnDeployed !== state.turnNumber) {
        lastTurnDeployed = state.turnNumber;
        state = deployAndContest(state, AI, catalog);
      }
      const r = submit(state, action, catalog); state = r.state;
      printEvents(r.events, state, catalog);
    }
  }

  rl.close();

  if (state.status === "ended") {
    const winnerName = state.winner === HUMAN ? "YOU" : "CPU";
    console.log(`\n${"*".repeat(60)}`);
    console.log(`  GAME OVER — ${winnerName} win!`);
    console.log(`  Final points: you ${state.players[HUMAN]!.points}, cpu ${state.players[AI]!.points}`);
    console.log("*".repeat(60));
  } else {
    console.log("\nGame exited before completion.");
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  exit(1);
});
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter @thejokersthief/riftbound-cli exec tsc --noEmit`
Expected: PASS. Fix import paths if any engine export name differs.

- [ ] **Step 3: Smoke-test the CLI end-to-end**

Run: `printf '1\n%.0s' {1..200} | pnpm --filter @thejokersthief/riftbound-cli start`
This pipes "1" as every answer (always picks the first option), so the game self-drives without manual input. Expected: the game runs and prints `GAME OVER` with a winner, OR exits cleanly. Confirm no crash and no infinite loop (the `MAX_ITERATIONS` guard bounds it).

- [ ] **Step 4: Manual interactive verification (optional but recommended)**

Run: `pnpm --filter @thejokersthief/riftbound-cli start`
Play a few turns by typing option numbers. Confirm the board prints, the CPU takes actions, and the game reaches an end state.

- [ ] **Step 5: Commit**

```bash
git add examples/riftbound-cli/src/index.ts
git commit -m "feat(cli): interactive human-vs-AI game loop"
```

---

## Task 5: Documentation — How to Play vs the AI

**Files:**
- Create: `examples/riftbound-cli/README.md`

- [ ] **Step 1: Create `examples/riftbound-cli/README.md`**

```markdown
# Riftbound CLI — Play Against the AI

An interactive terminal game: you versus a greedy CPU opponent, using real
compiled card effects from the card catalog.

## Run

From the repo root:

    pnpm --filter @thejokersthief/riftbound-cli start

You play the ARIA deck; the CPU plays BOWEN. On each of your turns the board
prints and you pick an action by number. The CPU acts automatically.

## Custom decks

Pass JSON deck files:

    pnpm --filter @thejokersthief/riftbound-cli start \
      --human-deck ./my-deck.json --ai-deck ./cpu-deck.json

### Deck JSON format

    {
      "legendId": "ogs-017-024",
      "championId": "ogs-021-024",
      "battlefields": ["unl-t01", "unl-t03", "unl-205-219"],
      "mainDeck": ["ogn-001-298", "... 40-60 card IDs ..."],
      "runeDeck": ["ogn-007-298", "... exactly 10 rune IDs ..."]
    }

All values are raw card-definition ID strings. `battlefields` must have exactly
3 entries, `mainDeck` 40-60, `runeDeck` exactly 10. Invalid decks fail fast with
a descriptive error.

## Known v1 limitations

- **Deploy-and-contest is automatic.** When you end your turn, your base units
  are deployed to a contested battlefield and combat is resolved for you. There
  is no manual "send to showdown" choice yet.
- **Single game**, not a best-of-three match.
- **The AI is greedy**, not strategic: it always plays the first available card
  and targets the first candidate.
```

- [ ] **Step 2: Commit**

```bash
git add examples/riftbound-cli/README.md
git commit -m "docs(cli): document how to play against the AI"
```

---

## Final Verification

After all tasks:

- [ ] Run the full workspace test suite: `pnpm -r test` — expected PASS.
- [ ] Run the workspace build: `pnpm -r build` — expected PASS (the CLI is `tsx`-run, but type-checking must be clean).
- [ ] Smoke-test the CLI once more: `printf '1\n%.0s' {1..200} | pnpm --filter @thejokersthief/riftbound-cli start` — expected `GAME OVER`.
- [ ] Push the branch after the final commit (standing requirement: push immediately after committing).

---

## Self-Review Notes

- **Spec coverage:** Task 1 → §1 (full-game test); Task 2 → §2 (AI) + §3 decks/package; Task 3 → §3 display; Task 4 → §3 index/game loop; Task 5 → documentation deliverable from the goal statement.
- **Type consistency:** `aiAction` / `greedyAi` signature is identical across the inline test copy (Task 1) and the CLI module (Task 2). `deployAndContest` and `advanceToMain` are byte-identical helpers in Task 1 and Task 4. `DeckConfig`, `GameState`, `Action`, `CardCatalog`, `BattlefieldId`, `PlayerId`, `CardId` are the only shared types; every task imports them from the same packages.
- **Known soft spots flagged inline:** (a) the exact `GameState`/`Action` public export path from the engine (Task 2 Step 4 note, verify in Step 5); (b) the `GameEvent` variant names in the narrator (Task 3 Step 1 note, `default` branch keeps it crash-safe). Both are called out as verify-during-implementation rather than left silent.
