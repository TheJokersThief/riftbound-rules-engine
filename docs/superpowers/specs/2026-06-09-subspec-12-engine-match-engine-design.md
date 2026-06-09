# Engine: Match Engine — Design Specification

**Date:** 2026-06-09
**Status:** Approved design, pending implementation plan
**Sub-spec:** #12 of 15 — depends on sub-spec #06 (engine game state), sub-spec #11 (turn engine), sub-spec #14 (engine façade, for createGame)
**Scope:** The `match/` module within `@thejokersthief/riftbound-engine`. A thin best-of-3 orchestrator over the game engine. Tracks game wins, records used battlefields, prompts between-game battlefield selection, and detects match completion.

---

## 1. Module structure

```
packages/engine/src/match/
├── index.ts     ← createMatch, submitToMatch, legalMatchActions, viewForMatch
└── state.ts     ← MatchState type
```

---

## 2. MatchState (`state.ts`)

```ts
type MatchState = {
  matchId:          MatchId
  playerIds:        readonly [PlayerId, PlayerId]
  decks:            Record<PlayerId, DeckConfig>    // original deck configs for game resets; DeckConfig defined in sub-spec #14
  gameWins:         Record<PlayerId, number>
  usedBattlefields: Record<PlayerId, CardDefId[]>  // appended after each game ends
  currentGame:      GameState
  status:           'playing' | 'ended'
  winner:           PlayerId | null
}
```

`MatchState` embeds the current `GameState` directly. The match is the top-level serialization unit for the consuming server: `serialize`/`deserialize` operate on `MatchState`, not `GameState` directly.

---

## 3. Public interface (`index.ts`)

```ts
function createMatch(config: {
  players:   readonly [PlayerId, PlayerId]
  decks:     Record<PlayerId, DeckConfig>
  seed:      number
}): MatchState

function submitToMatch(
  matchState: MatchState,
  action:     Action
): { matchState: MatchState; events: GameEvent[] }

function legalMatchActions(matchState: MatchState, playerId: PlayerId): Action[]

function viewForMatch(matchState: MatchState, playerId: PlayerId): PlayerView
```

`submitToMatch` delegates to `submit(matchState.currentGame, action)`. After each submit it checks `matchState.currentGame.status` and handles game-end if needed. `legalMatchActions` and `viewForMatch` are thin delegates to the game engine's `legalActions` and `viewFor`.

---

## 4. Match lifecycle

### Game start

`createMatch` initialises `MatchState` with zero game wins, empty `usedBattlefields`, and calls `createGame` to start game 1. The first `ChooseBattlefield` decisions are handled inside the game setup flow.

### Game end detection

On each `submitToMatch` call, after delegating to the game engine:

```
if matchState.currentGame.status === 'ended':
  → handleGameEnd(matchState, winner)
```

### Between-game handling (`handleGameEnd`)

1. Record win: `gameWins[winner] += 1`
2. Append used battlefields: `usedBattlefields[playerId].push(battlefieldUsed)` for each player
3. **Match win check**: if `gameWins[winner] >= 2`:
   - Emit `MatchEnded { matchId, winner }`
   - Set `matchState.status = 'ended'`, `matchState.winner = winner`
   - Return — no new game started
4. **Continue**: prompt each player to choose a new battlefield via `ChooseBattlefield` `DecisionRequest`, filtered to `allBattlefields[playerId] \ usedBattlefields[playerId]` (core rules 481.5–6)
5. Once both choices received: call `createGame` with the new selections and a fresh seed = `originalSeed + gameCount`. Set `matchState.currentGame` to the new `GameState`

Between-game battlefield choices flow through `submitToMatch` as `ChooseBattlefield` actions — the same action type used during game setup, validated against each player's remaining available battlefields.

---

## 5. Out of scope for this sub-spec

- Game setup and `createGame` — owned by the Engine façade (sub-spec #14)
- Serialization of `MatchState` — same `serialize`/`deserialize` pattern as `GameState`; handled by sub-spec #14
- Visibility projection — `viewForMatch` delegates to sub-spec #13 (`Visibility`)
