# Card Compiler Package — Design Specification

**Date:** 2026-06-09
**Status:** Approved design, pending implementation plan
**Sub-spec:** #5 of 15 — depends on sub-spec #01 (monorepo & workspace), sub-spec #03 (effect-ir), sub-spec #04 (card-catalog)
**Scope:** `@thejokersthief/riftbound-card-compiler`. The offline build-time pipeline that compiles `CardDefinition` objects into `EffectProgram` trees. Contains the normalizer, sentence segmenter, recursive-descent parser, keyword registry, fallback registry, decompiler, and the compile/verify CLI scripts. No runtime engine logic.

---

## 1. Package structure

```
packages/card-compiler/
├── package.json            ← { "type": "module", dependencies: {
│                                "zod": "^4",
│                                "@thejokersthief/riftbound-effect-ir": "workspace:*",
│                                "@thejokersthief/riftbound-card-catalog": "workspace:*" } }
├── tsconfig.json           ← references: [../effect-ir, ../card-catalog]
├── vitest.config.ts
├── compiler.config.json    ← { "parseRateThreshold": 0.60 }  (committed; raised over time as coverage improves)
├── scripts/
│   ├── compile-catalog.ts  ← CLI: cards.json → compiled-catalog.json
│   └── verify-catalog.ts   ← CI gate: parse rate + round-trip check
└── src/
    ├── compiler.ts         ← createCompiler, Compiler interface, CompiledCard, CompilationResult
    ├── pipeline/
    │   ├── normalizer.ts   ← HTML-stripped text → stable token vocabulary
    │   ├── segmenter.ts    ← normalized text → sentence[]
    │   ├── parser.ts       ← recursive-descent grammar → AbilityNode[]
    │   └── validator.ts    ← post-parse structural sanity checks
    ├── keywords.ts         ← KeywordRegistry: keyword name → AbilityNode expansion
    ├── fallbacks/
    │   ├── index.ts        ← FallbackRegistry implementation, aggregates all fallback files
    │   └── <CardDefId>.ts  ← one file per hand-authored fallback (e.g. abc123.ts)
    ├── decompiler.ts       ← decompile(program): string (round-trip oracle)
    └── index.ts            ← re-exports public surface
```

`compiled-catalog.json` and `coverage-report.json` are written to `packages/card-catalog/data/` and the compiler package root respectively. `coverage-report.json` is gitignored. `compiled-catalog.json` is committed.

---

## 2. Public interface (`compiler.ts`)

```ts
function createCompiler(fallbacks: FallbackRegistry): Compiler

interface Compiler {
  compile(def: CardDefinition): CompiledCard
  compileAll(catalog: CardCatalog): CompilationResult
  decompile(program: EffectProgram): string
}

type CompiledCard =
  | { status: 'parsed';   defId: CardDefId; program: EffectProgram }
  | { status: 'fallback'; defId: CardDefId; program: EffectProgram }
  | { status: 'unparsed'; defId: CardDefId }

type CompilationResult = {
  cards:          CompiledCard[]
  parseRate:      number                   // parsed / (parsed + unparsed), 0–1; fallbacks excluded
  coverageReport: CoverageReport
}

type CoverageReport = {
  total:               number
  parsed:              number
  fallback:            number
  unparsed:            number
  unparsedIds:         CardDefId[]         // list for authoring new fallback files
  roundTripFailures:   RoundTripFailure[]
}

type RoundTripFailure = {
  defId:      CardDefId
  original:   string
  decompiled: string
}
```

**`compile` flow:**
1. Run normalizer → segmenter → parser → validator
2. On success: return `{ status: 'parsed', program }`
3. On `ParseError` or `ValidationError`: check `FallbackRegistry`
   - Fallback found: return `{ status: 'fallback', program: fallback }`
   - No fallback: return `{ status: 'unparsed' }`

**`compileAll`** runs `compile` over every card in the catalog, then runs the decompile round-trip on every `'parsed'` card and assembles the `CompilationResult`.

---

## 3. Pipeline internals (`pipeline/`)

Four stages run in sequence per card.

