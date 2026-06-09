# Engine: Turn Engine — Design Specification

**Date:** 2026-06-09
**Status:** Approved design, pending implementation plan
**Sub-spec:** #11 of 15 — depends on sub-spec #06 (engine game state), sub-spec #07 (rules-query), sub-spec #09 (chain resolver)
**Scope:** The `turn/` module within `@thejokersthief/riftbound-engine`. Drives the phase machine (Start → Channel → Main → Ending), runs the Hold/Conquer scoring predicate with the Winning Point guard, and checks the win condition at cleanup.

---

## 1. GameState amendments

Sub-spec #6 (`GameState`) must be extended with:

```ts
holdEligible:          BattlefieldId[]  // battlefields active player controlled at start of Beginning Phase
firstTurnSecondPlayer: boolean           // true until the second player's first Channel Phase
```

---

## 2. Module structure

```
packages/engine/src/turn/
├── index.ts     ← advanceTurn(state, query, catalog): { state, events }
├── phases.ts    ← phase machine: Start, Channel, Main, Ending transitions
├── scoring.ts   ← Hold/Conquer predicate, Winning Point guard
└── cleanup.ts   ← cleanup steps, per-turn reset, win condition check
```

`advanceTurn` is called by the Engine façade when the active player signals end-of-turn and no chain is open. Returns `{ state, events }`.

---

## 3. Phase machine (`phases.ts`)

Phases transition in fixed order: `Start → Channel → Main → Ending`. Each transition emits `PhaseStarted` and runs the phase's entry actions.

### Start phase

1. Emit `TurnStarted`
2. Snapshot `holdEligible`: record all battlefields currently controlled by the active player
3. Ready all exhausted cards the active player controls; emit `CardReadied` per card

### Channel phase

1. Active player channels runes from their Rune Deck into their Rune Pool
2. If `state.firstTurnSecondPlayer` is true: channel an extra rune (core rule 481.7); set `state.firstTurnSecondPlayer = false`
3. Emit `RuneChanneled` per rune channeled

### Main phase

1. Active player plays cards, activates abilities, and triggers chains
2. `ChainResolver.advance()` runs on each submitted action
3. Ends when the active player submits an end-turn action and no chain is open

### Ending phase

1. Run cleanup (section 5)
2. Advance `state.activePlayerId` to the other player
3. Emit `TurnEnded`
4. Increment `state.turnNumber`

---

## 4. Scoring predicate (`scoring.ts`)

```ts
function checkScoring(
  state:    GameState,
  playerId: PlayerId,
  query:    RulesQuery
): { state: GameState; events: GameEvent[] }
```

### Two scoring paths (core rule 464)

**Hold** — for each battlefield in `state.holdEligible` that the player still controls at cleanup: attempt a Hold point (core rule 464.2).

**Conquer** — for each battlefield gained via `ControlChanged` this turn (tracked in `state.scoredThisTurn[playerId]`) that was not already scored via Hold: attempt a Conquer point (core rule 464.1).

### Winning Point guard (core rule 466.1.b)

Applied when `player.points >= 7`:

```ts
function attemptScore(
  state:         GameState,
  playerId:      PlayerId,
  method:        'Hold' | 'Conquer',
  battlefieldId: BattlefieldId
): { state: GameState; events: GameEvent[] }
```

| Method | Player points | Condition | Result |
|---|---|---|---|
| `Hold` | any | — | Score the point |
| `Conquer` | < 7 | — | Score the point |
| `Conquer` | ≥ 7 | Every battlefield scored this turn | Score the point |
| `Conquer` | ≥ 7 | Not every battlefield scored this turn | Draw a card instead |

"Every battlefield scored this turn" means all entries in `Object.keys(state.battlefields)` appear in `state.scoredThisTurn[playerId]` (by either Hold or Conquer).

### Effect-sourced points

Points from card effects (`method: 'Effect'`) call `emitPoint` directly and bypass the Winning Point guard entirely (core rule 466.1.a.1). `PointScored` is emitted with `method: 'Effect'` so clients can distinguish the three paths.

---

## 5. Cleanup (`cleanup.ts`)

Runs at the start of the Ending phase, before turn advancement.

**Steps in order:**

1. Run `checkScoring` for the active player
2. Drain any HOT queue tasks that fired during scoring (e.g. `WhenConquer`, `WhenHold` triggers) via `ChainResolver`
3. Check win condition
4. Reset per-turn fields:
   - Clear `state.scoredThisTurn[activePlayerId]`
   - Clear `state.holdEligible`
5. Discard to hand size if applicable
6. Remove temporary effects lasting "until end of turn"

### Win condition (core rules 323.1 and 467)

A player wins when, at the end of cleanup, `points >= 8` **and** strictly more points than the opponent:

```ts
function checkWinCondition(state: GameState): GameState {
  const [p1, p2]   = state.playerIds
  const pts1       = state.players[p1].points
  const pts2       = state.players[p2].points
  const victoryScore = 8

  if (pts1 >= victoryScore && pts1 > pts2)
    return fold(state, { type: 'GameEnded', gameId: state.gameId, winner: p1 })
  if (pts2 >= victoryScore && pts2 > pts1)
    return fold(state, { type: 'GameEnded', gameId: state.gameId, winner: p2 })
  return state
}
```

If both players reach 8+ simultaneously (via tied Effect-sourced points), neither wins — the game continues until one pulls ahead. `state.status` is set to `'ended'` and `state.winner` populated when `GameEnded` is folded.

---

## 6. Out of scope for this sub-spec

- Match-level game-win tracking — owned by `MatchEngine` (sub-spec #12)
- Mulligan and setup — owned by the Engine façade (sub-spec #14)
- Rune pool mechanics beyond Channel Phase — covered by the Effect Interpreter (sub-spec #8)
