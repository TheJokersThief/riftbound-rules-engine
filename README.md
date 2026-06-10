# riftbound-rules-engine

A TypeScript rules engine for the Riftbound trading card game. Implements the 1v1 Match format (best-of-3) with fully serializable game state, offline-compiled card effects, and a deterministic seeded RNG.

- Fully serializable — `JSON.stringify` / `JSON.parse` round-trips losslessly; reconstruct any state from `initialState + orderedActions`
- Deterministic — same seed + same action sequence → byte-identical final state
- Offline-compiled card effects — the engine never parses card text at runtime
- 1v1 Match only (best-of-3) — other formats are out of scope for v1

## Packages

| Package | Description |
|---|---|
| `@thejokersthief/riftbound-protocol` | Shared wire types and branded IDs used by all packages |
| `@thejokersthief/riftbound-effect-ir` | Intermediate representation for compiled card effects |
| `@thejokersthief/riftbound-card-catalog` | Card definitions loaded from a JSON snapshot |
| `@thejokersthief/riftbound-card-compiler` | Parses card ability text into effect programs (build-time only) |
| `@thejokersthief/riftbound-engine` | Core rules engine — game state, turn flow, combat, chain resolution |

## Quick Start

```ts
import {
  createGame, submit, legalActions,
  runStartPhase, runChannelPhase, startMainPhase, createRulesQuery,
} from '@thejokersthief/riftbound-engine'
import { createCardCatalog, defaultSnapshotSource } from '@thejokersthief/riftbound-card-catalog'
import { toPlayerId, toCardDefId, toMatchId } from '@thejokersthief/riftbound-protocol'
import type { DeckConfig } from '@thejokersthief/riftbound-engine'

const catalog = await createCardCatalog(defaultSnapshotSource)

const myDeck: DeckConfig = {
  legendId: toCardDefId('ogs-017-024'),
  championId: toCardDefId('ogs-021-024'),
  battlefields: [toCardDefId('unl-t01'), toCardDefId('unl-t03'), toCardDefId('unl-205-219')],
  mainDeck: Array(40).fill(toCardDefId('ogn-001-298')),
  runeDeck: Array(10).fill(toCardDefId('ogn-007-298')),
}

const P1 = toPlayerId('alice')
const P2 = toPlayerId('bob')

let state = createGame({
  players: [P1, P2],
  decks: { [P1]: myDeck, [P2]: myDeck },
  seed: 42,
  matchId: toMatchId('match-1'),
})

// Mulligan
state = submit(state, { type: 'KeepHand', playerId: state.activePlayerId }, catalog).state

// Advance automatic turn phases (no player input)
const query = createRulesQuery(state, catalog)
state = runStartPhase(state, query).state
state = runChannelPhase(state).state
state = startMainPhase(state).state

// Player ends turn
state = submit(state, { type: 'EndTurn', playerId: state.activePlayerId }, catalog).state
```

## Documentation

- [Game Flow & Architecture](docs/game-flow.md) — how the engine works and how to drive a game loop
- [Testing Guide](docs/testing.md) — testing methodology and patterns
- [Contributing](docs/contributing.md) — dev environment setup and package boundaries

## Further Reading

- [`CONTEXT.md`](CONTEXT.md) — domain glossary (Match, Chain, Showdown, etc.)
- [`docs/adr/`](docs/adr/) — architectural decision records
- [`examples/riftbound-example/src/index.ts`](examples/riftbound-example/src/index.ts) — fully annotated game walkthrough
