# Example Package — Design Specification

**Date:** 2026-06-09
**Status:** Approved design, pending implementation plan
**Sub-spec:** #16 of 16 — depends on sub-spec #04 (card-catalog), sub-spec #14 (engine façade)
**Scope:** `examples/riftbound-example` (`@thejokersthief/riftbound-example`). A self-contained, heavily-annotated single-game walkthrough that demonstrates how to use the engine library from first call to game-end. All inputs are static and fixed; it is not a test suite.

---

## 1. Package structure

```
examples/riftbound-example/
├── package.json          ← name: @thejokersthief/riftbound-example
│                            type: module
│                            dependencies: engine, card-catalog, protocol
│                            scripts: { "start": "node --import tsx src/index.ts" }
├── tsconfig.json         ← references: [../../packages/engine,
│                                         ../../packages/card-catalog,
│                                         ../../packages/protocol]
└── src/
    └── index.ts          ← the single annotated script
```

`examples/` is added to `pnpm-workspace.yaml` alongside `packages/*`:

```yaml
packages:
  - 'packages/*'
  - 'examples/*'
```

### Nx tag

The example carries the Nx tag `scope:example`. No production package may depend on it. It is never published to npm — `"private": true` in its `package.json`.

### Runtime

`tsx` is listed as a `devDependency` and used to run the TypeScript source directly:

```
pnpm --filter @thejokersthief/riftbound-example start
```

No build step or compilation output. This is a developer-facing tool, not a production artifact.

### No dependency on test-helpers

The example package does not depend on `@thejokersthief/test-helpers`. All static data is defined inline. This keeps it self-contained and readable without cross-referencing another package.

---

## 2. Static data

All inputs are constants defined at the top of `src/index.ts` before any game logic.

### Player IDs

```ts
// ─── PLAYERS ────────────────────────────────────────────────────────────────
//
// Two players with fixed IDs. In a real server these would be generated
// UUIDs; here we use readable names so the log output is easy to follow.
//
const ARIA  = 'aria'  as PlayerId
const BOWEN = 'bowen' as PlayerId
```

### Seed

```ts
// ─── SEED ───────────────────────────────────────────────────────────────────
//
// A fixed seed makes this example fully deterministic and reproducible.
// The Mulberry32 RNG in the engine uses this value for every shuffle,
// coin flip, and random selection. Change the seed to see a different game.
//
const SEED = 1
```

### Decks

```ts
// ─── DECKS ──────────────────────────────────────────────────────────────────
//
// DeckConfig specifies which cards each player brings to the game.
// These are real CardDefIds from the committed cards.json snapshot.
// createGame() will instantiate CardInstances from these definitions,
// assign each a unique CardId, and shuffle the decks using the seeded RNG.
//
const ARIA_DECK: DeckConfig = {
  battlefields: [
    'battlefield-veilwatch-summit',
    'battlefield-ironpost',
    'battlefield-ashfen',
  ] as [CardDefId, CardDefId, CardDefId],
  legend:   'legend-aria-the-unbound' as CardDefId,
  champion: 'champion-sable'          as CardDefId,
  mainDeck: [ /* 40 CardDefId strings */ ],
  runeDeck: [ /* 10 rune CardDefId strings */ ],
}

const BOWEN_DECK: DeckConfig = {
  battlefields: [
    'battlefield-ashen-crossing',
    'battlefield-stormgate',
    'battlefield-ironpost',
  ] as [CardDefId, CardDefId, CardDefId],
  legend:   'legend-bowen-the-ironclad' as CardDefId,
  champion: 'champion-drez'             as CardDefId,
  mainDeck: [ /* 40 CardDefId strings */ ],
  runeDeck: [ /* 10 rune CardDefId strings */ ],
}
```

### Catalog

```ts
// ─── CATALOG ────────────────────────────────────────────────────────────────
//
// Load card definitions from the committed cards.json snapshot.
// defaultSnapshotSource resolves the path relative to the package using
// import.meta.url, so no path manipulation is needed here.
//
import { CardCatalog, defaultSnapshotSource } from '@thejokersthief/riftbound-card-catalog'
const catalog = new CardCatalog(defaultSnapshotSource)
```

---

## 3. Game flow and action sequence

`src/index.ts` is divided into banner-comment sections, each preceded by a multi-line prose block explaining the API call and what to observe in the output.

### Section structure

