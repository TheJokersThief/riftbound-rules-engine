# Engine: Effect Interpreter — Design Specification

**Date:** 2026-06-09
**Status:** Approved design, pending implementation plan
**Sub-spec:** #8 of 15 — depends on sub-spec #06 (engine game state), sub-spec #07 (rules-query)
**Scope:** The `interpreter/` module within `@thejokersthief/riftbound-engine`. The small-step machine that advances one `EffectFrame` on the resolution stack per call, emitting `GameEvent`s or suspending with a `DecisionRequest`.

---

## 1. Module location

```
packages/engine/src/interpreter/
├── index.ts        ← step() entry point
├── nodes.ts        ← EffectNode dispatch (Sequence, Optional, ChooseOne, Conditional, ForEach)
├── actions.ts      ← ActionNode dispatch → GameEvent emission
└── selectors.ts    ← resolveSelector(), auto-resolution and suspension logic
```

---

## 2. Interface and step loop

```ts
function step(
  state:   GameState,
  query:   RulesQuery,
  catalog: CardCatalog
): { state: GameState; events: GameEvent[] }
```

The `ChainResolver` (sub-spec #9) drives the step loop:

```ts
while (state.resolutionStack.length > 0 && state.pendingDecision === null) {
  ({ state, events } = step(state, query, catalog))
  allEvents.push(...events)
}
```

`step` inspects the top `StackFrame`. If it is an `EffectFrame`, it executes the next node in `remaining`, advances or pops the frame, and returns. Suspension is encoded entirely in state: `pendingDecision !== null` means a `DecisionFrame` is on the stack and the loop must stop and return to the player.

---

## 3. EffectNode dispatch (`nodes.ts`)

When the top frame is an `EffectFrame`, `step` takes the head of `remaining` and dispatches:

| Node | Behaviour |
|---|---|
| `Sequence` | Replace `frame.remaining` with `[...nodes, ...rest]` |
| `Optional` | Push `DecisionFrame` (ChooseYesNo); set `pendingDecision` |
| `ChooseOne` | Push `DecisionFrame` (ChooseOne); set `pendingDecision` |
| `Conditional` | Evaluate condition against state (no suspension); continue with `.then` or `.else`; pop if no `.else` and condition is false |
| `ForEach` | Resolve selector; if empty pop frame; else push one `EffectFrame` per matched card (head first) |
| `ActionNode` | Execute (section 4); consume from `remaining`; pop frame if `remaining` is now empty |

### Resuming after a decision

When the player answers a `ChooseYesNo` or `ChooseOne`, the `ChainResolver` pops the `DecisionFrame`, recovers `resumeFrame`, and pushes it back onto the stack:

- **`Optional` + `true`** — push the wrapped `EffectNode` as a new `EffectFrame`
- **`Optional` + `false`** — discard the effect; pop the `DecisionFrame`; continue
- **`ChooseOne`** — push the `EffectNode` at `options[answer.index]` as a new `EffectFrame`

`Conditional` evaluates immediately against current state — no player decision, no suspension.

---

## 4. ActionNode dispatch (`actions.ts`)

Each `ActionNode` variant emits one or more `GameEvent`s via `fold`. `NumberExpr` values are resolved before emit: a literal number returns directly; `MightOf` calls `query.mightOf(targetId)`; `CountOf` resolves the selector and returns the result count.

| ActionNode | Events emitted |
|---|---|
| `Deal` | `DamageDealt` per resolved target (amount from `NumberExpr`) |
| `Draw` | `CardDrawn` × count |
| `Discard` | `CardDiscarded` per resolved target |
| `Move` | `CardMoved` (fromZone → toZone) per target |
| `Recall` | `CardRecalled` per target |
| `ReturnToHand` | `CardReturnedToHand` per target |
| `Buff` | `CardBuffed` per target |
| `Ready` | `CardReadied` per target |
| `Exhaust` | `CardExhausted` per target |
| `Kill` | `CardKilled` per target |
| `Banish` | `CardBanished` per target |
| `CreateToken` | `TokenCreated` |
| `Counter` | `CardCountered` per target |
| `AddResource` | `ResourceAdded` |
| `GainXP` | `XPGained` per target |
| `SpendXP` | `XPSpent` per target |
| `Reveal` | `CardRevealed` per target |
| `Recycle` | `CardRecycled` per target |
| `GiveMight` | `MightGiven` per target |
| `GrantKeyword` | `KeywordGranted` per target |
| `TakeExtraTurn` | `ExtraTurnGranted` |

After emitting, the `ActionNode` is consumed from `frame.remaining`. If `remaining` is now empty the `EffectFrame` pops.

---

## 5. Selector resolution (`selectors.ts`)

```ts
function resolveSelector(
  selector: SelectorNode,
  state:    GameState,
  sourceId: CardId,
  catalog:  CardCatalog
): CardId[]
```

### Auto-resolution (`chooser: 'None'`)

Applied in five passes:

1. **Scope** — collect candidates: `'Friendly'` = cards owned by source's controller; `'Enemy'` = cards owned by the other player; `'Any'` = all cards in play
2. **ObjectType** — filter by `CardType` from `catalog.get(cardInstance.defId)`
3. **Location** — filter by zone:
   - `'Here'` — same battlefield as `sourceId`
   - `'AtBattlefields'` — any `BattlefieldState.units`
   - `'AtBase'` — any `PlayerState.base`
   - `'InHand'` — any `PlayerState.hand`
   - `'TopOfDeck'` — first N of `PlayerState.mainDeck`
4. **Filters** — apply each `FilterNode` in order: `MightLE` / `MightGE` via `query.mightOf`, `IsReady` / `IsExhausted` via `CardInstance.exhausted`, `HasKeyword` via `query.keywordsOf`, `IsBuffed` via `CardInstance.buffAmount > 0`, `Named` via `CardDefinition.name`, `IsThis` returns only `sourceId`
5. **Quantity** — `All` returns all; `One` and `UpTo N` return up to that many from the filtered set in stable order; `Exactly N` returns all N or an empty list if fewer than N match

### Suspension (`chooser != 'None'`)

The interpreter does not pick targets. It:

1. Emits a `ChooseTargets` `DecisionRequest` describing the selector's constraints (min, max, prompt)
2. Pushes a `DecisionFrame` onto the resolution stack with the current `EffectFrame` as `resumeFrame`
3. Sets `state.pendingDecision`
4. Returns

The next `submit()` call carrying a `ChooseTargets` action resumes by:

1. Popping the `DecisionFrame`
2. Injecting the chosen `targets` into the recovered `EffectFrame.targets`
3. Pushing the `EffectFrame` back
4. Clearing `state.pendingDecision`
5. Continuing the step loop

---

## 6. Out of scope for this sub-spec

- Driving the step loop — owned by `ChainResolver` (sub-spec #9)
- Triggered ability collection (HOT queue) — owned by `ChainResolver` (sub-spec #9)
- Combat damage assignment — owned by `CombatResolver` (sub-spec #10)
