# Engine: Testing Infrastructure — Design Specification

**Date:** 2026-06-09
**Status:** Approved design, pending implementation plan
**Sub-spec:** #15 of 15 — depends on sub-spec #01 (monorepo & workspace), sub-spec #02 (protocol), sub-spec #04 (card-catalog), sub-spec #05 (card-compiler), sub-spec #06 (engine game state), sub-spec #14 (engine façade)
**Scope:** The `packages/test-helpers` package and all engine/compiler test suites. Covers six test categories: fixtures, scenario test harness, determinism test, parser corpus test, property/invariant tests, and fuzz playthroughs.

---

## 1. Package structure

`packages/test-helpers` is a test-only package. It is a `devDependency` of the engine and card-compiler packages — it never appears in a production `dependencies` field.

```
packages/test-helpers/
├── package.json          ← devDependency of engine, card-compiler; depends on protocol, card-catalog, engine
├── tsconfig.json         ← references: [../protocol, ../card-catalog, ../engine]
└── src/
    ├── fixtures.ts       ← buildDeck(), buildBoard(), buildMatch()
    ├── scenario.ts       ← Scenario type + runScenario()
    ├── assertions.ts     ← toHaveEvent(), toHaveState() Vitest matchers
    ├── fuzz.ts           ← playFuzzGame(), FuzzResult, FUZZ_ITERATIONS
    └── index.ts          ← re-exports all public helpers
```

### Nx tag

`test-helpers` carries the Nx tag `scope:test`. The workspace module-boundary rule allows `scope:engine` and `scope:compiler` packages to `devDependend` on `scope:test`. No package may list `scope:test` in its production `dependencies`.

### Test file locations

Each test suite lives alongside the package it exercises:

| Suite | Location |
|---|---|
| Scenario tests | `packages/engine/src/**/__tests__/*.test.ts` |
| Determinism test | `packages/engine/src/__tests__/determinism.test.ts` |
| Invariant tests | `packages/engine/src/__tests__/invariants.test.ts` |
| Fuzz test | `packages/engine/src/__tests__/fuzz.test.ts` |
| Corpus test | `packages/card-compiler/src/__tests__/corpus.test.ts` |

Scenario test files are named by the core rule number they exercise: `466.1.b-winning-point-guard.test.ts`.

---

## 2. Fixtures (`fixtures.ts`)

Three builder helpers that let scenarios set up state without boilerplate.

```ts
// Builds a minimal valid DeckConfig — caller overrides specific fields
function buildDeck(overrides?: Partial<DeckConfig>): DeckConfig

// Constructs a GameState directly, bypassing the createGame setup flow.
// Unspecified zones get sensible defaults: empty hand, empty deck,
// 0 points, 2 rune slots unfilled, no cards in battle.
function buildBoard(config: {
  players:      readonly [PlayerId, PlayerId]
  seed?:        number                                          // defaults to 0
  board:        Record<PlayerId, Partial<PlayerState>>
  cards?:       Partial<Record<CardId, Partial<CardInstance>>>
  battlefields?: Partial<Record<BattlefieldId, Partial<BattlefieldState>>>
  catalog:      CardCatalog
}): GameState

// Convenience wrapper — calls createMatch() with two buildDeck() configs
function buildMatch(config: {
  players: readonly [PlayerId, PlayerId]
  seed?:   number
  catalog: CardCatalog
}): MatchState
```

`buildBoard` is the workhorse: it lets a scenario start mid-game (e.g. a player at 6 points with specific cards in hand) without replaying the full setup flow. The resulting `GameState` passes `GameStateSchema` validation.

---

## 3. Scenario test harness (`scenario.ts`)

### Types

```ts
type Scenario = {
  name:    string
  rules:   string[]       // required: core rule numbers exercised, e.g. ['466.1.b']
  catalog: CardCatalog
  initial: GameState      // typically built with buildBoard()
  actions: Action[]       // submitted in order via submit()
  assert:  (result: ScenarioResult) => void
}

type ScenarioResult = {
  finalState:  GameState
  allEvents:   GameEvent[][]   // events per submit() call, in order
  flatEvents:  GameEvent[]     // all events flattened
}
```

### Runner

```ts
function runScenario(scenario: Scenario): ScenarioResult
```

`runScenario` loops `submit(state, action, catalog)` for each action in order, threading state through and collecting events. It throws immediately if any `submit()` call throws — the first illegal action fails the test rather than silently continuing.

### Usage pattern

```ts
import { describe, it, expect } from 'vitest'
import { runScenario, buildBoard } from '@thejokersthief/test-helpers'

describe('Winning Point guard (466.1.b)', () => {
  it('draws a card instead of scoring when Conquering at 7 points with one battlefield unscored', () => {
    runScenario({
      name:    'Conquer at 7 — partial battlefield coverage draws instead of scores',
      rules:   ['466.1.b'],
      catalog,
      initial: buildBoard({ ... }),
      actions: [...],
      assert:  ({ flatEvents }) => {
        expect(flatEvents).toContainEqual(expect.objectContaining({ type: 'CardDrawn' }))
        expect(flatEvents).not.toContainEqual(expect.objectContaining({ type: 'PointScored' }))
      }
    })
  })
})
```

---

## 4. Determinism test (`determinism.test.ts`)

Exercises the primary integration guarantee: same seed + same action log → byte-identical serialized state. This is the replay and resync guarantee for the consuming server.

