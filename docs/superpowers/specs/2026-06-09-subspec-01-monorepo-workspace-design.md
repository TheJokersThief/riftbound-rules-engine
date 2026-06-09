# Monorepo & Workspace Setup — Design Specification

**Date:** 2026-06-09
**Status:** Approved design, pending implementation plan
**Scope:** Sub-spec #1 of the Riftbound Rules Engine. Establishes the Nx + pnpm monorepo: five package skeletons, TypeScript project-reference boundaries, Vitest, oxlint, oxfmt (Biome fallback), GitHub Actions CI, domain glossary, and five seeded ADRs. No domain logic; no types beyond stub exports.

---

## 1. Workspace layout

```
riftbound-rules-engine/
├── nx.json
├── package.json                ← workspace root (pnpm)
├── pnpm-workspace.yaml
├── tsconfig.base.json          ← shared compiler options + path aliases
├── vitest.workspace.ts         ← discovers all package vitest configs
├── oxlint.json
├── .justfile                   ← common workspace recipes (just refresh-catalog, just ci, etc.)
├── CONTEXT.md                  ← domain glossary
├── docs/
│   └── adr/
│       ├── 0001-match-mode-only.md
│       ├── 0002-event-sourced-reducer.md
│       ├── 0003-battlefield-selection-default.md
│       ├── 0004-offline-compilation.md
│       └── 0005-five-package-split.md
└── packages/
    ├── protocol/               ← @thejokersthief/riftbound-protocol
    ├── effect-ir/              ← @thejokersthief/riftbound-effect-ir
    ├── card-catalog/           ← @thejokersthief/riftbound-card-catalog
    ├── card-compiler/          ← @thejokersthief/riftbound-card-compiler
    └── engine/                 ← @thejokersthief/riftbound-engine
```

Each package is identical at this stage:

```
packages/<name>/
├── package.json                ← name, type: module, exports, peerDeps
├── tsconfig.json               ← extends base, declares references
├── vitest.config.ts
└── src/
    └── index.ts                ← single stub: export {}
```

---

## 2. Package graph and boundary enforcement

Boundaries are enforced by TypeScript project references. If a package is not listed in another's `tsconfig.json` `references` array, the TypeScript compiler and the IDE will error on any import from it.

| Package | May import |
|---|---|
| `protocol` | *(none)* |
| `effect-ir` | `protocol` |
| `card-catalog` | `protocol` |
| `card-compiler` | `effect-ir`, `card-catalog` |
| `engine` | `protocol`, `effect-ir`, `card-catalog` |

The critical constraint from the master spec — `engine` must not import `card-compiler` — is encoded by the absence of a reference. No extra tooling or lint rule is required.

> Note: `effect-ir` → `protocol` was added in sub-spec #03, and `card-catalog` → `protocol` was added in sub-spec #04, both to share branded ID types (`CardDefId`, etc.) rather than redefine them locally.

---

## 3. TypeScript configuration

