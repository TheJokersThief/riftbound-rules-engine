# Testing Guide

Tests in this repo assert **rules correctness** — that the engine behaves the way the Riftbound rulebook says it should. Code coverage is a side-effect, not the goal.

## Setup

The test suite lives in `packages/engine/src/__tests__/` (engine tests) and `packages/*/src/` (per-package tests). All tests use [Vitest](https://vitest.dev/).

The card catalog is loaded once per suite using Vitest's `beforeAll`:

```ts
import { createCardCatalog, defaultSnapshotSource } from '@thejokersthief/riftbound-card-catalog'
import type { CardCatalog } from '@thejokersthief/riftbound-card-catalog'

let catalog: CardCatalog

beforeAll(async () => {
  catalog = await createCardCatalog(defaultSnapshotSource)
})
```

Most tests use `buildBoard` and `buildDeck` from `@thejokersthief/riftbound-test-helpers` to construct a `GameState` directly — bypassing `createGame` and mulligan so tests start at the exact board position they need:

```ts
import { buildBoard } from '@thejokersthief/riftbound-test-helpers'
import { toPlayerId } from '@thejokersthief/riftbound-protocol'

const P1 = toPlayerId('p1')
const P2 = toPlayerId('p2')

const state = buildBoard({
  players: [P1, P2],
  catalog,
  board: {
    [P1]: { points: 7, resources: { energy: 3, power: 5 } },
    [P2]: { points: 0 },
  },
})
```

## Running Tests

```bash
pnpm test          # single run, all packages
pnpm test:watch    # watch mode
```

## Techniques

### Module Unit Tests

Each engine concern has its own test file:

| File | What it covers |
|---|---|
| `chain.test.ts` | Priority passing, chain open/close, item resolution order |
| `turn.test.ts` | Start / Channel / Main / Ending phase transitions |
| `combat.test.ts` | Damage assignment, unit death, control changes |
| `rules-query.test.ts` | Stat resolution via the 5-layer dependency graph |
| `visibility.test.ts` | Opponent info redaction in `viewFor` |
| `interpreter.test.ts` | Effect program execution |
| `facade.test.ts` | Full `submit` dispatch for each action type |
| `match.test.ts` | Match-level game-win tracking and between-game setup |

Tests use `buildBoard` to set up only what the test needs, then call `submit` directly and assert on the returned `state` and `events`.

### Scenario Runner

`runScenario` from `test-helpers` lets you express a test as: initial state + ordered action sequence + assertion. The `rules` field cites the relevant rulebook section, making it easy to trace a failing test back to the rule it's testing.

```ts
import { buildBoard, runScenario } from '@thejokersthief/riftbound-test-helpers'
import { toBattlefieldId, toPlayerId } from '@thejokersthief/riftbound-protocol'

const P1 = toPlayerId('p1')
const P2 = toPlayerId('p2')
const BF = toBattlefieldId('bf-p1')

runScenario({
  name: 'Hold scoring awards 1 point for a battlefield controlled at start and end of turn',
  rules: ['core 312.4'],
  catalog,
  initial: buildBoard({
    players: [P1, P2],
    catalog,
    board: { [P1]: { points: 0 }, [P2]: { points: 0 } },
    battlefields: { [BF]: { controllerId: P1 } },
  }),
  actions: [{ type: 'EndTurn', playerId: P1 }],
  assert: ({ finalState }) => {
    expect(finalState.players[P1]?.points).toBe(1)
  },
})
```

### Invariant Tests

`invariants.test.ts` asserts properties that must hold regardless of what actions are taken — not for a specific board position, but as engine-wide guarantees:

- Points never decrease during a game
- A game with `status: 'ended'` ignores further `submit` calls
- `pendingDecision` is cleared after a valid response action
- `activePlayerId` is always one of the two declared players

### Fuzz Tests

`fuzz.test.ts` runs multiple seeded games. Each step picks a random legal action from `legalActions`. The test asserts no unhandled exceptions at any point:

```ts
import { FUZZ_ITERATIONS, playFuzzGame } from '@thejokersthief/riftbound-test-helpers'

it('does not throw across multiple seeds', () => {
  const REDUCED = Math.min(FUZZ_ITERATIONS, 20)
  for (let seed = 0; seed < REDUCED; seed++) {
    expect(() => playFuzzGame(seed, catalog, 100)).not.toThrow()
  }
})
```

`playFuzzGame` uses a deterministic pick function (not `Math.random`) so failures are reproducible by seed.

### Determinism Tests

`determinism.test.ts` replays the same seed and action sequence twice and asserts the final states are deep-equal. This catches any accidental use of `Math.random()` or `Date.now()` anywhere in the engine:

```ts
import { playFuzzGame } from '@thejokersthief/riftbound-test-helpers'

it('produces identical states for the same seed', () => {
  const r1 = playFuzzGame(42, catalog, 200)
  const r2 = playFuzzGame(42, catalog, 200)
  expect(r1.matchState.currentGame).toEqual(r2.matchState.currentGame)
})
```

## test-helpers Reference

`@thejokersthief/riftbound-test-helpers` is a dev-only package (never deployed to production). It exports:

| Export | Purpose |
|---|---|
| `buildDeck(overrides?)` | Returns a valid `DeckConfig` using real card IDs from `packages/card-catalog/data/cards.json` |
| `buildBoard(config)` | Constructs a `GameState` at a specific board position without running through `createGame` |
| `buildMatch(config)` | Constructs a `MatchState` ready to receive actions |
| `runScenario(scenario)` | Runs an action sequence and calls `assert` on the result |
| `playFuzzGame(seed, catalog, maxActions)` | Plays a full game picking random legal actions at each step |
| `expectEvent(events, partial)` | Asserts an event matching the partial shape exists in the list |
| `expectNoEvent(events, type)` | Asserts no event of the given type exists in the list |
| `FUZZ_ITERATIONS` | Default number of seeds for fuzz tests (100) |
