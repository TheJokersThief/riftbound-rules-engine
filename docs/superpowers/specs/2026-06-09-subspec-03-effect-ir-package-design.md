# Effect IR Package — Design Specification

**Date:** 2026-06-09
**Status:** Approved design, pending implementation plan
**Sub-spec:** #3 of 15 — depends on sub-spec #01 (monorepo & workspace), sub-spec #02 (protocol package)
**Scope:** `@thejokersthief/riftbound-effect-ir`. The typed intermediate representation that the card compiler produces and the engine consumes. Contains `EffectProgram` node-tree types and their Zod schemas. No logic; no interpreter implementation.

---

## 1. Package structure

```
packages/effect-ir/
├── package.json        ← { "type": "module", dependencies: { "zod": "^4", "@thejokersthief/riftbound-protocol": "workspace:*" } }
├── tsconfig.json       ← extends ../../tsconfig.base.json, references: [../protocol]
├── vitest.config.ts
└── src/
    ├── primitives.ts   ← PlayerRef, ZoneRef, NumberExpr, AbilityTiming, Phase, LayerNumber
    ├── program.ts      ← EffectProgram, EffectNode tree (Sequence, Optional, ChooseOne, Conditional, ForEach)
    ├── abilities.ts    ← AbilityNode: Triggered, Activated, Static
    ├── actions.ts      ← ActionNode union (the imperative verbs)
    ├── selectors.ts    ← SelectorNode, LocationFilter, FilterNode, Quantity
    ├── conditions.ts   ← ConditionNode predicate tree
    ├── costs.ts        ← CostNode, RuneSymbol, TriggerEvent, ModificationNode
    └── index.ts        ← re-exports everything
```

`CardDefId` and shared ID types are imported from `@thejokersthief/riftbound-protocol`. This makes `protocol` a dependency of `effect-ir`, updating the master package graph (see section 9).

---

## 2. EffectProgram and the EffectNode tree (`program.ts`)

An `EffectProgram` is a card's complete compiled behaviour:

```ts
type EffectProgram =
  | { type: 'Compiled'; abilities: AbilityNode[] }
  | { type: 'Unparsed' }
```

`Unparsed` signals that the parser could not handle the card. The engine refuses to load a card whose program is `Unparsed` with no `FallbackRegistry` entry.

**EffectNode** — the composable tree the interpreter walks:

```ts
type EffectNode =
  | ActionNode
  | { type: 'Sequence';    effects: EffectNode[] }
  | { type: 'Optional';    effect: EffectNode; prompt?: string }
  | { type: 'ChooseOne';   options: EffectNode[] }
  | { type: 'Conditional'; condition: ConditionNode; then: EffectNode; else?: EffectNode }
  | { type: 'ForEach';     selector: SelectorNode; effect: EffectNode }
```

- `Sequence` — multi-sentence card text: "Deal 2 damage. Draw a card." → `Sequence([Deal(...), Draw(...)])`
- `Optional` — "you may …" — emits a `ChooseYesNo` DecisionRequest; effect executes only on `true`
- `ChooseOne` — "choose one —" — emits a `ChooseOne` DecisionRequest; executes the chosen branch
- `ForEach` — "for each friendly unit, …" — resolves the selector, applies effect to each result
- `Conditional` — "if condition, then …" — evaluated against current state; no player input

---

## 3. AbilityNode family (`abilities.ts`)

```ts
type AbilityNode =
  | TriggeredAbility
  | ActivatedAbility
  | StaticAbility

type TriggeredAbility = {
  type:       'Triggered'
  event:      TriggerEvent
  condition?: ConditionNode
  effect:     EffectNode
}

type ActivatedAbility = {
  type:   'Activated'
  cost:   CostNode[]
  timing: AbilityTiming
  effect: EffectNode
}

type StaticAbility = {
  type:         'Static'
  layer:        LayerNumber
  modification: ModificationNode
}
```

`LayerNumber` (`1 | 2 | 3 | 4 | 5`) determines application order in the layers system (core rules 468–475). `TriggerEvent`, `CostNode`, `AbilityTiming`, `ModificationNode` are defined in `costs.ts` and `primitives.ts`.

---

## 4. ActionNode union (`actions.ts`)

The atomic imperative verbs. Each maps to one or more `GameEvent`s when the interpreter executes it:

