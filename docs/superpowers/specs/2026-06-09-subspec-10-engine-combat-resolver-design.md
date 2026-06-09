# Engine: Combat Resolver — Design Specification

**Date:** 2026-06-09
**Status:** Approved design, pending implementation plan
**Sub-spec:** #10 of 15 — depends on sub-spec #06 (engine game state), sub-spec #07 (rules-query), sub-spec #09 (chain resolver)
**Scope:** The `combat/` module within `@thejokersthief/riftbound-engine`. Handles the Combat Damage step and the Resolution step of combat (core rules 454–461). The Combat Showdown step is driven by `ChainResolver` — `CombatResolver` receives control after the showdown closes.

---

## 1. Module structure

```
packages/engine/src/combat/
├── index.ts        ← resolveCombat() entry point
├── damage.ts       ← damage assignment, validation, excess/bonus carry-over
└── resolution.ts   ← kills, card movement, control resolution
```

```ts
function resolveCombat(
  state:          GameState,
  battlefieldId:  BattlefieldId,
  query:          RulesQuery,
  catalog:        CardCatalog
): { state: GameState; events: GameEvent[] }
```

Called by `closeShowdown` in `chain/showdown.ts` when a Combat Showdown closes. Returns `{ state, events }`. The `CombatFrame` is popped from the resolution stack on return; `ChainResolver.advance()` continues from there.

---

## 2. Combat Damage step (`damage.ts`)

### Setup

1. Collect attacking units — `battlefield.units` belonging to the contesting player
2. Collect defending units — `battlefield.units` belonging to the defending controller
3. Emit `AssignDamage` `DecisionRequest` to the attacking player, listing attackers with their effective might (via `query.mightOf`) and total damage pool

### Player assignment

The attacking player submits an `AssignDamage` action with `assignments: DamageAssignment[]`.

### Validation

Before applying, the engine checks:
- Total assigned damage equals the sum of all attacker `mightOf` values plus any bonus damage from active effects
- Each `defenderId` is a valid unit present on the battlefield
- Lethal damage must be assigned to the current defender before assigning to the next — excess may carry over but assignment order must be respected

### Excess and bonus damage

- **Excess** — if an attacker's assigned amount exceeds a defender's current might, the excess carries over to the next defender in assignment order
- **Bonus damage** — added on top of base assignment and also carries over

### Tank keyword

Units with the `Tank` keyword (from `query.keywordsOf`) absorb damage intended for non-Tank units at the same battlefield. Tank targeting is resolved before assignment validation — the attacking player must assign lethal to Tank units before assigning to others.

### Events emitted

One `DamageDealt` per attacker-defender pair in assignment order, with `amount` and `bonus` fields matching the validated assignment.

---

## 3. Resolution step (`resolution.ts`)

Applied immediately after all `DamageDealt` events are folded.

### Kills

Any unit whose cumulative damage received this combat ≥ `query.mightOf` is killed:
- Emit `CardKilled` per unit
- Move the unit to its owner's discard pile; emit `CardMoved`
- Units with a `Banish` effect on kill are banished instead; emit `CardBanished`

### HOT queue

`WhenKilled` triggers for killed units are collected and appended to `state.hotQueue`. They drain at the start of the next Finalize step when control returns to `ChainResolver`.

### Control resolution

After deaths are processed:

| Outcome | Result |
|---|---|
| Contesting player has units; defending player does not | `ControlChanged` — contesting player gains control |
| Defending player has units; contesting player does not | Control unchanged |
| Both have units, or neither has units | Control unchanged |

Emit `ControlChanged` if control changes.

### Return

`resolveCombat` returns `{ state, events }`. The `CombatFrame` is popped from the resolution stack. `ChainResolver.advance()` continues from where it left off.

---

## 4. Out of scope for this sub-spec

- The Combat Showdown step — driven by `ChainResolver` (sub-spec #9)
- Scoring after control changes — owned by `TurnEngine` (sub-spec #11)
- `Deathknell` and other death-triggered ability resolution — collected into `state.hotQueue` here; executed by `ChainResolver` (sub-spec #9)
