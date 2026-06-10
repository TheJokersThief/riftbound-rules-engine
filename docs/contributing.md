# Contributing

## Prerequisites

- Node 20+
- pnpm 9+

## Install

```bash
pnpm install
```

That's it. No additional setup required.

## Common Commands

| Command | What it does |
|---|---|
| `pnpm test` | Run all tests once |
| `pnpm test:watch` | Run tests in watch mode |
| `pnpm typecheck` | Type-check all packages |
| `pnpm lint` | Lint all packages (Biome + oxlint) |
| `pnpm --filter @thejokersthief/riftbound-example start` | Run the annotated example walkthrough |

## Package Boundaries

The dependency graph is enforced by **TypeScript project references** — the compiler rejects imports that cross undeclared boundaries. You cannot accidentally break it.

```
protocol
effect-ir    → protocol
card-catalog → protocol
card-compiler → effect-ir, card-catalog
engine       → protocol, effect-ir, card-catalog
test-helpers → engine, card-catalog, protocol  (dev only)
```

The critical constraint: `engine` must not import `card-compiler`. The engine is deployable without the parser toolchain. Adding any cross-package dependency requires a deliberate edit to the `tsconfig.json` in the importing package — the compiler will reject the import otherwise.

## Adding a Card

Edit `packages/card-catalog/data/cards.json`. No engine changes needed — the catalog reads from this snapshot at runtime via `defaultSnapshotSource`. If the card has ability text, the card-compiler package parses it into an effect program at build time.

## Key Directories by Concern

| Concern | Location |
|---|---|
| Turn phases (Start, Channel, Main, Ending, Cleanup) | `packages/engine/src/turn/` |
| Chain resolution and priority | `packages/engine/src/chain/` |
| Combat and showdowns | `packages/engine/src/combat/` |
| Stat resolution (5-layer dependency graph) | `packages/engine/src/rules-query/` |
| State events and `fold` reducer | `packages/engine/src/state/` |
| Effect interpreter | `packages/engine/src/interpreter/` |
| Player view projection (`viewFor`) | `packages/engine/src/visibility/` |
| Match-level orchestration | `packages/engine/src/match/` |
| Wire types and branded IDs | `packages/protocol/src/` |
| Card ability text parser | `packages/card-compiler/src/` |
| Card definitions | `packages/card-catalog/data/cards.json` |

## Running the Example

```bash
pnpm --filter @thejokersthief/riftbound-example start
```

The file at `examples/riftbound-example/src/index.ts` walks through a full game from `createGame` to `status: 'ended'`, with inline comments explaining every call. It's the best starting point for understanding how the engine fits together.

## Further Reading

- [`CONTEXT.md`](../CONTEXT.md) — domain glossary (Match, Chain, Showdown, FEPR, etc.)
- [`docs/adr/`](adr/) — architectural decision records explaining key design choices
- [`docs/game-flow.md`](game-flow.md) — engine architecture and game lifecycle diagram
- [`docs/testing.md`](testing.md) — testing methodology and test-helpers reference
