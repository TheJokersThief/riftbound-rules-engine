# Engine: RulesQuery / Layers System — Design Specification

**Date:** 2026-06-09
**Status:** Approved design, pending implementation plan
**Sub-spec:** #7 of 15 — depends on sub-spec #06 (engine game state)
**Scope:** The `rules-query/` module within `@thejokersthief/riftbound-engine`. Computes derived state — effective might, active keywords, and play legality — by collecting all active `StaticAbility` effects in play, resolving their dependency graph, and applying modifications in topological layer order.

---

## 1. Module location

```
packages/engine/src/rules-query/
├── index.ts        ← createRulesQuery factory + RulesQuery interface
├── layers.ts       ← layer collection, dependency graph, topological sort, application
└── timing.ts       ← timing and resource legality checks for canBePlayed
```

---

## 2. RulesQuery interface

```ts
interface RulesQuery {
  mightOf(cardId: CardId): number
  isMighty(cardId: CardId): boolean          // might > 0
  keywordsOf(cardId: CardId): string[]       // base keywords ∪ granted keywords
  canBePlayed(cardId: CardId, playerId: PlayerId): boolean
}

function createRulesQuery(state: GameState, catalog: CardCatalog): RulesQuery
```

Constructed once per `submit()` call by the Engine façade and passed to any module that needs derived state. Results are lazily memoized in `Map<CardId, ...>` caches inside the object — the layers computation runs at most once per card per `submit()`. The object and its caches are discarded when `submit()` returns.

---

## 3. Layers system (`layers.ts`)

### Five layers (core rules 468–475)

| Layer | Modifies |
|---|---|
| 1 | Control changes |
| 2 | Card type / subtype |
| 3 | Keyword grants and removals |
| 4 | Might (continuous effects) |
| 5 | Prevention / replacement effects |

### Collection

On first access for a given `cardId`, the system walks all cards currently in an active zone (units at battlefields, units and gear at bases, champions, legends) and collects every `StaticAbility` whose `SelectorNode` resolves to include the queried card. Only abilities from cards that are face-up and in a zone where they are active are included.

### Dependency graph

A `StaticAbility` at layer N depends on another at layer N if its `ModificationNode` reads a value that the other ability also modifies. Dependencies are detected by inspecting `SelectorNode` targets and `ModificationNode` types — for example, an ability that grants "+might equal to the might of another unit" reads a value that layer-4 abilities also write, establishing a dependency edge.

Within the same layer, abilities not connected by a dependency edge are further ordered by timestamp: the turn number and resolution step at which the card entered play, recorded on `CardInstance.counters['enteredAt']` (a packed integer).

### Topological sort

Kahn's algorithm over the collected DAG. If a cycle is detected within a layer (which should not occur in valid card designs), it is broken by layer-order + timestamp as the tiebreak — the earlier-entering card's ability wins. This matches the rulebook's tiebreak rule.

### Application

Modifications are applied in topological order to a working copy of each card's derived values, starting from the base values in the `CardDefinition` (from the catalog) plus any `CardInstance.buffAmount` and `CardInstance.keywords` already on the instance. The result is the fully-resolved `mightOf` and `keywordsOf` for that card.

---

## 4. `canBePlayed` implementation (`timing.ts`)

Checks timing legality and resource availability only. Zone (card is in hand) and Unique (no copy already in play) are the caller's responsibility — the Engine façade's `legalActions()` performs those checks before calling `canBePlayed`.

### Timing

| Card type / keyword | Legal when |
|---|---|
| Unit, Gear | Main phase; chain is open or neutral |
| Spell | Main phase; chain is open |
| `[Action]` ability | Chain is open; player has priority |
| `[Reaction]` ability | Showdown is open; player has focus |
| Rune | Channel phase only |

### Resources

Player's current `energy` and `power` must cover the card's `playCost.energy` and `playCost.power`. Any required rune symbols in `playCost.runes` must have a matching filled slot in the player's `runePool`.

```ts
canBePlayed(cardId: CardId, playerId: PlayerId): boolean {
  const def    = catalog.get(state.cards[cardId].defId)
  const player = state.players[playerId]
  return checkTiming(def, state) && checkResources(def.playCost, player)
}
```

---

## 5. Out of scope for this sub-spec

- `legalActions()` computation — owned by the Engine façade (sub-spec #14)
- Zone and Unique legality — caller's responsibility
- Triggered and activated ability resolution — owned by the Effect Interpreter (sub-spec #8)