```
// ─── CREATE GAME ────────────────────────────────────────────────────────────
// ─── MULLIGAN ───────────────────────────────────────────────────────────────
// ─── BATTLEFIELD SELECTION ──────────────────────────────────────────────────
// ─── TURN 1 — ARIA ──────────────────────────────────────────────────────────
//     Channel rune → play a unit → end turn
// ─── TURN 2 — BOWEN ─────────────────────────────────────────────────────────
//     Channel rune → play a unit → contest a battlefield → end turn
// ─── TURN 3 — ARIA ──────────────────────────────────────────────────────────
//     Chain exchange: PlayCard → Bowen PassPriority → Aria PassPriority → resolves
// ─── TURN 4 — BOWEN ─────────────────────────────────────────────────────────
//     Combat showdown → AssignDamage → unit killed → ControlChanged
// ─── ... (turns continue until a player reaches 8 points) ──────────────────
// ─── GAME END ───────────────────────────────────────────────────────────────
```

Each game turn exercises at least one distinct engine feature, chosen to cover: channeling runes, playing cards, activating abilities, chain exchanges, combat with damage assignment, Hold scoring, and Conquer scoring with the Winning Point guard.

### Submit pattern

Each action is preceded by a comment explaining the intent and followed by event logging:

```ts
// Aria plays a unit to the battlefield. PlayCard opens the chain and gives
// Bowen a PriorityWindow DecisionRequest — he may respond or pass.
// The events array will contain ChainOpened and PriorityWindowOpened.
const r1 = submit(state, {
  type:     'PlayCard',
  playerId: ARIA,
  cardId:   ariaHandCards[0],
}, catalog)
logEvents('Aria plays a unit', r1.events)
state = r1.state
```

### `logEvents` helper

Defined at the top of the file, used after every `submit()` call:

```ts
function logEvents(label: string, events: GameEvent[]): void {
  console.log(`\n▶ ${label}`)
  for (const e of events) console.log(`  ${e.type}`)
}
```

### Turn summary

After each turn's final `submit()` call, `viewFor` is called for the active player and a one-line board summary is printed:

```ts
// viewFor projects GameState into a PlayerView for a specific player,
// redacting opponent information they are not allowed to see.
// Here we use it to print a human-readable board summary.
const view = viewFor(state, ARIA, catalog)
console.log(
  `\n── Aria: ${view.self.points} pts | ` +
  `hand: ${view.self.hand.length} | ` +
  `runes: ${view.self.runePool.filter(s => s.filled).length}/${view.self.runePool.length}`
)
```

### Game-end detection

```ts
// The game ends when status transitions to 'ended'. The engine sets
// state.winner to the player who reached 8 points with strictly more
// than their opponent (core rule 323.1).
if (state.status === 'ended') {
  console.log(`\n═══ Game over — winner: ${state.winner} ═══`)
}
```

---

## 4. What the example demonstrates

Running `pnpm --filter @thejokersthief/riftbound-example start` exercises and annotates:

| Engine feature | Where demonstrated |
|---|---|
| `createGame` — deck validation, shuffle, coin flip, deal hands | Setup section |
| `KeepHand` / `Mulligan` — setup DecisionRequest flow | Mulligan section |
| `ChooseBattlefield` — setup DecisionRequest, both players confirm | Battlefield section |
| Rune channeling | Each Turn — Channel step |
| `PlayCard` — chain opens, PriorityWindow fires | Turn 1 |
| `PassPriority` both players — chain closes, effect resolves | Turn 1 |
| `viewFor` — PlayerView projection, opponent hand redacted | After each turn |
| `ActivateAbility` — exhaust a card, trigger a HOT ability | Turn 2 or 3 |
| `AssignDamage` — lethal-first constraint, unit killed, ControlChanged | Turn 4 |
| Hold scoring — controlled at start and end of turn | Cleanup, Turn 3+ |
| Conquer scoring — battlefield gained mid-turn | After ControlChanged |
| Winning Point guard (core rule 466.1.b) — draws instead of scores | Late-game turn |
| `state.status === 'ended'`, `state.winner` | Game-end section |

---

## 5. Out of scope for this sub-spec

- Best-of-3 match flow — `createMatch` / `submitToMatch` are not used; a single game is sufficient to demonstrate all key engine surfaces
- Networked or async usage — the example is synchronous and local
- Any assertion or test framework — this is not a test suite; it simply runs and logs
