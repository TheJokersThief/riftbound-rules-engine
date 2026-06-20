# AI Opponent, CLI Game, and Full-Game Simulation Design

**Goal:** Three tightly-coupled deliverables that together prove the engine runs a real game from start to finish: (1) a vitest test that simulates a complete game using real compiled card effects, (2) a greedy AI module that drives both players in that test and the CPU opponent in the CLI, and (3) an interactive CLI where a human player competes against the AI using deck JSON files or built-in defaults.

**Architecture:** Shared AI decision function consumed by both the engine test and the CLI. No cross-package dependency between `packages/engine` tests and `examples/riftbound-cli`; the test carries an inline copy of the same greedy AI logic.

**Tech Stack:** Vitest (test), Node.js readline (CLI input), TSX (CLI runner), `defaultSnapshotSource` + `defaultProgramSource` from `@thejokersthief/riftbound-card-catalog` (real card effects).

---

## File Structure

| Path | Created / Modified | Responsibility |
|------|--------------------|----------------|
| `packages/engine/src/__tests__/sim-full-game.test.ts` | Create | Full-game vitest test; inline AI; runs to `status: 'ended'` |
| `examples/riftbound-cli/package.json` | Create | Package metadata, `pnpm start` script |
| `examples/riftbound-cli/tsconfig.json` | Create | TypeScript config, mirrors `riftbound-example` |
| `examples/riftbound-cli/src/ai.ts` | Create | `aiAction()` — greedy AI; exported for the CLI |
| `examples/riftbound-cli/src/display.ts` | Create | Board state printer; event narrator |
| `examples/riftbound-cli/src/decks.ts` | Create | Default decks + JSON deck loader |
| `examples/riftbound-cli/src/index.ts` | Create | CLI entry point; full interactive game loop |

---

## 1. Full-Game Simulation Test

**File:** `packages/engine/src/__tests__/sim-full-game.test.ts`

**Purpose:** Verify that the engine, real compiled card effects, and the AI together play a game to completion without throwing or looping forever.

**Catalog:** `createCardCatalog(defaultSnapshotSource, defaultProgramSource)`. All 964 compiled programs are active. Cards with `WhenPlayed: Draw`, `WhenPlayed: Deal`, and keyword static effects all fire naturally.

**Decks:** The same deck configurations already used in `examples/riftbound-example` (ARIA_DECK, BOWEN_DECK with the 15-card unit pool, the 10 rune IDs, and the three battlefields per player).

**Inline AI:** A local `greedyAi(state, playerId, catalog): Action` function — not imported from the CLI package to avoid a cross-package test dependency. Same logic as the CLI AI module (described in §2).

**Game loop per turn:**
1. `runStartPhase(state, query)` — sets `holdEligible`, readies exhausted cards.
2. `runChannelPhase(state)` — fills a rune slot.
3. `startMainPhase(state)` — emits `PhaseStarted('Main')`.
4. AI plays cards until `legalActions` returns no `PlayCard` option or no resources remain. Each `submit(PlayCard)` is called in sequence; the engine resolves WhenPlayed effects automatically.
5. **Deploy-and-contest step:** The active player's base units are moved onto the first uncontested (or opponent-controlled) battlefield by updating `battlefields[bfId].units` directly, then `resolveCombat(state, bfId, query, catalog)` is called. This is the v1 workaround until a `SendToShowdown` action exists.
6. `submit(EndTurn)` — triggers `runCleanup` → `checkScoring` → `checkWinCondition`.

**Loop guard:** Maximum 500 main-loop iterations. If the game has not ended, the test fails with a descriptive message.

**Assertions:**
- `state.status === 'ended'`
- `state.winner !== null`
- `state.players[state.winner].points >= 8`
- `state.players[loser].points < state.players[winner].points`

---

## 2. AI Module

**File:** `examples/riftbound-cli/src/ai.ts`

**Signature:**
```ts
export function aiAction(
  state: GameState,
  playerId: PlayerId,
  catalog: CardCatalog,
): Action
```

**Decision logic** (priority order against `legalActions(state, playerId, catalog)`):

| Pending decision | AI picks |
|-----------------|---------|
| `ChooseMulligan` | `KeepHand` |
| `PriorityWindow` | First `PlayCard` action if present, else `PassPriority` |
| `ChooseTargets` | First `ChooseTargets` action (targets the first candidate) |
| `FocusWindow` | `PassFocus` |
| `ChooseYesNo` | `choice: true` |
| `ChooseOne` | `index: 0` |
| `ChooseBattlefield` | First option |
| `AssignDamage` | First option |

