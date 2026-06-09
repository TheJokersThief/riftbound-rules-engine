# ADR-0005: Five-Package Split with TypeScript Project References

**Status:** Accepted  
**Date:** 2026-06-09

## Context

The rules engine has distinct concerns with different deployment requirements and change rates:
wire types (used by servers and clients), effect IR (needed by the compiler only), card data
(potentially updated frequently), card intelligence (complex parsing logic, never deployed to
production), and the runtime engine (the core library).

## Decision

The codebase is split into **five packages**, with dependency direction enforced by TypeScript
project references:

```
protocol     → (none)
effect-ir    → protocol
card-catalog → protocol
card-compiler → effect-ir, card-catalog
engine       → protocol, effect-ir, card-catalog
```

The critical constraint — `engine` must not import `card-compiler` — is expressed by the
absence of a `references` entry. No ESLint plugin or Nx boundary rule is required; the
TypeScript compiler itself enforces it.

## Consequences

- Adding a dependency between packages requires a deliberate change to `tsconfig.json` — the
  dependency direction cannot be accidentally violated.
- The engine never has a transitive dependency on the card parser, keeping it lean and
  deployable without the parser toolchain.
- `protocol` is the shared contract that all consumer code (servers, clients, tests) can
  depend on without pulling in the engine or compiler.
- A sixth package `test-helpers` (scope: test, devDependency only) provides shared test fixtures
  and is not part of the production dependency graph.
