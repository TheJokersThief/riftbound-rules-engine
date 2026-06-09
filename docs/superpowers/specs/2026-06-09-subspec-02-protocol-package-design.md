# Protocol Package — Design Specification

**Date:** 2026-06-09
**Status:** Approved design, pending implementation plan
**Sub-spec:** #2 of 15 — depends on sub-spec #01 (monorepo & workspace)
**Scope:** `@thejokersthief/riftbound-protocol`. The wire contract package: branded ID primitives, the `Action` discriminated union, the `DecisionRequest` discriminated union, the `GameEvent` discriminated union, and `PlayerView` with its supporting types. All types are derived from Zod schemas. No logic.

---

## 1. Package structure

```
packages/protocol/
├── package.json        ← { "type": "module", dependencies: { "zod": "^4" } }
├── tsconfig.json       ← extends ../../tsconfig.base.json, no references (leaf package)
├── vitest.config.ts
└── src/
    ├── ids.ts          ← branded ID primitives + Zod validators
    ├── actions.ts      ← Action union + ActionSchema
    ├── decisions.ts    ← DecisionRequest union + DecisionRequestSchema
    ├── events.ts       ← GameEvent union + GameEventSchema
    ├── view.ts         ← PlayerView and supporting types + Zod schemas
    └── index.ts        ← re-exports all public types and schemas
```

`zod` is the only runtime dependency. Every other package that needs protocol types imports from `@thejokersthief/riftbound-protocol`; they never depend on `zod` directly for protocol concerns.

---

## 2. Branded ID types (`ids.ts`)

All identifiers are branded strings. The brand is a compile-time-only phantom field — zero runtime cost.

```ts
type Brand<T extends string> = string & { readonly _brand: T }

export type PlayerId      = Brand<'PlayerId'>
export type CardId        = Brand<'CardId'>        // a unique card instance on the board
export type CardDefId     = Brand<'CardDefId'>     // catalog definition key (shared by all copies)
export type ZoneId        = Brand<'ZoneId'>
export type BattlefieldId = Brand<'BattlefieldId'>
export type AbilityId     = Brand<'AbilityId'>
export type DecisionId    = Brand<'DecisionId'>
export type GameId        = Brand<'GameId'>
export type MatchId       = Brand<'MatchId'>
```

`CardId` vs `CardDefId` is a critical distinction: `CardId` identifies a specific instance of a card in play; `CardDefId` is the catalog key shared by every copy of the same card. Conflating them is a common engine bug.

Zod schemas for IDs use a shared constructor:

```ts
const brandedString = <T extends string>() =>
  z.string().transform(s => s as Brand<T>)

export const PlayerIdSchema      = brandedString<'PlayerId'>()
export const CardIdSchema        = brandedString<'CardId'>()
// … one per ID type
```

---

## 3. Action union (`actions.ts`)

All player inputs are variants of a single `Action` discriminated union. Every variant carries `playerId` so the engine can validate the action is from the correct player for the current state.

### Variants

```ts
// Setup phase
{ type: 'ChooseBattlefield';  playerId: PlayerId; cardDefId: CardDefId }   // by definition; CardIds not yet assigned between games
{ type: 'KeepHand';           playerId: PlayerId }
{ type: 'Mulligan';           playerId: PlayerId }

// Turn structure
{ type: 'EndTurn';            playerId: PlayerId }

// Priority window (chain and showdown)
{ type: 'PlayCard';           playerId: PlayerId; cardId: CardId; targets?: TargetSelection }
{ type: 'ActivateAbility';    playerId: PlayerId; sourceId: CardId; abilityIndex: number; targets?: TargetSelection }
{ type: 'PassPriority';       playerId: PlayerId }
{ type: 'PassFocus';          playerId: PlayerId }

// Combat
{ type: 'AssignDamage';       playerId: PlayerId; assignments: DamageAssignment[] }

// Effect decisions (responses to DecisionRequests)
{ type: 'ChooseTargets';      playerId: PlayerId; decisionId: DecisionId; targets: CardId[] }
{ type: 'ChooseYesNo';        playerId: PlayerId; decisionId: DecisionId; choice: boolean }
{ type: 'ChooseOne';          playerId: PlayerId; decisionId: DecisionId; index: number }
```

### Supporting types

```ts
type TargetSelection   = { targets: CardId[] }
type DamageAssignment  = { attackerId: CardId; defenderId: CardId; amount: number }
```

### Key distinction

`PassFocus` is separate from `PassPriority`. Priority governs who may act within the chain; focus governs whose turn it is within a showdown. These are tracked as separate fields in engine state and must not be conflated (core rules 327–348).

### Schema pattern

```ts
export const ActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('PlayCard'), playerId: PlayerIdSchema, cardId: CardIdSchema,
              targets: TargetSelectionSchema.optional() }),
  // … one object schema per variant
])
export type Action = z.infer<typeof ActionSchema>
```

