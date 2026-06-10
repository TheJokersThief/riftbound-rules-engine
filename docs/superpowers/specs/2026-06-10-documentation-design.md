# Documentation Design — Riftbound Rules Engine

**Date:** 2026-06-10  
**Status:** Approved

## Goal

Write four human-readable documentation files for the `riftbound-rules-engine` monorepo. Audience is both **integrators** (game developers embedding the engine) and **contributors** (developers extending or fixing the engine). Tone: concise, human-sounding, bullet-heavy with code examples where useful.

---

## Files to Create

### 1. `README.md` (root)

- One-sentence project description
- Bullet list of what the engine does / explicitly does not do (1v1 Match only; offline-compiled card effects; fully serializable state)
- Packages table: package name | description | install command
- Quick-start code snippet (~15 lines): `createGame` → `KeepHand` → advance turn phases → `EndTurn`
- Links to the three docs below

---

### 2. `docs/game-flow.md`

**Intro:** event-sourced reducer, serializable state, no live call stack (explicit resolution stack instead).

**Package dependency diagram** (text):
```
protocol
effect-ir    → protocol
card-catalog → protocol
card-compiler → effect-ir, card-catalog
engine       → protocol, effect-ir, card-catalog
test-helpers → engine, card-catalog, protocol  (dev only)
```

**Core API table** — one-liner per function:

| Function | What it does |
|---|---|
| `createGame` | Validates decks, instantiates cards, shuffles, deals opening hands, returns initial `GameState` |
| `submit` | Applies one player action; returns `{ state, events }` |
| `legalActions` | Lists every valid action for a player right now |
| `viewFor` | Projects `GameState` into a per-player view with opponent info redacted |
| `createMatchEngine` | Binds a catalog to the per-game functions; returns match-level wrappers |

**Mermaid state diagram** — full game lifecycle:
- `setup` → ChooseMulligan decision → `playing`
- Turn loop: Start phase → Channel phase → Main phase
- Main phase actions: PlayCard, PassPriority, EndTurn
- End turn: scoring (Hold / Conquer) → win condition check → rotate active player
- Chain sub-flow: PassPriority × 2 (both players) → items resolve
- `ended` (winner set)

**Match wrapper** — brief explanation of how `createMatch` / `submitToMatch` / `legalMatchActions` sit above the per-game loop and manage game-wins and between-game setup.

**Code example:** minimal turn loop pattern (advanceTurnStart → submit EndTurn).

---

### 3. `docs/testing.md`

**Intro:** tests assert rules correctness, not just code paths. Each technique is tied to a different level of confidence.

**Setup:**
- Catalog loaded once per suite via Vitest `beforeAll`
- `buildBoard` / `buildDeck` from `test-helpers` construct `GameState` directly — no need to run `createGame` and play through setup for every test

**Techniques:**

| Technique | File(s) | Purpose |
|---|---|---|
| Module unit tests | `chain.test.ts`, `turn.test.ts`, `combat.test.ts`, `rules-query.test.ts`, `visibility.test.ts`, etc. | Isolate behavior of a single concern |
| Scenario runner | `runScenario` from `test-helpers` | Declare initial state + action sequence + assertions as one readable block; maps naturally to rules citations |
| Invariant tests | `invariants.test.ts` | Assert properties that must always hold (points never decrease, ended game stays ended, pending decision clears after valid action) |
| Fuzz tests | `fuzz.test.ts` | 100 seeded games pick random legal actions; asserts no throws and game reaches `ended` |
| Determinism tests | `determinism.test.ts` | Same seed + same action log → byte-identical final state |

**Running tests:** `pnpm test` (single run) / `pnpm test:watch` (watch mode).

---

### 4. `docs/contributing.md`

**Prerequisites:** Node 20+, pnpm 9+

**Install:** `pnpm install`

**Common commands:**

| Command | What it does |
|---|---|
| `pnpm test` | Run all tests |
| `pnpm test:watch` | Watch mode |
| `pnpm typecheck` | Type-check all packages |
| `pnpm lint` | Lint all packages |
| `pnpm --filter @thejokersthief/riftbound-example start` | Run the annotated example |

**Package boundaries:**
- Dependency direction is enforced by TypeScript project references — the compiler rejects cross-package imports that aren't declared in `tsconfig.json`
- `engine` must not import `card-compiler` (the engine is deployable without the parser toolchain)
- Adding a cross-package dependency requires a deliberate edit to the relevant `tsconfig.json`

**Adding a card:** edit `packages/card-catalog/data/cards.json` — no engine changes needed. The card-catalog reads from the snapshot at runtime.

**Adding engine behavior:** key entry points by concern:
- Turn phases → `packages/engine/src/turn/`
- Chain / priority → `packages/engine/src/chain/`
- Combat / showdowns → `packages/engine/src/combat/`
- Stat resolution (layers) → `packages/engine/src/rules-query/`
- State events → `packages/engine/src/state/`

**Running the example:** `pnpm --filter @thejokersthief/riftbound-example start`

---

## Constraints

- **Tone:** concise, human-sounding, bullet-heavy. No marketing language.
- **No comments in code snippets** beyond what's needed to orient a reader cold.
- **Mermaid diagram** must cover the full game lifecycle including chain sub-flow.
- **Links:** README links to all three docs; each doc stands alone.
- **Do not** duplicate content from `CONTEXT.md` (glossary) or the ADRs — link to them instead.
