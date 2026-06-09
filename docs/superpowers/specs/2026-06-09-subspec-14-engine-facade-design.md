# Engine: Engine Façade — Design Specification

**Date:** 2026-06-09
**Status:** Approved design, pending implementation plan
**Sub-spec:** #14 of 15 — depends on sub-spec #06 (engine game state), sub-spec #07 (rules-query), sub-spec #08 (effect interpreter), sub-spec #09 (chain resolver), sub-spec #10 (combat resolver), sub-spec #11 (turn engine), sub-spec #12 (match engine), sub-spec #13 (visibility)
**Scope:** `src/index.ts` in `@thejokersthief/riftbound-engine`. The single public export surface of the engine package. Defines `DeckConfig`, `createGame`, `submit`, `legalActions`, `serialize`/`deserialize`, and the `viewFor` / `createMatch` / `submitToMatch` / `legalMatchActions` companion exports that delegate to their respective modules.

---

## 1. Module structure

The façade is a single file. All engine modules are internal.

```
packages/engine/src/
├── index.ts     ← everything exported below; imports from internal modules only
└── (internal modules — sub-specs #6–#13)
```

The only public surface is `src/index.ts`. Consumers import from `@thejokersthief/riftbound-engine`; no internal path is stable.

---

## 2. DeckConfig

```ts
type DeckConfig = {
  battlefields: [CardDefId, CardDefId, CardDefId]  // exactly 3 choices
  legend:       CardDefId
  champion:     CardDefId
  mainDeck:     CardDefId[]   // 40–60 cards; validated at createGame
  runeDeck:     CardDefId[]   // exactly 10 rune cards; validated at createGame
}
```

`DeckConfig` is validated by `createGame` on entry. Any violation throws a descriptive error — invalid configs are a caller mistake, not a recoverable runtime condition.

---

## 3. `createGame`

```ts
function createGame(config: {
  players:  readonly [PlayerId, PlayerId]
  decks:    Record<PlayerId, DeckConfig>
  seed:     number
  matchId:  MatchId
}): GameState
```

**Setup flow:**

1. **Validate decks** — check card counts per the DeckConfig constraints. Throw if invalid.
2. **Assign CardIds** — instantiate a `CardInstance` for every card in both decks. Each `CardInstance` gets a unique `CardId` (UUID v4 seeded via the Mulberry32 RNG — the RNG advances once per card).
3. **Shuffle decks** — Fisher-Yates shuffle for each player's `mainDeck` and `runeDeck` arrays using `nextInt` from `rng.ts`.
4. **Determine first player** — coin flip via `nextInt(rng, 2)`. The result is the index into `config.players`.
5. **Deal opening hands** — draw 5 cards from each player's `mainDeck` into `hand`.
6. **Emit `ChooseMulligan` `DecisionRequest`** — for each player simultaneously (both `DecisionRequest`s are queued via the resolution stack). Players choose to keep or replace.
7. **Emit `ChooseBattlefield` `DecisionRequest`** — after mulligan is resolved, prompt each player to choose one battlefield from their three `DeckConfig.battlefields` options.
8. Set `state.status = 'setup'` until both battlefield choices are received; on the second confirmation, transition to `state.status = 'playing'` and emit `TurnStarted` for the first player.

The returned `GameState` always has `pendingDecision` set (either the mulligan or battlefield decision) — `createGame` never returns a state where the game is already `playing` with no pending action.

---

## 4. `submit`

```ts
function submit(
  state:   GameState,
  action:  Action,
  catalog: CardCatalog
): { state: GameState; events: GameEvent[] }
```

**Flow:**