```ts
type ActionNode =
  | { type: 'Deal';         targets: SelectorNode; amount: NumberExpr; bonus?: NumberExpr }
  | { type: 'Draw';         player: PlayerRef;     count: NumberExpr }
  | { type: 'Discard';      targets: SelectorNode }
  | { type: 'Move';         targets: SelectorNode; toZone: ZoneRef }
  | { type: 'Recall';       targets: SelectorNode }
  | { type: 'ReturnToHand'; targets: SelectorNode }
  | { type: 'Buff';         targets: SelectorNode; amount: NumberExpr }
  | { type: 'Ready';        targets: SelectorNode }
  | { type: 'Exhaust';      targets: SelectorNode }
  | { type: 'Kill';         targets: SelectorNode }
  | { type: 'Banish';       targets: SelectorNode }
  | { type: 'CreateToken';  defId: CardDefId;      zone: ZoneRef; count: NumberExpr }
  | { type: 'Counter';      targets: SelectorNode }
  | { type: 'AddResource';  player: PlayerRef;     energy: NumberExpr; power: NumberExpr }
  | { type: 'GainXP';       targets: SelectorNode; amount: NumberExpr }
  | { type: 'SpendXP';      targets: SelectorNode; amount: NumberExpr }
  | { type: 'Reveal';       targets: SelectorNode }
  | { type: 'Recycle';      targets: SelectorNode }
  | { type: 'GiveMight';    targets: SelectorNode; amount: NumberExpr }
  | { type: 'GrantKeyword'; targets: SelectorNode; keyword: string }
  | { type: 'TakeExtraTurn'; player: PlayerRef }
```

`CardDefId` is imported from `@thejokersthief/riftbound-protocol`.

---

## 5. SelectorNode (`selectors.ts`)

The typed target query the interpreter resolves against current game state:

```ts
type SelectorNode = {
  scope:      'Friendly' | 'Enemy' | 'Any'
  objectType: 'Unit' | 'Gear' | 'Spell' | 'Card' | 'Player'
  location:   LocationFilter
  filters:    FilterNode[]
  quantity:   Quantity
  chooser:    'You' | 'Opponent' | 'Controller' | 'None'
}

type LocationFilter =
  | { type: 'Here' }
  | { type: 'AtBattlefields' }
  | { type: 'AtBase' }
  | { type: 'InHand' }
  | { type: 'TopOfDeck'; count: number }

type FilterNode =
  | { type: 'MightLE';    value: number }
  | { type: 'MightGE';    value: number }
  | { type: 'IsReady' }
  | { type: 'IsExhausted' }
  | { type: 'IsBuffed' }
  | { type: 'HasKeyword'; keyword: string }
  | { type: 'Named';      name: string }
  | { type: 'IsThis' }

type Quantity =
  | { type: 'One' }
  | { type: 'All' }
  | { type: 'UpTo';    count: number }
  | { type: 'Exactly'; count: number }
```

- `chooser: 'None'` — selector resolves automatically (used with `All` or any non-choice case)
- `chooser: 'Controller'` — controller of the card bearing this ability; used for tokens and copied abilities
- `chooser: 'IsThis'` filter — self-reference: the card that holds this ability

When `chooser` is not `'None'` and `quantity` is not `All`, the interpreter emits a `ChooseTargets` DecisionRequest and suspends.

---

## 6. ConditionNode (`conditions.ts`)

A composable predicate tree evaluated against current state. No player input required.

```ts
type ConditionNode =
  // Combinators
  | { type: 'And'; conditions: ConditionNode[] }
  | { type: 'Or';  conditions: ConditionNode[] }
  | { type: 'Not'; condition:  ConditionNode }

  // Leaf predicates
  | { type: 'SelectorNonEmpty';    selector: SelectorNode }
  | { type: 'CardIsBuffed';        selector: SelectorNode }
  | { type: 'CardHasKeyword';      selector: SelectorNode; keyword: string }
  | { type: 'ControlsBattlefield'; player: PlayerRef }
  | { type: 'PlayerHasPoints';     player: PlayerRef; atLeast: number }
  | { type: 'IsPhase';             phase: Phase }
  | { type: 'IsMyTurn' }
```

`SelectorNonEmpty` covers the large class of "if there is a ready enemy unit here" conditions: resolve the selector, check result count ≥ 1. New leaf predicates are added as new card-text patterns require them; the combinators are closed.

---

## 7. CostNode and supporting types (`costs.ts`, `primitives.ts`)

### CostNode (`costs.ts`)

```ts
type CostNode =
  | { type: 'Energy';         amount: number }
  | { type: 'Power';          amount: number }
  | { type: 'Rune';           symbols: RuneSymbol[] }
  | { type: 'Exhaust' }
  | { type: 'Sacrifice';      targets: SelectorNode }
  | { type: 'Discard';        targets: SelectorNode }
  | { type: 'SpendXP';        amount: number }
  | { type: 'AdditionalCost'; cost: CostNode }

type RuneSymbol = 'action' | 'reaction' | 'any'
```

