# Card Catalog Package — Design Specification

**Date:** 2026-06-09
**Status:** Approved design, pending implementation plan
**Sub-spec:** #4 of 15 — depends on sub-spec #01 (monorepo & workspace), sub-spec #02 (protocol package)
**Scope:** `@thejokersthief/riftbound-card-catalog`. `CardDefinition` types and Zod schemas, the frozen normalized riftdex snapshot, the `CardCatalog` module, the `CardDataSource` adapter seam, and the ingestion/refresh CLI script.

---

## 1. Package structure

```
packages/card-catalog/
├── package.json            ← { "type": "module", dependencies: { "zod": "^4",
│                                "@thejokersthief/riftbound-protocol": "workspace:*" } }
├── tsconfig.json           ← extends ../../tsconfig.base.json, references: [../protocol]
├── vitest.config.ts
├── data/
│   └── cards.json          ← frozen normalized snapshot (~964 cards)
├── scripts/
│   └── refresh-catalog.ts  ← ingestion/refresh CLI (run via `just refresh-catalog`)
└── src/
    ├── types.ts            ← CardDefinition, CardType, DeckZone, PlayCost + Zod schemas
    ├── source.ts           ← CardDataSource interface + SnapshotCardDataSource + LiveCardDataSource
    ├── catalog.ts          ← CardCatalog interface + createCardCatalog factory
    └── index.ts            ← re-exports public surface
```

`CardDefId` is imported from `@thejokersthief/riftbound-protocol`. This makes `protocol` a dependency of `card-catalog`, updating the master package graph (see section 8).

---

## 2. CardDefinition and related types (`types.ts`)

```ts
type CardDefinition = {
  id:          CardDefId
  name:        string
  cardType:    CardType
  set:         string
  rarity:      string | null
  abilityText: string        // normalized: HTML stripped, reminder text discarded, :rb_*: tokens preserved
  might:       number | null // units only; null for non-units
  playCost:    PlayCost | null // null for Battlefield, Legend, Rune (no play cost)
  deckZone:    DeckZone
  keywords:    string[]      // extracted from [Keyword] tags during normalization
}

type CardType =
  | 'Unit' | 'Gear' | 'Spell'
  | 'Legend' | 'ChosenChampion'
  | 'Battlefield' | 'Rune'

type DeckZone = 'Main' | 'Rune' | 'Legend' | 'Champion' | 'Battlefield'

type PlayCost = {
  energy: number
  power:  number
  runes:  string[]   // :rb_*: token names e.g. ['rb_action', 'rb_any']
                     // stored as plain strings; card-compiler maps to typed RuneSymbol
}
```

`CardDefId` is imported from `@thejokersthief/riftbound-protocol`. `runes` in `PlayCost` are plain strings — the card-compiler (which depends on both packages) is responsible for mapping them to the typed `RuneSymbol` union from `effect-ir`.

---

## 3. CardCatalog module interface (`catalog.ts`)

```ts
interface CardCatalog {
  get(id: CardDefId): CardDefinition          // throws if id unknown
  find(id: CardDefId): CardDefinition | null  // returns null if unknown
  all(): CardDefinition[]
}

async function createCardCatalog(source: CardDataSource): Promise<CardCatalog>
```

`createCardCatalog` calls `source.load()`, validates each entry with `CardDefinitionSchema.safeParse`, builds an in-memory `Map<CardDefId, CardDefinition>`, and returns the frozen catalog object. Entries that fail validation are logged with their card id and omitted — the catalog is still returned rather than throwing, allowing the engine to start with partial data rather than crashing on a single bad record.

- `get` is the hot path, called by the engine on every card lookup.
- `all` is used by the compiler's corpus pass and the coverage report.

---

## 4. CardDataSource adapter seam (`source.ts`)

```ts
interface CardDataSource {
  load(): Promise<CardDefinition[]>
}
```

Two implementations ship with the package:

### SnapshotCardDataSource

Reads `data/cards.json` from the package directory. Used in production and in any test that needs the full catalog:

```ts
class SnapshotCardDataSource implements CardDataSource {
  constructor(private readonly snapshotPath: string) {}
  async load(): Promise<CardDefinition[]> { /* readFile + JSON.parse + Object.values */ }
}
```

A `defaultSnapshotSource` convenience export constructs one pointed at the bundled `data/cards.json`:

```ts
export const defaultSnapshotSource = new SnapshotCardDataSource(
  new URL('../data/cards.json', import.meta.url).pathname
)
```

The engine calls `createCardCatalog(defaultSnapshotSource)` with no path wiring.

### LiveCardDataSource