### Normalizer (`normalizer.ts`)

Input: `abilityText` (HTML already stripped by the ingestion tool, `:rb_*:` tokens preserved).
Output: `NormalizedText` — a string with a stable token vocabulary.

- `:rb_action:`, `:rb_reaction:`, `:rb_any:` etc. preserved as-is
- `[Keyword]` and `[Keyword N]` tags preserved as-is
- Parenthetical reminder text `(…)` discarded
- Whitespace normalized: collapse runs, trim

The normalizer is thin — the ingestion tool already did heavy HTML cleaning. Its job is token stability for the parser and the round-trip diff.

### Segmenter (`segmenter.ts`)

Input: `NormalizedText`. Output: `string[]` — one element per logical sentence.

Splits on `.` boundaries while respecting:
- Cost patterns like `:rb_action:: Do X.` are a single unit (the cost prefix is not a sentence terminator)
- `[Keyword N]` tags with numeric arguments do not split mid-tag
- Edge cases are covered by inline unit tests in `segmenter.test.ts`

### Parser (`parser.ts`)

Input: `string[]`. Output: `AbilityNode[]` or throws `ParseError`.

A hand-written recursive-descent grammar. Entry points per sentence type:

| Pattern | Produces |
|---|---|
| `When … , …` / `At the start of …` | `TriggeredAbility` |
| `<cost>: …` | `ActivatedAbility` |
| `[Keyword]` / `While …` / `Your …` | `StaticAbility` |

The parser returns `{ type: 'Unparsed' }` for any sentence it cannot confidently match and throws `ParseError` for the whole card — partial parses are not returned. It is all-or-nothing per card.

### Validator (`validator.ts`)

Input: `AbilityNode[]`. Output: `AbilityNode[]` (unchanged) or throws `ValidationError`.

Post-parse structural checks:
- Selector quantities are non-negative integers
- `LayerNumber` is in `1 | 2 | 3 | 4 | 5`
- `ForEach` does not nest another `ForEach` (depth guard for v1)
- `CostNode[]` arrays are non-empty for `ActivatedAbility`

---

## 4. Keyword registry (`keywords.ts`)

Keywords are expanded once into structured `AbilityNode` definitions. The parser recognizes a `[Keyword]` tag, looks it up in the registry, and substitutes the expansion — it never re-parses keyword semantics from text.

```ts
interface KeywordRegistry {
  get(name: string): KeywordExpansion | null
}

type KeywordExpansion =
  | { kind: 'ability';      node: AbilityNode }
  | { kind: 'property';     description: string }
  | { kind: 'costModifier'; modifier: CostNode }
```

Parameterised keywords (`Deflect N`, `Accelerate N`, `Repeat N`) carry their numeric argument through the tag: `[Deflect 2]` → `{ name: 'Deflect', param: 2 }` before registry lookup. The registry entry for `Deflect` accepts the param and produces the correct `AbilityNode`.

Representative entries from core rules 805–826:

| Keyword | Kind | Notes |
|---|---|---|
| `Reaction` | ability | `ActivatedAbility { timing: 'Showdown' }` |
| `Action` | ability | `ActivatedAbility { timing: 'Chain' }` |
| `Assault` | ability | `TriggeredAbility { event: WhenAttacks }` |
| `Deathknell` | ability | `TriggeredAbility { event: WhenKilled }` |
| `Ambush` | ability | `TriggeredAbility { event: WhenEntersPlay }` |
| `Deflect N` | ability | `TriggeredAbility { event: WhenDealtDamage }` with N param |
| `Tank` | property | guard unit, redirect damage |
| `Backline` | property | cannot attack |
| `Unique` | property | deck-construction constraint |
| `Hidden` | property | enters play face-down |

---

## 5. FallbackRegistry (`fallbacks/`)

```ts
interface FallbackRegistry {
  get(defId: CardDefId): EffectProgram | null
}
```

### Per-card fallback files

One TypeScript file per hand-authored card, named by `CardDefId`:

