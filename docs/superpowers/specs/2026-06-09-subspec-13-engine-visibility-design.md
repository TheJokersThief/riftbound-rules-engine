# Engine: Visibility Module — Design Specification

**Date:** 2026-06-09
**Status:** Approved design, pending implementation plan
**Sub-spec:** #13 of 15 — depends on sub-spec #06 (engine game state), sub-spec #02 (protocol — PlayerView types)
**Scope:** The `visibility/` module within `@thejokersthief/riftbound-engine`. Projects `GameState` into a `PlayerView` for a specific player, redacting all information that player is not allowed to see.

---

## 1. Module structure

```
packages/engine/src/visibility/
└── index.ts     ← viewFor(state, playerId, catalog): PlayerView
```

```ts
function viewFor(
  state:    GameState,
  playerId: PlayerId,
  catalog:  CardCatalog
): PlayerView
```

One function, one file. The projection logic is non-trivial but not large enough to split further.

In non-production environments (`process.env.NODE_ENV !== 'production'`), the result is validated against `PlayerViewSchema.safeParse` before returning. A validation failure throws with a descriptive error — it indicates a bug in the projection logic, not invalid player input.

---

## 2. Projection logic

`viewFor` assembles the three parts of `PlayerView` by reading `GameState` directly.

### SelfView — viewing player's full state (no redaction)

```ts
self: {
  playerId,
  hand:        state.players[playerId].hand.map(id => toCardInstanceView(id, state, catalog, /* hidden */ false)),
  mainDeck:    { count: state.players[playerId].mainDeck.length },
  runeDeck:    { count: state.players[playerId].runeDeck.length },
  runePool:    state.players[playerId].runePool,
  legend:      toCardInstanceView(state.players[playerId].legendZone, state, catalog, false),
  champion:    toCardInstanceView(state.players[playerId].championZone, state, catalog, false),
  battlefield: toCardInstanceView(activeBattlefieldCardId(state, playerId), state, catalog, false),
  base:        state.players[playerId].base.map(id => toCardInstanceView(id, state, catalog, false)),
  resources:   state.players[playerId].resources,
  points:      state.players[playerId].points,
}
```

### OpponentView — opponent's state with hidden information redacted

```ts
opponent: {
  playerId:    opponentId,
  handCount:   state.players[opponentId].hand.length,   // count only, no identities
  mainDeck:    { count: state.players[opponentId].mainDeck.length },
  runeDeck:    { count: state.players[opponentId].runeDeck.length },
  runePool:    state.players[opponentId].runePool,
  legend:      toCardInstanceView(state.players[opponentId].legendZone, state, catalog, false),
  champion:    toCardInstanceView(state.players[opponentId].championZone, state, catalog, false),
  battlefield: toCardInstanceView(activeBattlefieldCardId(state, opponentId), state, catalog, false),
  base:        state.players[opponentId].base.map(id =>
                 toCardInstanceView(id, state, catalog, state.cards[id].faceDown)),
  resources:   state.players[opponentId].resources,
  points:      state.players[opponentId].points,
}
```

Face-down cards (`CardInstance.faceDown === true`) are projected as:

```ts
{ cardId, hidden: true, defId: null, exhausted: false, buffAmount: 0, keywords: [], counters: {}, faceDown: true }
```

The opponent knows a face-down card exists at the zone (its `CardId` is visible for targeting purposes) but cannot see its definition or stats.

### SharedView — same for both players

```ts
shared: {
  gameId:         state.gameId,
  matchId:        state.matchId,
  turnNumber:     state.turnNumber,
  activePlayerId: state.activePlayerId,
  phase:          state.phase,
  chain:          state.chain.items.map(toChainItemView),
  pendingDecision: state.pendingDecision,
  matchRecord:    { wins: matchWins },   // from MatchState if available, else {}
}
```

`ChainItemView` entries always include `defId` — cards on the chain are public information once played.

### `toCardInstanceView` helper

```ts
function toCardInstanceView(
  cardId:  CardId,
  state:   GameState,
  catalog: CardCatalog,
  hidden:  boolean
): CardInstanceView {
  if (hidden) return { cardId, hidden: true, defId: null, exhausted: false,
                       buffAmount: 0, keywords: [], counters: {}, faceDown: true }
  const inst = state.cards[cardId]
  const def  = catalog.get(inst.defId)
  return {
    cardId,
    hidden:     false,
    defId:      inst.defId,
    exhausted:  inst.exhausted,
    buffAmount: inst.buffAmount,
    keywords:   [...def.keywords, ...inst.keywords],
    counters:   inst.counters,
    faceDown:   inst.faceDown,
  }
}
```

---

## 3. Out of scope for this sub-spec

- Computing derived might for display — callers use `RulesQuery.mightOf`; `CardInstanceView` carries `buffAmount` (the raw delta), not the resolved effective might
- Match-level win counts when used standalone (no `MatchState`) — `matchRecord.wins` defaults to `{}`
