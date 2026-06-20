# Card Resolution on Play — Design Specification

**Date:** 2026-06-20
**Status:** Approved design, pending implementation plan
**Scope:** First sub-project of the "wire up card effects" arc. Makes a played card actually execute its compiled `EffectProgram` against game state — end-to-end, including one player-chosen targeted effect ("deal N to a unit"). Touches `card-catalog` (program plumbing), `protocol`/engine state (data-model fields), and `engine` (`PlayCard` resolution, `fold` reducers, basic targeting). No new subsystems — the interpreter, chain resolver (`feprStep`), and trigger collector already exist.

---

## 1. Context: what already exists vs. what is missing

The effect pipeline is **more complete than it appears at runtime**. The following are already built and correct:

- The effect IR (`@thejokersthief/riftbound-effect-ir`) — actions, selectors, conditions, abilities, programs.
- The compiler output: `packages/card-catalog/data/compiled-catalog.json` holds real `EffectProgram`s for 964 cards (only 35 with empty `abilities`).
- The interpreter (`engine/src/interpreter/`) — `step`, `executeAction`, `dispatchNode`, `resolveSelector`.
- The chain resolver (`engine/src/chain/fepr.ts`) — `feprStep` already: finds the next unresolved `ChainItem`, looks up its `EffectProgram` from a `programs` map, extracts the first non-`Static` ability's effect nodes, builds an `EffectFrame` carrying `item.targets`, and pushes it for the interpreter to run.
- The trigger collector (`engine/src/chain/hot.ts`) — `collectTriggers`/`drainHot` match `GameEvent`s (e.g. `CardPlayed` → `WhenPlayed`) against active cards' programs and enqueue `TriggeredAbilityTask`s.

**Three breaks sever this otherwise-complete pipeline:**

1. **The `programs` map is always empty.** `advance`, `feprStep`, `drainHot`, and `collectTriggers` all accept a `programs: ReadonlyMap<string, EffectProgram>` parameter that **defaults to an empty `Map`**, and `submit` never supplies one. Consequently `feprStep` always hits its `!program` branch and silently marks every chain item resolved without effect; `collectTriggers` never finds a program to match.
2. **`PlayCard` never engages the chain.** The `submit` `PlayCard` handler (`engine/src/index.ts:300`) emits a single `CardPlayed` event and folds it — it does not pay costs, move the card, open a chain, or add a `ChainItem`.
3. **`fold` no-ops the core mutation events.** `fold` (`engine/src/state/fold.ts:178–195`) returns state unchanged for `CardPlayed`, `CardMoved`, `DamageDealt`, `CardReturnedToHand`, `CardBanished`, `TokenCreated`, and others. Even when the interpreter emits `DamageDealt`, nothing changes.

Additionally, two data-model substrates are absent:

- **No persistent damage.** `CardInstance` has no `damage` field. Combat (`combat/resolution.ts`) tracks damage in a transient per-pass `Map` and kills only when `damage ≥ might` in that pass; non-lethal damage evaporates.
- **No trash/discard zone.** `PlayerState` has hand, decks, runePool, legend/champion, base — but no trash. `CardKilled` removes a unit (it vanishes); combat "moves" dead units to a `discard-<player>` zone that does not exist in state.

This spec feeds the `programs` map, engages the chain on play, completes the relevant `fold` reducers, and adds the two missing data-model substrates.

---

## 2. Design decisions (resolved during brainstorming)

| Decision | Choice | Rationale |
|---|---|---|
| Damage model | **Persistent `damage: number` on `CardInstance`** | Faithful to Riftbound; makes non-lethal spell damage meaningful. Lethality is decided by a resolver that has `query` (might), which emits `CardKilled` — `fold` only accrues damage. |
| Destination for killed/spent cards | **Add a per-player `trash: CardId[]` zone now** | Killed units, spent spells, and `CardMoved` all need a real destination; several IR actions reference trash. Cheap; avoids cards vanishing. |
| Spell resolution timing | **Route spells through the existing chain (`feprStep`)** | The machinery already exists and is faithful (opponent gets priority; both pass; item resolves). Reuse beats reimplementing immediate resolution. |
| Targeting surface | **`legalActions` enumerates concrete `ChooseTargets` options** | A CLI/AI consumer must be able to enumerate legal targets. `resolveSelector` learns to honor pre-chosen `frame.targets`. |