---

## 4. DecisionRequest union (`decisions.ts`)

`DecisionRequest` is returned in the `pending` field of a `submit` result. It tells the consuming server who must act next and what kind of input is required.

### Variants

```ts
// Engine is waiting for this player to act in a chain priority window
{ type: 'PriorityWindow';    playerId: PlayerId }

// Engine is waiting for this player to act in a showdown focus window
{ type: 'FocusWindow';       playerId: PlayerId; battlefieldId: BattlefieldId }

// An effect needs targets chosen
{ type: 'ChooseTargets';     playerId: PlayerId; decisionId: DecisionId;
  prompt: string; min: number; max: number }

// "You may …" — binary decision
{ type: 'ChooseYesNo';       playerId: PlayerId; decisionId: DecisionId;
  prompt: string }

// Choose one of N described options
{ type: 'ChooseOne';         playerId: PlayerId; decisionId: DecisionId;
  options: string[] }

// Assign combat damage across defenders
{ type: 'AssignDamage';      playerId: PlayerId; decisionId: DecisionId;
  attackers: CombatUnit[]; totalDamage: number }

// Setup: which of your three battlefields to keep
{ type: 'ChooseBattlefield'; playerId: PlayerId; options: CardId[] }

// Setup: keep or mulligan opening hand
{ type: 'ChooseMulligan';    playerId: PlayerId; handSize: number }
```

`PriorityWindow` and `FocusWindow` carry no `decisionId` — the legal responses are enumerable via `legalActions()` rather than encoded in the request. All other variants carry a `decisionId` that the answering action echoes back so the engine can match the response to the pending decision.

---

## 5. GameEvent union (`events.ts`)

Events are the immutable record of everything that happened. They fold into engine state and are relayed to clients by the consuming server.

### Variants

```ts
// Lifecycle
{ type: 'GameStarted';        gameId: GameId; playerIds: [PlayerId, PlayerId] }
{ type: 'GameEnded';          gameId: GameId; winner: PlayerId }
{ type: 'MatchEnded';         matchId: MatchId; winner: PlayerId }
{ type: 'TurnStarted';        turnNumber: number; activePlayerId: PlayerId }
{ type: 'TurnEnded';          turnNumber: number; activePlayerId: PlayerId }
{ type: 'PhaseStarted';       phase: Phase }

// Setup
{ type: 'BattlefieldChosen';  playerId: PlayerId; cardId: CardId }
{ type: 'MulliganChosen';     playerId: PlayerId; kept: boolean }

// Chain & showdown
{ type: 'ChainOpened' }
{ type: 'ChainClosed' }
{ type: 'ShowdownOpened';     battlefieldId: BattlefieldId; kind: 'Combat' | 'Control' }
{ type: 'ShowdownClosed';     battlefieldId: BattlefieldId }
{ type: 'PriorityPassed';     playerId: PlayerId }
{ type: 'FocusPassed';        playerId: PlayerId }

// Card movement & zone changes
{ type: 'CardDrawn';          playerId: PlayerId; cardId: CardId | null }  // null = hidden from opponent
{ type: 'CardDiscarded';      playerId: PlayerId; cardId: CardId }
{ type: 'CardPlayed';         playerId: PlayerId; cardId: CardId }
{ type: 'CardMoved';          cardId: CardId; fromZone: ZoneId; toZone: ZoneId }
{ type: 'CardRecalled';       cardId: CardId }
{ type: 'CardReturnedToHand'; cardId: CardId; playerId: PlayerId }
{ type: 'CardCountered';      cardId: CardId }
{ type: 'CardBanished';       cardId: CardId }
{ type: 'TokenCreated';       cardId: CardId; defId: CardDefId; zoneId: ZoneId }
{ type: 'CardRevealed';       cardId: CardId; defId: CardDefId }
{ type: 'CardRecycled';       cardId: CardId; playerId: PlayerId }

// Unit state
{ type: 'CardReadied';        cardId: CardId }
{ type: 'CardExhausted';      cardId: CardId }
{ type: 'CardKilled';         cardId: CardId }
{ type: 'CardBuffed';         cardId: CardId; amount: number }
{ type: 'MightGiven';         cardId: CardId; amount: number }
{ type: 'KeywordGranted';     cardId: CardId; keyword: string }

// Combat & damage
{ type: 'DamageDealt';        sourceId: CardId; targetId: CardId; amount: number; bonus: number }
{ type: 'ControlChanged';     battlefieldId: BattlefieldId; newControllerId: PlayerId }

// Scoring
{ type: 'PointScored';        playerId: PlayerId;
  method: 'Conquer' | 'Hold' | 'Effect';
  battlefieldId: BattlefieldId | null }

// Resources
{ type: 'ResourceAdded';      playerId: PlayerId; energy: number; power: number }
{ type: 'RuneChanneled';      playerId: PlayerId; cardId: CardId }
{ type: 'XPGained';           cardId: CardId; amount: number }
{ type: 'XPSpent';            cardId: CardId; amount: number }
{ type: 'ExtraTurnGranted';   playerId: PlayerId }
```