`tsconfig.base.json` at the workspace root:

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true,
    "composite": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src"
  }
}
```

`strict: true`, `exactOptionalPropertyTypes`, and `noUncheckedIndexedAccess` together catch the widest class of real bugs. Starting strict is easier than tightening later.

Each package's `tsconfig.json` (example for `card-compiler`):

```jsonc
{
  "extends": "../../tsconfig.base.json",
  "references": [
    { "path": "../effect-ir" },
    { "path": "../card-catalog" }
  ],
  "include": ["src"]
}
```

---

## 4. Tooling

### Vitest

`vitest.workspace.ts` at the root discovers all packages:

```ts
export default ['packages/*/vitest.config.ts']
```

Each package's `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: { include: ['src/**/*.test.ts'] }
})
```

Coverage via `@vitest/coverage-v8`. `vitest run` from the root exercises all packages.

### oxlint

`oxlint.json` at the root:

```jsonc
{
  "rules": {
    "correctness": "error",
    "suspicious": "warn"
  }
}
```

Run as `oxlint ./packages/*/src`.

### oxfmt

`oxfmt` is the intended formatter. If it is not sufficiently stable at implementation time, **Biome** (`biome format`) is the direct fallback — same speed class, stable, zero-config by default. The implementation plan should verify oxfmt's status before scaffolding and use Biome if needed.

### just

A `.justfile` at the workspace root provides named recipes for all common operations. `just` is installed as a dev tool (not a package dependency — installed globally or via a devcontainer):

```just
# List all available recipes
default:
    just --list

# Run all checks (mirrors CI)
ci: typecheck lint format test

typecheck:
    pnpm nx run-many --target=typecheck --all

lint:
    pnpm nx run-many --target=lint --all

format:
    pnpm nx run-many --target=format --all

test:
    pnpm nx run-many --target=test --all

# Refresh the card catalog snapshot from the live riftdex endpoint
refresh-catalog:
    pnpm --filter @thejokersthief/riftbound-card-catalog run refresh

# Compile cards.json → compiled-catalog.json
compile-cards:
    pnpm --filter @thejokersthief/riftbound-card-compiler run compile

# Validate committed compiled-catalog.json (parse rate + round-trip check)
verify-catalog:
    pnpm --filter @thejokersthief/riftbound-card-compiler run verify-catalog

# Install all dependencies
install:
    pnpm install
```

The `ci` recipe includes `verify-catalog`:

```just
ci: typecheck lint format test verify-catalog
```

Additional recipes are added to `.justfile` as new sub-specs introduce new runnable operations.

### Nx task targets

`nx.json` defines four targets that fan out across all packages via `nx run-many`:

| Target | Command |
|---|---|
| `typecheck` | `tsc --noEmit -p tsconfig.json` |
| `lint` | `oxlint ./src` |
| `format` | `oxfmt check ./src` (or `biome format --check ./src`) |
| `test` | `vitest run` |

---

## 5. CI

`.github/workflows/ci.yml` — runs on every push and pull request:

```yaml
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm nx run-many --target=typecheck --all
      - run: pnpm nx run-many --target=lint --all
      - run: pnpm nx run-many --target=format --all
      - run: pnpm nx run-many --target=test --all
```

Steps run in order: typecheck first (cheapest; catches boundary violations immediately), then lint, format, then tests.

Nx remote cache is not included; it can be added once there is enough build volume to justify it.

---

## 6. Documentation

### CONTEXT.md

The domain glossary at the workspace root. Defines the rulebook vocabulary that module names, type names, and comments draw from. Covers:

- **Game structure:** Match, Game, Turn, Phase (Start / Main / Ending), Cleanup
- **Zones:** Battlefield Zone, Legend Zone, Champion Zone, Main Deck, Rune Deck, Base
- **Actors:** Legend, Chosen Champion, Unit, Gear, Spell, Token
- **Resources:** Rune, Energy, Power, XP
- **Resolution:** Chain, Showdown (Combat / Non-combat), Priority, Focus, Resolution Stack
- **Sequences:** FEPR (Finalize → Execute → Pass → Resolve), HOT FEPR (Handle Outstanding Tasks → FEPR)
- **Scoring:** Conquer, Hold, Winning Point, Victory Score (8 points)
- **Engine concepts:** Decision Request, Effect Program, Layers System, Player View, Seeded RNG

### docs/adr/

Five architecture decision records, each following the standard template (title, status, context, decision, consequences):

| File | Decision captured |
|---|---|
| `0001-match-mode-only.md` | 1v1 Match is the only supported mode; Duel, FFA, and 2v2 are out of scope |
| `0002-event-sourced-reducer.md` | Small-step reducer with explicit resolution stack; generator/coroutine approach rejected because JS generators do not serialize |
| `0003-battlefield-selection-default.md` | Player-choice battlefield selection is the default; random is a configurable option via the seeded RNG |
| `0004-offline-compilation.md` | Cards are compiled to an effect program offline as a build step; the engine never parses card text at runtime |
| `0005-five-package-split.md` | The five-package layout and the TypeScript project-reference graph that enforces the dependency direction |

---

## 7. Out of scope for this sub-spec

- Any domain types, interfaces, or logic (those belong to sub-specs #2–#14)
- Nx remote cache / nx-cloud
- Publishing configuration (the packages are internal to the monorepo for now)
- An automated player or AI opponent