---

## 3. Scope

### In scope

1. **Program plumbing.**
   - `card-catalog` loads `compiled-catalog.json` alongside `cards.json` and exposes `programOf(defId: CardDefId): EffectProgram` on the `CardCatalog` interface (returns `{ type: "Unparsed" }` for unknown/missing entries).
   - The engine builds a `programs: Map<string, EffectProgram>` once from the catalog and threads it through `submit → advance → feprStep / drainHot / collectTriggers` (parameters already exist).

2. **Data model.**
   - `CardInstance` gains `damage: number` (default `0`).
   - `PlayerState` gains `trash: CardId[]` (default `[]`).
   - `createGame` initializes both; `serialize`/`deserialize` round-trip them; Zod schemas updated.

3. **`fold` reducers** (replace the no-op cases):
   - `CardPlayed` — remove the card from the owner's `hand`.
   - `CardMoved` — remove the card from its source zone and append to the destination zone (hand, base, trash, battlefield units, deck; resolve the `discard-<player>`/trash zone string used by combat to the player's `trash`).
   - `DamageDealt` — `card.damage += amount + (bonus ?? 0)`.
   - `CardKilled` — extend the existing remove-from-zones logic to also push the card to its owner's `trash` and reset its `damage` to `0`.

4. **`PlayCard` resolution** (`submit` handler):
   - Guard with `query.canBePlayed` (existing timing + resource check).
   - Pay cost: emit `ResourceAdded` with negative `energy`/`power` (fold already supports additive resources). Rune-symbol consumption is **out of scope** (availability is still checked by existing `checkResources`).
   - Emit `CardPlayed` (removes from hand).
   - **Unit / Gear:** emit `CardMoved` (hand→base). Its `WhenPlayed` / `WhenEntersPlay` triggered abilities are picked up by `drainHot` from the `CardPlayed` event (the card is now in an active zone — base).
   - **Spell:** open the chain if closed (`ChainOpened`), add a `ChainItem` (`defId`, `sourceId`, `controller`, chosen `targets`, `resolved: false`). The existing FEPR loop resolves it; after resolution the spell is moved to the owner's `trash`.
   - Drive resolution via the existing `advance(state, query, catalog, programs)` until `pendingDecision` is set or the stack is empty.

5. **Basic targeting.**
   - When a resolving effect's selector has `chooser: "You" | "Opponent"` **and** the number of legal candidates exceeds the quantity required, the interpreter pauses with a `ChooseTargets` `pendingDecision` (via the existing `DecisionFrame` mechanism) instead of auto-picking.
   - `legalActions` enumerates one concrete `ChooseTargets` action per legal candidate set (for `quantity: One`, one action per candidate card).
   - `submit` validates the chosen targets against the candidate set and writes them onto the resuming `EffectFrame.targets` (and/or the `ChainItem.targets`).
   - `resolveSelector` honors `frame.targets` when non-empty (today it ignores them and slices the first match); when empty and `chooser: "None"`, it keeps current deterministic behavior.

6. **Damage cleanup.** `turn/cleanup.ts` resets every `CardInstance.damage` to `0` at end-of-turn cleanup (persistent within a turn, cleared at turn boundary).

### Out of scope (deferred to later sub-projects)

- Static ability **layers** — `rules-query/layers.ts` (`ModifyMight`, `AddKeyword` from *other* cards) stays stubbed.
- **Activated** abilities and **Showdown/Focus** combat-through-gameplay (sub-project #4).
- Multi-target selection beyond a single `chooser` choice (`UpTo`/`Exactly` with player choice over the count); target-legality rules beyond what the selector encodes.
- Faithful **rune-symbol spending** (slots are not consumed).
- Full 964-card coverage — verification uses a handful of representative cards plus a curated "deal N to a unit" card.

---

## 4. Components touched

| File | Change |
|---|---|
| `packages/card-catalog/src/source.ts` | Load `compiled-catalog.json` in addition to `cards.json`. |
| `packages/card-catalog/src/catalog.ts` | Add `programOf(defId)` to the `CardCatalog` interface and implementation. |
| `packages/engine/src/state/types.ts` | Add `CardInstance.damage`, `PlayerState.trash`; update schemas. |
| `packages/engine/src/state/fold.ts` | Implement `CardPlayed`, `CardMoved`, `DamageDealt`; extend `CardKilled`. |
| `packages/engine/src/index.ts` | Build/thread `programs` map; new `PlayCard` resolution; `legalActions` enumerates `ChooseTargets`; `createGame` initializes new fields. |
| `packages/engine/src/interpreter/selectors.ts` | `resolveSelector` honors non-empty `frame.targets`. |
| `packages/engine/src/interpreter/nodes.ts` | Pause for `ChooseTargets` when `chooser` is `You`/`Opponent` with a real choice. |
| `packages/engine/src/turn/cleanup.ts` | Reset `damage` at end-of-turn. |
| `packages/engine/src/visibility/*` | Project new fields (`trash` visible; opponent `damage` visible — units are public). |
| serialize/deserialize | Round-trip new fields (covered by schema updates). |

---

## 5. Data flow — playing a damage spell at a target

```
submit(PlayCard, cardId, targets?)
  ├─ query.canBePlayed(cardId)                      guard (timing + resources)
  ├─ fold ResourceAdded(-energy,-power)             pay cost
  ├─ fold CardPlayed                                remove from hand
  ├─ fold ChainOpened (if chain closed)
  ├─ add ChainItem{ defId, sourceId, controller, targets:[] }
  └─ advance(state, query, catalog, programs)
        ├─ drainHot — no WhenPlayed unit triggers here
        └─ feprStep loop
              ├─ priority window → both players PassPriority
              └─ Resolve: programs.get(defId) → first non-Static ability
                    → EffectFrame{ remaining:[Deal...], targets:item.targets }
                    → step → executeAction(Deal)
                         ├─ resolveSelector(chooser:"You", qty:One, >1 candidate)
                         │     → PAUSE: pendingDecision ChooseTargets + DecisionFrame
                         │   (legalActions now lists one ChooseTargets per candidate)
                         ├─ submit(ChooseTargets, [unitX]) → frame.targets=[unitX]
                         └─ resume → Deal honors frame.targets
                              → fold DamageDealt (damage += N)
                              → resolver checks might; if lethal:
                                   fold CardKilled (→ trash, damage reset)
        └─ spell ChainItem resolved → fold CardMoved (spell → trash)
```

---

## 6. Verification

- **Unit tests — `fold`:** hand removal on `CardPlayed`; zone-to-zone transition on `CardMoved`; `damage` accrual on `DamageDealt`; `CardKilled` pushes to `trash` and clears `damage`.
- **Unit tests — `resolveSelector`:** honors non-empty `frame.targets`; falls back to deterministic behavior when empty / `chooser: "None"`.
- **Integration — targeted spell:** play a spell that deals N to an enemy unit → `ChooseTargets` is offered in `legalActions` → choose target → unit's `damage` increases → unit dies into `trash` when `N ≥ might`, survives with persistent damage otherwise → `damage` cleared at end of turn.
- **Integration — unit ETB trigger:** play a unit with a `WhenPlayed`/`WhenEntersPlay` triggered effect (e.g. `Draw`) → unit enters base → the triggered effect resolves through the chain and changes state.
- **Plumbing:** `catalog.programOf(defId)` returns a `Compiled` program for a known card and `Unparsed` for unknown.
- **Regression:** `pnpm -r test` green; `pnpm --filter @thejokersthief/riftbound-example start` still runs to game-over; `serialize`/`deserialize` round-trips state carrying `damage` and `trash`.

---

## 7. Risks & notes

- **Compiler mis-parses.** Some compiled programs are wrong (e.g. "Against the Odds" compiles to `WhenPlayed → Draw 0`). This spec resolves *whatever the program says* faithfully; correcting parses is the compiler's concern. Verification uses curated cards with known-good programs.
- **`programs` map keying.** The map is keyed by `CardDefId` string; `feprStep` already does `programs.get(unresolved.defId)`. The engine must key identically.
- **Unit play vs. chain.** Units enter base immediately (not via a chain item); only their triggered abilities use the chain/HOT path. Spells resolve as chain items. This split matches the existing `feprStep` (which resolves chain items) and `drainHot` (which resolves triggers) responsibilities.
- **Damage on non-units.** `damage` is added to `CardInstance` generally; only units/gear in play are meaningful targets in this slice. Lethality is only checked by resolvers that emit `CardKilled`.