1. **Validate acting player** — confirm `action.playerId` is a valid player in this game. Throw if not.
2. **Legal check** — confirm the action is among `legalActions(state, action.playerId, catalog)`. Throw a descriptive error if not. This is a hard invariant: the server should never submit an illegal action, so a throw is correct.
3. **Construct `RulesQuery`** — `createRulesQuery(state, catalog)` (sub-spec #7). The query is constructed fresh per `submit` call; it is not cached across calls.
4. **Dispatch** — branch on `state.status`:

   - `'setup'`: Handle `KeepHand`, `Mulligan`, and `ChooseBattlefield` actions; the game transitions to `status = 'playing'` once both players have confirmed their mulligan and both have chosen a battlefield.
   - `'playing'`: Dispatch by `action.type`:
     - `PassPriority` / `PassFocus` → `ChainResolver.advance()`
     - `PlayCard`, `ActivateAbility` → validate timing + resources via `RulesQuery`, push `EffectFrame`, call `ChainResolver.advance()`
     - `ChooseTargets`, `ChooseYesNo`, `ChooseOne`, `AssignDamage` → pop `DecisionFrame`, restore suspended frame, continue execution via interpreter or combat resolver
     - `EndTurn` → `TurnEngine.advanceTurn()`
   - `'ended'`: Throw — no actions are legal once the game is over.

5. **Collect events** — every internal function call returns `{ state, events }`. Thread state through the call chain; accumulate all events in order.
6. **Return** `{ state, events }`.

---

## 5. `legalActions`

```ts
function legalActions(
  state:    GameState,
  playerId: PlayerId,
  catalog:  CardCatalog
): Action[]
```

**Two branches:**

### Branch A — `state.pendingDecision !== null`

The game is waiting for a specific player to respond to a `DecisionRequest`. Only the player named in `pendingDecision.playerId` may act.

- If `playerId !== pendingDecision.playerId`: return `[]`.
- Otherwise, enumerate valid answers for each `DecisionRequest` type:

  | DecisionRequest type | Legal actions |
  |---|---|
  | `PriorityWindow` | One `PassPriority`, plus all `PlayCard` / `ActivateAbility` the player can afford |
  | `FocusWindow` | One `PassFocus`, plus all `PlayCard` / `ActivateAbility` the player can afford |
  | `ChooseTargets` | One `ChooseTargets` per valid target combination (constrained to `DecisionRequest.validTargets`) |
  | `ChooseYesNo` | `ChooseYesNo { choice: true }`, `ChooseYesNo { choice: false }` |
  | `ChooseOne` | One `ChooseOne` per option index in `DecisionRequest.options` |
  | `AssignDamage` | All valid `AssignDamage` assignments satisfying the lethal-first constraint |
  | `ChooseBattlefield` | One `ChooseBattlefield` per entry in `DecisionRequest.available` |
  | `ChooseMulligan` | `KeepHand`, `Mulligan` |

### Branch B — `state.pendingDecision === null`

Enumerate proactive moves available to the active player. Only the active player (`state.activePlayerId`) may act; return `[]` if `playerId !== state.activePlayerId`.

- **`PlayCard`** — for each card in `hand`:
  - `RulesQuery.canBePlayed(cardId)` must return true (timing + resources check)
  - If the card has the `Unique` keyword: no copy of the same `defId` may already be in play for this player
- **`ActivateAbility`** — for each card the player controls with an activatable ability:
  - Ability must not be exhausted; resources must be sufficient
- **`PassPriority`** — always legal during the active player's main phase when the chain is closed
- **`EndTurn`** — legal when the chain is closed and no `pendingDecision` is set

---

## 6. Serialization

Defined in sub-spec #6 and re-exported from the façade:

```ts
function serialize(state: GameState): string
function deserialize(s: string): GameState
```

The façade also exposes `MatchState` serialization via the same pattern, delegating to `MatchEngine`.

---

## 7. Match companions

Thin re-exports from `MatchEngine` (sub-spec #12):

```ts
export { createMatch, submitToMatch, legalMatchActions, viewForMatch } from './match/index.js'
```

`viewForMatch` delegates to `viewFor` (sub-spec #13) with `matchState.currentGame`.

---

## 8. Out of scope for this sub-spec

- Any resolver, interpreter, or engine module logic — owned by sub-specs #7–#13
- `MatchState` type and match lifecycle — owned by sub-spec #12
- `PlayerView` projection logic — owned by sub-spec #13