`RuneSymbol` expands as the full rune catalogue is mapped from the `:rb_*:` token set in card text.

### TriggerEvent (`costs.ts`)

```ts
type TriggerEvent =
  | { type: 'WhenPlayed' }
  | { type: 'WhenAttacks' }
  | { type: 'WhenDealtDamage' }
  | { type: 'WhenKilled' }
  | { type: 'WhenFriendlyDies'; filter?: FilterNode[] }
  | { type: 'WhenEnemyDies';   filter?: FilterNode[] }
  | { type: 'WhenChanneled' }
  | { type: 'AtStartOfTurn' }
  | { type: 'AtEndOfTurn' }
  | { type: 'WhenEntersPlay';  scope: 'Friendly' | 'Enemy' | 'Any'; filter?: FilterNode[] }
  | { type: 'WhenConquer' }
  | { type: 'WhenHold' }
```

### ModificationNode (`costs.ts`)

The continuous modification a `StaticAbility` applies through the layers system:

```ts
type ModificationNode =
  | { type: 'ModifyMight';       targets: SelectorNode; amount: number }
  | { type: 'AddKeyword';        targets: SelectorNode; keyword: string }
  | { type: 'GrantAbility';      targets: SelectorNode; ability: AbilityNode }
  | { type: 'ModifySpellDamage'; player: PlayerRef; amount: number }
  | { type: 'PreventDamage';     targets: SelectorNode }
```

### Primitives (`primitives.ts`)

```ts
type NumberExpr =
  | number
  | { type: 'MightOf'; target: SelectorNode }
  | { type: 'CountOf'; selector: SelectorNode }

type PlayerRef     = 'You' | 'Opponent' | 'Controller' | 'NonController'
type ZoneRef       = 'Hand' | 'MainDeck' | 'RuneDeck' | 'Base' | 'BattlefieldZone'
type AbilityTiming = 'Chain' | 'Showdown' | 'Anytime' | 'YourTurn'
type LayerNumber   = 1 | 2 | 3 | 4 | 5
// Phase is re-exported from @thejokersthief/riftbound-protocol — not redefined here
```

---

## 8. Zod schema strategy

Same schema-first pattern as the protocol package. All types are derived via `z.infer<>` — never written by hand.

The recursive `EffectNode` and `ConditionNode` trees require lazy schemas:

```ts
const EffectNodeSchema: z.ZodType<EffectNode> = z.lazy(() =>
  z.discriminatedUnion('type', [
    ActionNodeSchema,
    z.object({ type: z.literal('Sequence'),    effects: z.array(EffectNodeSchema) }),
    z.object({ type: z.literal('Optional'),    effect: EffectNodeSchema, prompt: z.string().optional() }),
    z.object({ type: z.literal('ChooseOne'),   options: z.array(EffectNodeSchema) }),
    z.object({ type: z.literal('Conditional'), condition: ConditionNodeSchema,
                                               then: EffectNodeSchema,
                                               else: EffectNodeSchema.optional() }),
    z.object({ type: z.literal('ForEach'),     selector: SelectorNodeSchema, effect: EffectNodeSchema }),
  ])
)
```

`ConditionNodeSchema` follows the same `z.lazy()` pattern for its combinator branches.

The compiled catalog loader calls `EffectProgramSchema.safeParse(raw)` on each card entry at engine startup. A parse failure means the compiler and engine have drifted and must be reconciled before play can begin.

---

## 9. Package dependency graph update

This sub-spec changes the master dependency graph. `effect-ir` now depends on `protocol` to import shared ID types (`CardDefId`, etc.) rather than redefining them locally.

Updated graph:

| Package | Depends on |
|---|---|
| `protocol` | — |
| `effect-ir` | `protocol` |
| `card-catalog` | — |
| `card-compiler` | `effect-ir`, `card-catalog` |
| `engine` | `protocol`, `effect-ir`, `card-catalog` |

Sub-spec #01 (`2026-06-09-subspec-01-monorepo-workspace-design.md`) should be updated to reflect this change before implementation begins.

---

## 10. Out of scope for this sub-spec

- The `EffectInterpreter` implementation or interface (defined inside `@thejokersthief/riftbound-engine`, sub-spec #8)
- The card compiler / parser that produces `EffectProgram` values (sub-spec #5)
- The `FallbackRegistry` (sub-spec #5)
- Any game-state types (sub-spec #6)