Fetches `https://riftdex.gg/api/v1/cards`. Used only by the ingestion script — never by the engine at runtime:

```ts
class LiveCardDataSource implements CardDataSource {
  async load(): Promise<CardDefinition[]> { /* fetch + normalize + validate */ }
}
```

### Test usage

Tests that need a small controlled catalog pass an inline implementation — no mocking library required:

```ts
const fixture: CardDataSource = {
  load: async () => [/* hand-authored CardDefinition objects */]
}
```

---

## 5. Snapshot structure (`data/cards.json`)

A JSON object mapping `CardDefId` to `CardDefinition`. Object form allows O(1) lookup during ingestion diffs and keeps individual card changes readable in git:

```json
{
  "abc123": {
    "id": "abc123",
    "name": "Ironclad Sentinel",
    "cardType": "Unit",
    "set": "core",
    "rarity": "common",
    "abilityText": "When I enter play, Ready a friendly unit here.",
    "might": 3,
    "playCost": { "energy": 2, "power": 0, "runes": [] },
    "deckZone": "Main",
    "keywords": ["Tank"]
  }
}
```

`SnapshotCardDataSource` calls `Object.values()` to produce the `CardDefinition[]` that `createCardCatalog` expects.

The snapshot is committed to the repository and treated as a versioned artifact. It is not auto-generated on install or build — a stale snapshot is intentional (freeze semantics). The ingestion script is the only thing that should overwrite it.

---

## 6. Ingestion/refresh tool (`scripts/refresh-catalog.ts`)

Run manually when the catalog needs updating. Never runs as part of CI or engine startup.

```
just refresh-catalog
```

Wired as an Nx target in the package's `project.json`:

```json
{ "targets": { "refresh": { "command": "tsx scripts/refresh-catalog.ts" } } }
```

**Steps:**

1. Fetch `https://riftdex.gg/api/v1/cards` via `LiveCardDataSource`
2. For each raw API record, normalize:
   - Strip HTML tags (`<p>`, `<br>`, etc.) from ability text
   - Discard parenthetical reminder text (anything in `(…)` following a keyword definition)
   - Extract `[Keyword]` tags into the `keywords` array
   - Preserve `:rb_*:` rune tokens as-is in the normalized ability text
3. Validate the normalized record against `CardDefinitionSchema` — failures are written to `refresh-errors.json` and skipped
4. Overwrite `data/cards.json` with the new snapshot
5. Print a summary: total fetched / normalized / failed, and a delta vs the previous snapshot (added / removed / changed card ids)

Uses `tsx` for direct TypeScript execution. No dependency on the engine or compiler.

---

## 7. Zod schema strategy (`types.ts`)

```ts
const PlayCostSchema = z.object({
  energy: z.number().int().min(0),
  power:  z.number().int().min(0),
  runes:  z.array(z.string()),
})

const CardDefinitionSchema = z.object({
  id:          CardDefIdSchema,
  name:        z.string(),
  cardType:    z.enum(['Unit','Gear','Spell','Legend','ChosenChampion','Battlefield','Rune']),
  set:         z.string(),
  rarity:      z.string().nullable(),
  abilityText: z.string(),
  might:       z.number().int().min(0).nullable(),
  playCost:    PlayCostSchema.nullable(),
  deckZone:    z.enum(['Main','Rune','Legend','Champion','Battlefield']),
  keywords:    z.array(z.string()),
})

const CardSnapshotSchema = z.record(CardDefIdSchema, CardDefinitionSchema)
```

`CardDefIdSchema` is imported from `@thejokersthief/riftbound-protocol`. All types are derived via `z.infer<>`. The snapshot loader uses `CardSnapshotSchema.safeParse`; the live source uses `CardDefinitionSchema.safeParse` per record during normalization.

---

## 8. Package dependency graph update

`card-catalog` depends on `protocol` to import `CardDefId` and `CardDefIdSchema`.

Updated graph:

| Package | Depends on |
|---|---|
| `protocol` | — |
| `effect-ir` | `protocol` |
| `card-catalog` | `protocol` |
| `card-compiler` | `effect-ir`, `card-catalog` |
| `engine` | `protocol`, `effect-ir`, `card-catalog` |

Sub-spec #01 should be updated to reflect this before implementation begins.

---

## 9. Out of scope for this sub-spec

- HTML parsing beyond ability text normalization (owned by the card-compiler, sub-spec #5)
- The `EffectProgram` compilation of card text (sub-spec #5)
- The `FallbackRegistry` (sub-spec #5)
- Any game-state or runtime logic (engine sub-specs #6–#14)
