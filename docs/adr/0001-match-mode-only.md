# ADR-0001: Target 1v1 Match as the Only Mode of Play

**Status:** Accepted  
**Date:** 2026-06-09

## Context

Riftbound supports multiple play formats: 1v1 Match (best-of-3), 1v1 Duel (single game),
free-for-all, and 2v2 co-op. Each format has meaningfully different rules around
turn order, scoring, and win conditions.

## Decision

The engine implements the **1v1 Match** format only. All other formats are out of scope
for version one.

## Consequences

- `GameState.playerIds` is always a two-element tuple — three or more players are not representable.
- `MatchState.gameWins` is a `Record<PlayerId, number>` capped at 2 wins.
- `TurnEngine` always advances to the exactly one other player after each turn.
- When other formats become a requirement, `playerIds` and the turn-advancement logic are the primary extension points.
