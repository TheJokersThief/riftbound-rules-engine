# ADR-0002: Event-Sourced Reducer with Explicit Resolution Stack

**Status:** Accepted  
**Date:** 2026-06-09

## Context

TCG resolution involves deeply nested, suspendable, multi-step computations: effects that
pause mid-execution to ask for player input, chains that interleave multiple players' actions,
and combat steps that suspend for damage assignment. Several implementation strategies exist:

1. **Coroutines / async generators** — natural fit for suspendable computation, but JS generators
   do not serialize. Saving and restoring a generator across a network round-trip is not possible.
2. **Callback / continuation-passing style** — workable but leads to deeply nested, hard-to-debug code.
3. **Explicit resolution stack** — serializable tagged-union stack frames that represent the
   computation state at every pause point. Verbose but transparent and fully serializable.

## Decision

Use an **event-sourced reducer** with an **explicit serializable resolution stack**.

- `fold(state, event): GameState` is the single state-update function.
- `submit(state, action, catalog): { state, events }` is the single action-processing function.
- `GameState.resolutionStack: StackFrame[]` replaces the live call stack.
- `GameState.pendingDecision: DecisionRequest | null` signals that `submit` is blocked on input.

## Consequences

- `GameState` is a plain serializable object — `JSON.stringify` / `JSON.parse` round-trips losslessly.
- Determinism is guaranteed: same seed + same action log → byte-identical final state.
- The resolution stack is explicit and inspectable — debugging is straightforward.
- More verbose than coroutines: every suspension point requires a named `StackFrame` type.
- The consuming server only needs to store `initialState + orderedActions` to reconstruct any game state.
