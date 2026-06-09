# Engine: Chain Resolver — Design Specification

**Date:** 2026-06-09
**Status:** Approved design, pending implementation plan
**Sub-spec:** #9 of 15 — depends on sub-spec #06 (engine game state), sub-spec #07 (rules-query), sub-spec #08 (effect interpreter)
**Scope:** The `chain/` module within `@thejokersthief/riftbound-engine`. Drives the HOT FEPR loop (Handle Outstanding Tasks → Finalize → Execute → Pass → Resolve), the priority/focus state machine, and showdown open/close logic.

---

## 1. GameState amendment

Sub-spec #6 (`GameState`) must be extended with:

```ts
hotQueue: TriggeredAbilityTask[]
```

```ts
type TriggeredAbilityTask = {
  sourceId:     CardId
  abilityIndex: number       // index into EffectProgram.abilities
  controller:   PlayerId
  context:      { triggerEvent: TriggerEvent; targets?: CardId[] }
}
```

---

## 2. Module structure

```
packages/engine/src/chain/
├── index.ts      ← advance() entry point
├── fepr.ts       ← FEPR step machine
├── hot.ts        ← HOT queue: collectTriggers(), drainHot()
└── showdown.ts   ← showdown open/close, focus alternation
```

`advance` is the single entry point called by the Engine façade after every `submit()`. It drives the HOT FEPR loop until the chain is fully resolved, or until `state.pendingDecision !== null`.

```ts
function advance(
  state:   GameState,
  query:   RulesQuery,
  catalog: CardCatalog
): { state: GameState; events: GameEvent[] }
```

---

## 3. FEPR state machine (`fepr.ts`)

The machine re-enters at `state.chain.resumeAt` (from the `ChainFrame` on the resolution stack) after each suspension. The four steps are walked literally per core rules 337–340.

### Finalize (core rule 337)

1. Drain the HOT queue (section 4)
2. For each unresolved chain item in append order: complete its play steps (costs paid, card moved to stack)
3. Resource-adding abilities resolve immediately and never reach Execute

### Execute (core rule 338)

1. Grant priority to `state.chain.priority` (the active player initially)
2. Set `state.pendingDecision` to `PriorityWindow { playerId }`
3. On the next `submit()`:
   - `PlayCard` / `ActivateAbility` → add to chain, update `state.chain.items`, return to Finalize
   - `PassPriority` → record pass; if both players have passed consecutively with nothing added, advance to Pass; otherwise grant priority to the other player and re-emit `PriorityWindow`

### Pass (core rule 339)

All players have passed in sequence with nothing new added. Advance to Resolve.

### Resolve (core rule 340)

1. Pop the newest unresolved `ChainItem`
2. Push its `EffectFrame` onto `state.resolutionStack`
3. Run the interpreter step loop to completion (or suspension)
4. If chain items remain, loop back to Finalize
5. When chain is empty: emit `ChainClosed`, pop the `ChainFrame`

**Priority / focus invariant:** `state.chain.priority` is managed exclusively in `fepr.ts`. `state.chain.focus` is managed exclusively in `showdown.ts`. Neither file touches the other's field.

---

## 4. HOT queue (`hot.ts`)

### Collection

`collectTriggers(state, events, catalog)` is called by `advance()` after each batch of events returned from the interpreter step loop — not by `fold` (which has no catalog access). It:

1. Walks all cards in active zones (battlefields, bases, champions, legends)
2. For each card with a `TriggeredAbility` whose `TriggerEvent` matches the emitted event
3. Evaluates any `condition` against current state
4. Appends qualifying `TriggeredAbilityTask` objects to `state.hotQueue`

**Ordering:** active player's tasks first, then opponent's. Within each player, ordered by `CardInstance.counters['enteredAt']` ascending (earlier-entering card fires first).

### Draining

`drainHot(state, query, catalog)` runs at the start of each Finalize step:

1. Pop the front task from `state.hotQueue`
2. Push an `EffectFrame` for it onto `state.resolutionStack`
3. Run the interpreter step loop to completion (or suspension)
4. Repeat until `hotQueue` is empty or `pendingDecision !== null`

When `hotQueue` is empty, Finalize continues with the chain items.

---

## 5. Showdown state machine (`showdown.ts`)

A showdown opens when a battlefield's control is Contested in a Neutral Open chain state (core rules 341–348).

### Opening

`openShowdown(state, battlefieldId, kind)`:
- Sets `state.chain.showdown = { battlefieldId, kind }`
- Grants `state.chain.focus` to the contesting player
- Emits `ShowdownOpened`

### Focus window

The player with focus receives a `FocusWindow` `DecisionRequest`. On the next `submit()`:

- `PlayCard` / `ActivateAbility` → add to chain, return to Finalize within the showdown
- `PassFocus` → transfer `state.chain.focus` to the other player; emit `FocusPassed`

### Closing

When all players pass focus in sequence with nothing added:

`closeShowdown(state)`:
- Clears `state.chain.showdown`
- Clears `state.chain.focus`
- Emits `ShowdownClosed`

**Post-close routing:**
- **Combat showdown** → hand off to `CombatResolver` (sub-spec #10)
- **Control showdown** → contesting player gains control; emit `ControlChanged`

---

## 6. Out of scope for this sub-spec

- Combat damage steps — owned by `CombatResolver` (sub-spec #10)
- Turn phase transitions — owned by `TurnEngine` (sub-spec #11)
- `legalActions` computation — owned by the Engine façade (sub-spec #14)
