# ADR-0003: Player-Choice Battlefield Selection as the Default

**Status:** Accepted  
**Date:** 2026-06-09

## Context

Each game requires one Battlefield from each player's three-card Battlefield choices. The
selection can happen by player decision (strategic) or random draw (symmetric fairness).

## Decision

**Player choice** is the default. Each player submits a `ChooseBattlefield` action from their
three available battlefields, filtered to exclude any they already used in this Match.

Random selection is available as an option via the seeded RNG, but is not the default path
through `createGame`.

## Consequences

- `DeckConfig.battlefields` is always a three-element tuple of `CardDefId`.
- `ChooseBattlefield` is a valid `Action` type and corresponding `DecisionRequest` type.
- `MatchState.usedBattlefields` tracks which battlefields each player has already used,
  so between-game prompts correctly filter the available pool.
- Implementing random selection later requires passing a `selectionMode` option to `createGame`.