**No pending decision** (free Main phase turn):
1. If a `PlayCard` action is available → pick it.
2. Else if `EndTurn` is available → pick it.
3. Else → first action from `legalActions`.

The AI never looks ahead; it is intentionally simple so games complete in a reasonable number of turns.

---

## 3. CLI Package

### `examples/riftbound-cli/package.json`

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

### `examples/riftbound-cli/src/decks.ts`

**Exports:**
- `DEFAULT_HUMAN_DECK: DeckConfig` — the existing ARIA deck from the example.
- `DEFAULT_AI_DECK: DeckConfig` — the existing BOWEN deck from the example.
- `loadDeckFromFile(path: string): Promise<DeckConfig>` — reads a JSON file, validates it has the required fields (`legendId`, `championId`, `battlefields[3]`, `mainDeck[40-60]`, `runeDeck[10]`), throws a descriptive error if invalid.

**Deck JSON format** (the file the human passes via `--human-deck`):
```json
{
  "legendId": "ogs-017-024",
  "championId": "ogs-021-024",
  "battlefields": ["unl-t01", "unl-t03", "unl-205-219"],
  "mainDeck": ["ogn-001-298", ...],
  "runeDeck": ["ogn-007-298", ...]
}
```
All values are raw `CardDefId` strings (no `toCardDefId` wrapper needed; the engine handles branding internally via `createGame`).

### `examples/riftbound-cli/src/display.ts`

**Exports:**
- `printHeader(turnNumber: number, activePlayer: string): void` — prints a turn banner.
- `printBoard(state: GameState, humanId: PlayerId, catalog: CardCatalog): void` — prints:
  - Your hand (card names + play costs), Your points, Your rune pool (filled/total)
  - Opponent: hand count, points, rune pool
  - Each battlefield: ID, controller, unit names
- `printEvents(events: GameEvent[], state: GameState, catalog: CardCatalog): void` — narrates each event in plain English (e.g. "CardDrawn → You draw Blazing Bolt", "CardKilled → Wraithguard is destroyed").
- `printActions(actions: Action[], state: GameState, catalog: CardCatalog): void` — prints numbered list of actions for human selection.

### `examples/riftbound-cli/src/index.ts`

**Usage:**
```
pnpm --filter @thejokersthief/riftbound-cli start [--human-deck path] [--ai-deck path]
```

**Startup:**
1. Parse `--human-deck` and `--ai-deck` from `process.argv`.
2. Load decks (file or default).
3. `await createCardCatalog(defaultSnapshotSource, defaultProgramSource)`.
4. `createGame({ players: [HUMAN, AI], decks: {...}, seed: Date.now(), matchId })`.
5. Print welcome banner.

**Main loop** (while `state.status === 'playing'`):
1. `runStartPhase` → `runChannelPhase` → `startMainPhase`; narrate events.
2. Print board.
3. While in Main phase and no `status: 'ended'`:
   a. If it's the human's turn:
      - Show legal actions numbered.
      - Prompt: `> Your action [1-N]: `
      - Submit the chosen action; narrate events.
   b. If it's the AI's turn:
      - Call `aiAction(state, AI, catalog)`.
      - Submit; print `CPU: <action type> <detail>`.
      - Narrate events.
4. **Deploy-and-contest step** (same as simulation test): after all cards are played, deploy base units to a target battlefield and call `resolveCombat`.
5. Loop continues until `EndTurn` is submitted or game ends.

**Game end:** Print final scores, winner announcement, and exit.

**Signal handling:** Catch `SIGINT` (Ctrl-C) to exit cleanly.

---

## Testing

The full-game simulation test IS the integration test for this feature. It verifies the AI plays real cards, real effects fire, real scoring runs, and the game ends correctly.

The CLI itself is not unit-tested (it is an interactive program). Manual verification: run `pnpm --filter @thejokersthief/riftbound-cli start`, play through a game, confirm the win condition fires.

---

## Open Constraints

- **v1 limitation:** Units move to battlefields only via the manual deploy step (direct state mutation + `resolveCombat`). This will be replaced once a `SendToShowdown` submit action is implemented.
- **Single game:** The CLI plays one game, not a best-of-three match. Match support is a future enhancement.
- **No AI targeting preference:** The AI always picks the first target candidate. It does not prefer weaker units or strategic targets.
