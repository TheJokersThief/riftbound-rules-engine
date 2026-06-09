# Engine: Game State & Event Log — Design Specification

**Date:** 2026-06-09
**Status:** Approved design, pending implementation plan
**Sub-spec:** #6 of 15 — depends on sub-spec #01 (monorepo & workspace), sub-spec #02 (protocol), sub-spec #03 (effect-ir), sub-spec #04 (card-catalog)
**Scope:** The foundational layer of `@thejokersthief/riftbound-engine`. Defines `GameState` and all its constituent types, the event fold mechanism, the resolution stack frame types, the seeded RNG, and serialization. Sub-specs #7–#14 all depend on this foundation.

---

## 1. Engine package structure

All engine modules live in a single package. No further package splits — the modules are tightly coupled at runtime and there are no stable seams that justify separation.

```
packages/engine/
├── package.json        ← depends on protocol, effect-ir, card-catalog
├── tsconfig.json       ← references: [../protocol, ../effect-ir, ../card-catalog]
├── vitest.config.ts
└── src/
    ├── state/          ← GameState, CardInstance, event fold, stack frames (this sub-spec)
    │   ├── types.ts    ← all GameState constituent types + Zod schemas
    │   ├── fold.ts     ← fold(state, event): GameState
    │   └── stack.ts    ← StackFrame tagged union
    ├── rng.ts          ← Mulberry32 inline RNG
    ├── rules-query/    ← sub-spec #7
    ├── interpreter/    ← sub-spec #8
    ├── chain/          ← sub-spec #9
    ├── combat/         ← sub-spec #10
    ├── turn/           ← sub-spec #11
    ├── match/          ← sub-spec #12
    ├── visibility/     ← sub-spec #13
    └── index.ts        ← Engine façade (sub-spec #14)
```

### Architectural invariants (apply to all sub-specs #6–#14)

- **Immutable plain objects.** State is never mutated in place. Every update returns a new `GameState` via structural sharing (`{ ...state, field: newValue }`).
- **Pure functions.** Every module is a set of pure functions taking `GameState` and returning `{ state: GameState; events: GameEvent[] }`. No module holds references to other modules — composition happens in the Engine façade and `ChainResolver`.
- **Fold immediately.** Each emitted `GameEvent` is folded into state the moment it is produced. Resolvers never query stale state.
- **No event log in state.** `GameState` is the current snapshot only. The consuming server maintains its own append-only event store. The full game history is `initialState + orderedActions`.

---

## 2. GameState shape (`state/types.ts`)

```ts
type GameState = {
  gameId:    GameId
  matchId:   MatchId
  playerIds: readonly [PlayerId, PlayerId]  // [first player, second player]

  // All card instances across all zones, keyed by CardId
  cards:     Record<CardId, CardInstance>

  // Per-player zone and resource state
  players:   Record<PlayerId, PlayerState>

  // The two active battlefields
  battlefields: Record<BattlefieldId, BattlefieldState>

  // Turn structure
  turnNumber:     number
  activePlayerId: PlayerId
  phase:          Phase

  // Resolution
  chain:           ChainState
  resolutionStack: StackFrame[]
  pendingDecision: DecisionRequest | null

  // Seeded RNG — single 32-bit integer for Mulberry32
  rng: { seed: number }

  // Per-turn scoring tracker — reset at each cleanup
  scoredThisTurn: Record<PlayerId, BattlefieldId[]>

  // Game lifecycle
  status: 'setup' | 'playing' | 'ended'
  winner: PlayerId | null

  // Added by sub-spec #09 (ChainResolver)
  hotQueue: TriggeredAbilityTask[]

  // Added by sub-spec #11 (TurnEngine)
  holdEligible:          BattlefieldId[]
  firstTurnSecondPlayer: boolean
}
```

### PlayerState

```ts
type PlayerState = {
  hand:         CardId[]
  mainDeck:     CardId[]    // ordered top → bottom
  runeDeck:     CardId[]    // ordered top → bottom
  runePool:     RuneSlot[]
  legendZone:   CardId
  championZone: CardId
  base:         CardId[]    // units and gear stationed at this player's base
  resources:    { energy: number; power: number }
  points:       number
}

type RuneSlot = { filled: boolean; runeCardId: CardId | null }
```

### CardInstance

```ts
type CardInstance = {
  id:         CardId
  defId:      CardDefId
  ownerId:    PlayerId
  exhausted:  boolean
  buffAmount: number       // net might delta from Buff/GiveMight actions
  keywords:   string[]     // granted keywords beyond the card definition's inherent list
  xp:         number
  counters:   Record<string, number>
  faceDown:   boolean      // true for Hidden cards before reveal
}
```

### BattlefieldState

```ts
type BattlefieldState = {
  id:           BattlefieldId
  cardId:       CardId
  controllerId: PlayerId | null   // null = uncontested / neutral
  units:        CardId[]          // units from either player stationed here
}
```

### ChainState