### Supporting type

`Phase` is a string union: `'Start' | 'Channel' | 'Main' | 'Ending'`

`PointScored.method` includes `'Effect'` for points gained from card effects (not bound by the Winning Point restriction per core rule 466.1.a.1). `battlefieldId` is `null` for Effect-sourced points that do not target a specific battlefield.

---

## 6. PlayerView (`view.ts`)

The redacted projection the server sends to one player. Split into three parts:

```ts
type PlayerView = {
  self:     SelfView
  opponent: OpponentView
  shared:   SharedView
}
```

### `SelfView` — full visibility of the viewing player's own state

```ts
{
  playerId:    PlayerId
  hand:        CardInstanceView[]
  mainDeck:    { count: number }
  runeDeck:    { count: number }
  runePool:    RuneSlotView[]
  legend:      CardInstanceView
  champion:    CardInstanceView
  battlefield: CardInstanceView
  base:        CardInstanceView[]
  resources:   { energy: number; power: number }
  points:      number
}
```

### `OpponentView` — only what the rules permit the opponent to see

```ts
{
  playerId:    PlayerId
  handCount:   number               // count only — identities are hidden
  mainDeck:    { count: number }
  runeDeck:    { count: number }
  runePool:    RuneSlotView[]
  legend:      CardInstanceView
  champion:    CardInstanceView
  battlefield: CardInstanceView
  base:        CardInstanceView[]   // face-up cards only
  resources:   { energy: number; power: number }
  points:      number
}
```

### `SharedView` — state visible to both players

```ts
{
  gameId:          GameId
  matchId:         MatchId
  turnNumber:      number
  activePlayerId:  PlayerId
  phase:           Phase
  chain:           ChainItemView[]
  pendingDecision: DecisionRequest | null
  matchRecord:     { wins: Record<PlayerId, number> }
}
```

### Supporting view types

```ts
// A rune slot in a player's rune pool
type RuneSlotView = { filled: boolean; runeDefId: CardDefId | null }

// An item on the in-progress chain visible to both players
type ChainItemView = { cardId: CardId; defId: CardDefId; controllerId: PlayerId; resolved: boolean }

// A unit participating in combat damage assignment
type CombatUnit = { cardId: CardId; might: number }
```

### `CardInstanceView`

```ts
{
  cardId:    CardId
  defId:     CardDefId | null   // null when hidden (opponent's hand card)
  zone:      ZoneId
  exhausted: boolean
  buffAmount: number
  keywords:  string[]
  counters:  Record<string, number>
  hidden:    boolean            // true = opponent's hand card; defId is null
}
```

Hidden cards in an opponent's hand are sent as `{ cardId, hidden: true, defId: null }` — the instance identity is preserved (for tracking purposes) without revealing the card definition.

---

## 7. Zod schema strategy

Types are derived from schemas throughout — never written by hand:

```ts
// Schema defined first
export const PlayCardActionSchema = z.object({
  type:     z.literal('PlayCard'),
  playerId: PlayerIdSchema,
  cardId:   CardIdSchema,
  targets:  TargetSelectionSchema.optional(),
})

// Type inferred from schema
export type PlayCardAction = z.infer<typeof PlayCardActionSchema>

// Top-level union
export const ActionSchema = z.discriminatedUnion('type', [
  PlayCardActionSchema,
  // …
])
export type Action = z.infer<typeof ActionSchema>
```

### Who calls Zod

| Caller | Purpose |
|---|---|
| Consuming server (inbound) | `ActionSchema.safeParse(rawInput)` — rejects malformed actions at the wire boundary before they reach the engine |
| Consuming server (outbound) | `PlayerViewSchema.safeParse(view)` — validates the `Visibility` module's projection before sending to the client |
| Engine replay / deserialization | `GameEventSchema.parse(raw)` — validates stored events before folding into state |
| Engine itself | Never calls Zod — receives a typed `Action` and validates legality via `legalActions()` |

---

## 8. Out of scope for this sub-spec

- Any logic, validation, or transformation (owned by `@thejokersthief/riftbound-engine`)
- `GameState` internals — `PlayerView` is a projection of state, not state itself
- The `EffectProgram` IR types (owned by `@thejokersthief/riftbound-effect-ir`, sub-spec #3)
- `CardDefinition` types (owned by `@thejokersthief/riftbound-card-catalog`, sub-spec #4)