```ts
const DETERMINISM_ITERATIONS = 200  // actions per run — enough to exercise a full game, < 50 ms

it('produces byte-identical serialized state when replayed with the same seed', () => {
  const seed = 42
  const { matchState: run1 } = playFuzzGame(seed, catalog, DETERMINISM_ITERATIONS)
  const { matchState: run2 } = playFuzzGame(seed, catalog, DETERMINISM_ITERATIONS)
  expect(serialize(run1.currentGame)).toBe(serialize(run2.currentGame))
})
```

Both runs execute in the same process. A failure here points at a nondeterminism bug in the engine — common causes: `Math.random()`, `Date.now()`, `Map` iteration order, or `Object.keys` sort instability.

---

## 5. Parser corpus test (`corpus.test.ts`)

Lives in `packages/card-compiler`. This is separate from the `verify-catalog` CI gate (a `just` command) — the corpus test runs inside Vitest and gives per-card failure output with inline diffs.

Three `it` blocks:

```ts
it('parse rate meets threshold', () => {
  const results = compiler.compileAll(catalog.all())
  const parsed  = results.filter(r => r.status === 'parsed').length
  const rate    = parsed / results.length
  expect(rate).toBeGreaterThanOrEqual(config.parseRateThreshold)  // from compiler.config.json
})

it('round-trip: decompile(compile(card)) matches original for all parsed cards', () => {
  const failures = results
    .filter(r => r.status === 'parsed')
    .filter(r => decompile(r.compiled) !== r.original)
  expect(failures).toHaveLength(0)
  // on failure: failures.map(f => `${f.defId}: ${diff(f.original, decompile(f.compiled))}`)
})

it('compiled IR snapshot matches committed compiled-catalog.json', () => {
  const freshCompiled = JSON.stringify(compiler.compileAll(catalog.all()), null, 2)
  const committed     = readFileSync('packages/card-catalog/data/compiled-catalog.json', 'utf8')
  expect(freshCompiled).toBe(committed)
  // failure message: 'Run `just refresh-catalog` and commit the updated file'
})
```

The snapshot assertion catches parser changes where the catalog artifact was not regenerated. It fails loudly with a message directing the developer to run `just refresh-catalog`.

---

## 6. Property / invariant tests (`invariants.test.ts`)

Four invariants verified by running `playFuzzGame` and asserting the invariant holds across every state transition in 100 games.

`playFuzzGame` returns intermediate states for this purpose:

```ts
type FuzzResult = {
  matchState: MatchState
  states:     GameState[]   // every GameState produced during the run
}
```

| Invariant | Assertion |
|---|---|
| **Card conservation** | `Object.keys(state.cards).length` equals the initial count for every state — no card created or destroyed without a corresponding event |
| **Points non-decreasing** | For every consecutive state pair: `state.players[p].points >= prev.players[p].points` for both players |
| **Priority ≠ Focus** | When a showdown is active: `state.chain.priority !== state.chain.focus` (both may be null, but never the same non-null player) |
| **Score-once-per-battlefield** | `state.scoredThisTurn[p]` contains no duplicate `BattlefieldId` entries for either player |

Each invariant is a single `it` block running 100 seeds × up to 200 actions:

```ts
it('card count is conserved across all state transitions', () => {
  for (let seed = 0; seed < 100; seed++) {
    const { states } = playFuzzGame(seed, catalog, 200)
    const initial = Object.keys(states[0].cards).length
    for (const state of states) {
      expect(Object.keys(state.cards).length).toBe(initial)
    }
  }
})
```

---

## 7. Fuzz playthroughs (`fuzz.test.ts`)

Crash coverage: surface throws, infinite loops, or illegal states that scenario tests don't reach.

```ts
const FUZZ_ITERATIONS = 1000  // defined in test-helpers/src/fuzz.ts

it('completes 1000 random games without throwing or reaching an illegal state', () => {
  for (let seed = 0; seed < FUZZ_ITERATIONS; seed++) {
    expect(() => playFuzzGame(seed, catalog, 500)).not.toThrow()
  }
})
```

### `playFuzzGame` (`test-helpers/src/fuzz.ts`)

```ts
// Fixed test player IDs — stable across all fuzz runs
const FUZZ_PLAYER_1 = 'p1' as PlayerId
const FUZZ_PLAYER_2 = 'p2' as PlayerId

function playFuzzGame(
  seed:       number,
  catalog:    CardCatalog,
  maxActions: number
): FuzzResult {
  let match = buildMatch({ players: [FUZZ_PLAYER_1, FUZZ_PLAYER_2], seed, catalog })
  const states: GameState[] = [match.currentGame]

  for (let i = 0; i < maxActions; i++) {
    if (match.status === 'ended') break
    const activeId = match.currentGame.activePlayerId
    const actions  = legalMatchActions(match, activeId)
    if (actions.length === 0) break
    const action = actions[pickRandom(seed + i, actions.length)]
    const { matchState } = submitToMatch(match, action)
    match = matchState
    states.push(match.currentGame)
  }
  return { matchState: match, states }
}
```

### Failure replay

When a fuzz test throws, the seed is the loop index — the error message includes the seed. Replay any failing game with `playFuzzGame(failingSeed, catalog, 500)` in isolation. No external state required.

### CI budget

1000 games × 500 actions = up to 500 000 `submit()` calls. Target: < 30 seconds on CI hardware. If the suite exceeds that, reduce `FUZZ_ITERATIONS` in `test-helpers/src/fuzz.ts` — it is defined once and shared by all test suites that call `playFuzzGame`.

---

## 8. Out of scope for this sub-spec

- Networking, persistence, or UI integration tests — owned by the consuming server
- Mutation testing or coverage thresholds — not part of the CI gate
- AI/automated player for test generation — `legalActions` makes one possible later, but it is not part of this engine