```ts
type ChainState = {
  isOpen:   boolean
  items:    ChainItem[]
  priority: PlayerId | null   // who may act in the chain
  focus:    PlayerId | null   // who may act in the current showdown
  showdown: ShowdownState | null
}

type ChainItem = {
  id:          string           // unique within the chain
  sourceId:    CardId
  defId:       CardDefId
  controller:  PlayerId
  targets:     CardId[]
  resolved:    boolean
}

type ShowdownState = {
  battlefieldId: BattlefieldId
  kind:          'Combat' | 'Control'
}
```

`priority` and `focus` are separate fields. Conflating them is the classic engine bug the master spec explicitly warns against (core rules 327–348).

---

## 3. Event fold mechanism (`state/fold.ts`)

A single pure function applies one `GameEvent` to `GameState` and returns the next state:

```ts
function fold(state: GameState, event: GameEvent): GameState
```

`fold` is a switch over `GameEvent['type']`. Every case performs an immutable update via structural sharing:

```ts
case 'CardExhausted':
  return {
    ...state,
    cards: {
      ...state.cards,
      [event.cardId]: { ...state.cards[event.cardId], exhausted: true }
    }
  }
```

`fold` is the **only** place state is updated. All other engine code is read-only against `GameState`. Every state transition for every event is auditable in one file.

### Event accumulation pattern

Resolvers thread an `events: GameEvent[]` array through their call chain, appending as they go:

```ts
function applyDamage(
  state: GameState, sourceId: CardId, targetId: CardId, amount: number
): { state: GameState; events: GameEvent[] } {
  const event: GameEvent = { type: 'DamageDealt', sourceId, targetId, amount, bonus: 0 }
  return { state: fold(state, event), events: [event] }
}
```

The façade collects the full event list and returns it alongside the final state. Events are never re-ordered or dropped.

---

## 4. Resolution stack (`state/stack.ts`)

```ts
type StackFrame =
  | EffectFrame
  | ChainFrame
  | CombatFrame
  | DecisionFrame

// An effect program mid-execution
type EffectFrame = {
  type:       'Effect'
  sourceId:   CardId
  controller: PlayerId
  remaining:  EffectNode[]    // nodes not yet executed; head is next
  targets:    CardId[]        // resolved targets for this effect context
}

// The FEPR loop at a specific step
type ChainFrame = {
  type:     'Chain'
  resumeAt: 'Finalize' | 'Execute' | 'Pass' | 'Resolve'
}

// Combat mid-step
type CombatFrame = {
  type:          'Combat'
  battlefieldId: BattlefieldId
  step:          'Showdown' | 'Damage' | 'Resolution'
  assignments:   DamageAssignment[] | null  // null until Damage step
}

// Suspended awaiting a player decision
type DecisionFrame = {
  type:        'Decision'
  decisionId:  DecisionId
  resumeFrame: EffectFrame | ChainFrame | CombatFrame
}
```

The interpreter always examines `resolutionStack[resolutionStack.length - 1]` (the top frame). Pushing a frame suspends the current computation; popping resumes the one below.

`EffectFrame.remaining` is the tail of an `EffectNode[]` sequence still to execute. When `remaining` is empty the frame pops. This is how a multi-step `Sequence` survives a mid-effect `DecisionRequest`.

---

## 5. Seeded RNG (`rng.ts`)

Mulberry32 implemented inline — no external dependency:

```ts
function nextRng(state: { seed: number }): { value: number; next: { seed: number } } {
  let t = (state.seed + 0x6d2b79f5) | 0
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296
  return { value, next: { seed: t } }
}

function nextInt(
  state: { seed: number }, max: number
): { value: number; next: { seed: number } } {
  const { value, next } = nextRng(state)
  return { value: Math.floor(value * max), next }
}
```

Callers always replace `state.rng` with the returned `next` — the seed advances immutably. Fisher-Yates shuffle built on `nextInt` is used for: deck shuffles, turn-order determination, and random battlefield selection.

---

## 6. Serialization

`GameState` contains only primitives, arrays, and records — no `Map`, `Set`, `Date`, or class instances. Serialization is a direct `JSON.stringify` / `JSON.parse` round-trip:

```ts
function serialize(state: GameState): string {
  return JSON.stringify(state)
}

function deserialize(s: string): GameState {
  return GameStateSchema.parse(JSON.parse(s))
}
```

`GameStateSchema` is a Zod schema that validates the deserialized object. Branded types (`CardId`, `PlayerId`, etc.) survive as plain strings and are re-branded by the schema on deserialization.

The determinism invariant — same seed + same action log → byte-identical `serialize(state)` output — is the primary integration test for the engine (sub-spec #15).

---

## 7. Out of scope for this sub-spec

- Any resolver or interpreter logic (sub-specs #7–#12)
- `createGame` / setup state construction (sub-spec #14, Engine façade)
- `PlayerView` projection (sub-spec #13, Visibility)
- `legalActions` computation (sub-spec #14, Engine façade)