```ts
// fallbacks/abc123.ts
import type { EffectProgram } from '@thejokersthief/riftbound-effect-ir'

const program: EffectProgram = {
  type: 'Compiled',
  abilities: [
    {
      type: 'Triggered',
      event: { type: 'WhenPlayed' },
      effect: { type: 'Draw', player: 'You', count: 1 }
    }
  ]
}

export default program
```

TypeScript enforces that every fallback file exports a valid `EffectProgram` at compile time.

### `fallbacks/index.ts`

Aggregates all fallback files into the registry:

```ts
import abc123 from './abc123.js'
// … one import per fallback file

const registry: Record<string, EffectProgram> = { 'abc123': abc123 }

export const fallbackRegistry: FallbackRegistry = {
  get: (defId) => registry[defId] ?? null
}
```

Only `fallbacks/index.ts` needs updating when a new fallback is added. The `unparsedIds` array in `CoverageReport` identifies exactly which `CardDefId` values need fallback files.

---

## 6. Decompiler (`decompiler.ts`)

```ts
function decompile(program: EffectProgram): string
```

Walks the `EffectProgram` node tree and reconstructs normalized ability text following the inverse of the parser's grammar rules:

| Node | Decompiled text |
|---|---|
| `TriggeredAbility { event: WhenAttacks }` | `"When I attack, <effect>"` |
| `ActivatedAbility { cost, effect }` | `"<cost>: <effect>"` |
| `StaticAbility { modification: AddKeyword 'Tank' }` | `"[Tank]"` |
| `Sequence([A, B])` | `"<A>. <B>"` |
| `Optional { effect }` | `"You may <effect>"` |
| `ChooseOne { options }` | `"Choose one — <A> or <B>"` |
| `Deal { amount: 2 }` | `"Deal 2 damage"` |

Only called on `'parsed'` cards during the CI round-trip check — never on `Unparsed` programs.

**CI round-trip check:** `compileAll` calls `decompile(program)` on every `'parsed'` card, normalizes both strings through the same normalizer step, and diffs them. Mismatches are recorded in `CoverageReport.roundTripFailures`. CI fails if `roundTripFailures.length > 0`.

---

## 7. Compile script and CI gate

### `scripts/compile-catalog.ts` — invoked via `just compile-cards`

Wired as Nx target `compile`:
```json
{ "targets": { "compile": { "command": "tsx scripts/compile-catalog.ts" } } }
```

Steps:
1. Load `packages/card-catalog/data/cards.json` via `defaultSnapshotSource`
2. Create compiler with `fallbackRegistry`
3. Call `compileAll(catalog)`
4. Write `packages/card-catalog/data/compiled-catalog.json`:
   ```json
   {
     "abc123": { "type": "Compiled", "abilities": [ … ] },
     "def456": { "type": "Unparsed" }
   }
   ```
5. Write `coverage-report.json` to the compiler package root (gitignored)
6. Print summary: total / parsed / fallback / unparsed / parse rate / round-trip failures

### `scripts/verify-catalog.ts` — invoked in CI via `just verify-catalog`

Wired as Nx target `verify-catalog`:
```json
{ "targets": { "verify-catalog": { "command": "tsx scripts/verify-catalog.ts" } } }
```

Loads the committed `compiled-catalog.json` and asserts:
1. Parse rate ≥ threshold from `compiler.config.json` (default `0.60`)
2. `roundTripFailures.length === 0`
3. Every card id in `cards.json` has a corresponding entry in `compiled-catalog.json`

Does not regenerate — validates the committed artifact only.

### `.justfile` additions (amendments to sub-spec #01)

```just
compile-cards:
    pnpm --filter @thejokersthief/riftbound-card-compiler run compile

verify-catalog:
    pnpm --filter @thejokersthief/riftbound-card-compiler run verify-catalog
```

`verify-catalog` is added to the `ci` recipe:

```just
ci: typecheck lint format test verify-catalog
```

---

## 8. Out of scope for this sub-spec

- 100% card parse coverage (the fallback registry covers the long tail as needed)
- Runtime parsing or on-demand compilation (the engine loads only the committed compiled-catalog.json)
- The `EffectInterpreter` that executes compiled programs at runtime (engine sub-spec #8)
