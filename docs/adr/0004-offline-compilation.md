# ADR-0004: Offline Card Compilation; Engine Never Parses at Runtime

**Status:** Accepted  
**Date:** 2026-06-09

## Context

Card text in Riftbound is natural language that must be translated into executable engine
operations. Two strategies exist:

1. **Runtime parsing** — parse card text inside `submit()` on every play. Simple tooling
   pipeline but adds a parser dependency to the engine and makes each action slower.
2. **Offline compilation** — parse card text in a separate build step, commit the compiled
   artifact, and have the engine consume the pre-compiled `EffectProgram`. The engine
   becomes a pure interpreter with no parser dependency.

## Decision

Cards are compiled to `EffectProgram` trees **offline** by the `card-compiler` package.
The compiled output is committed to the repository as `packages/card-catalog/data/compiled-catalog.json`.
The engine reads only the compiled artifact — it never imports or calls the card compiler.

## Consequences

- `engine` must not import `card-compiler`. The TypeScript project reference graph encodes this
  constraint: `card-compiler` is absent from `engine/tsconfig.json`'s `references`.
- The CI gate (`just verify-catalog`) validates the committed artifact is up to date and meets
  the parse-rate threshold.
- Cards that the parser cannot handle are covered by a TypeScript fallback registry in
  `card-compiler` — hand-written `EffectProgram` values for the long tail.
- Adding card intelligence (better parsing) never changes the engine or the effect-ir contracts.
