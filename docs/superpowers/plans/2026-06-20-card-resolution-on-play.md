# Card Resolution on Play — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a played card actually execute its compiled `EffectProgram` against game state — end-to-end, including a player-chosen targeted effect ("deal N to a unit") resolved through the chain with priority passing.

**Architecture:** The interpreter, chain resolver (`feprStep`), and trigger collector already exist but are unwired. This plan (1) plumbs compiled programs from `compiled-catalog.json` into the catalog and threads a `programs` map through the engine, (2) completes the `fold` reducers that mutate state, (3) adds a persistent `damage` field and a `trash` zone, (4) makes `advance()` a unified driver over both Effect and Chain frames so `feprStep` actually runs, and (5) makes `PlayCard` open a chain, add a chain item with player-chosen targets, and resolve via priority passing.

**Tech Stack:** TypeScript (ESM NodeNext, `.js` import extensions), Zod v3, Vitest, pnpm workspaces, Nx.

**Key conventions (read before starting):**
- All local imports use the `.js` extension in TS source.
- `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` are on. Use non-null assertions (`!`) the way existing code does, and `Object.values()` for branded-key records.
- `fold(state, event)` is a pure reducer — never mutate in place; always spread.
- Run one package's tests with: `pnpm --filter @thejokersthief/riftbound-engine test` (swap the filter for other packages). Run everything with `pnpm -r test`.
- Commit messages: no Claude attribution. Always `git push` after committing.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `packages/engine/src/state/types.ts` | Game-state schemas | Add `CardInstance.damage`, `PlayerState.trash`, `ChainState.passes` |
| `packages/engine/src/index.ts` | `createGame`, `submit`, `legalActions` | Init new fields; thread `programs`; `PlayCard` resolution; `ChooseTargets` enumeration/handling |
| `packages/card-catalog/src/source.ts` | Data sources | Add `SnapshotProgramDataSource` + `defaultProgramSource` |
| `packages/card-catalog/src/catalog.ts` | `CardCatalog` | Add `programs()` / `programOf()` |
| `packages/card-catalog/package.json` + `tsconfig.json` | Package wiring | Add `effect-ir` dependency + project reference |
| `packages/engine/src/state/fold.ts` | Pure reducer | Implement `CardPlayed`, `CardMoved`, `DamageDealt`; extend `CardKilled` |
| `packages/engine/src/turn/cleanup.ts` | End-of-turn cleanup | Reset `damage` |
| `packages/engine/src/interpreter/selectors.ts` | Selector resolution | Extract `selectCandidates`; export it |
| `packages/engine/src/interpreter/actions.ts` | Action execution | `Deal` honors `frame.targets` |
| `packages/engine/src/chain/index.ts` | Resolution driver | Make `advance()` pump Chain frames |
| `packages/engine/src/chain/fepr.ts` | Chain resolution | Spell source → trash after resolving |

---

## Task 1: Add `damage`, `trash`, and `passes` to the state model

**Files:**
- Modify: `packages/engine/src/state/types.ts`
- Modify: `packages/engine/src/index.ts` (createGame init)
- Test: `packages/engine/src/__tests__/state-fields.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/engine/src/__tests__/state-fields.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { toPlayerId, toCardDefId, toMatchId } from "@thejokersthief/riftbound-protocol";
import { createGame, serialize, deserialize } from "../index.js";
import type { DeckConfig } from "../match/state.js";

const P1 = toPlayerId("p1");
const P2 = toPlayerId("p2");

function deck(): DeckConfig {
  return {
    legendId: toCardDefId("ogs-017-024"),
    championId: toCardDefId("ogs-021-024"),
    battlefields: [toCardDefId("unl-t01"), toCardDefId("unl-t03"), toCardDefId("unl-205-219")],
    mainDeck: Array(40).fill(toCardDefId("ogn-001-298")),
    runeDeck: Array(10).fill(toCardDefId("ogn-007-298")),
  };
}

describe("new state fields", () => {
  it("initializes damage=0 on every card, trash=[] per player, passes=0", () => {
    const state = createGame({
      players: [P1, P2],
      decks: { [P1]: deck(), [P2]: deck() },
      seed: 1,
      matchId: toMatchId("m1"),
    });
    for (const card of Object.values(state.cards)) {
      expect(card!.damage).toBe(0);
    }
    expect(state.players[P1]!.trash).toEqual([]);
    expect(state.players[P2]!.trash).toEqual([]);
    expect(state.chain.passes).toBe(0);
  });

  it("round-trips the new fields through serialize/deserialize", () => {
    const state = createGame({
      players: [P1, P2],
      decks: { [P1]: deck(), [P2]: deck() },
      seed: 1,
      matchId: toMatchId("m1"),
    });
    const restored = deserialize(serialize(state));
    expect(restored.players[P1]!.trash).toEqual([]);
    expect(Object.values(restored.cards)[0]!.damage).toBe(0);
    expect(restored.chain.passes).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @thejokersthief/riftbound-engine test -- state-fields`
Expected: FAIL — Zod parse error / `damage`/`trash`/`passes` undefined.

- [ ] **Step 3: Add the fields to the schemas**

In `packages/engine/src/state/types.ts`, add `damage` to `CardInstanceSchema` (after `buffAmount`):

```ts
  buffAmount: z.number().int(),
  damage: z.number().int().nonnegative(),
```

Add `trash` to `PlayerStateSchema` (after `base`):

```ts
  base: z.array(CardIdSchema),
  trash: z.array(CardIdSchema),
```

Add `passes` to `ChainStateSchema` (after `isOpen`):

```ts
  isOpen: z.boolean(),
  passes: z.number().int().nonnegative(),
```

- [ ] **Step 4: Initialize the fields in `createGame`**

In `packages/engine/src/index.ts`, in `makeCard` (after `buffAmount: 0,`):

```ts
      buffAmount: 0,
      damage: 0,
```

In both player objects (after `base: [],`):

```ts
        base: [],
        trash: [],
```

In the `chain` initializer:

```ts
    chain: { isOpen: false, passes: 0, items: [], priority: null, focus: null, showdown: null },
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @thejokersthief/riftbound-engine test -- state-fields`
Expected: PASS (both tests).

- [ ] **Step 6: Run the full engine suite to catch any object-literal breakage**

Run: `pnpm --filter @thejokersthief/riftbound-engine test`
Expected: PASS. If any test constructs a `CardInstance`/`PlayerState`/`ChainState` literal, add the new fields there too.

- [ ] **Step 7: Commit**

```bash
git add packages/engine/src/state/types.ts packages/engine/src/index.ts packages/engine/src/__tests__/state-fields.test.ts
git commit -m "feat(engine): add damage field, trash zone, and chain passes counter"
git push
```

---

## Task 2: Add `effect-ir` dependency to `card-catalog`

**Files:**
- Modify: `packages/card-catalog/package.json`
- Modify: `packages/card-catalog/tsconfig.json`

- [ ] **Step 1: Add the dependency**

In `packages/card-catalog/package.json`, in `dependencies` (keep alphabetical-ish, matching existing style):

```json
  "dependencies": {
    "@thejokersthief/riftbound-effect-ir": "workspace:*",
    "@thejokersthief/riftbound-protocol": "workspace:*",
    "zod": "^3.24.0"
  },
```

- [ ] **Step 2: Add the project reference**

In `packages/card-catalog/tsconfig.json`, extend `references`:

```json
  "references": [
    { "path": "../protocol" },
    { "path": "../effect-ir" }
  ],
```

- [ ] **Step 3: Install**

Run: `pnpm install`
Expected: completes; `@thejokersthief/riftbound-effect-ir` linked into `card-catalog`.

- [ ] **Step 4: Verify the package still builds**

Run: `pnpm --filter @thejokersthief/riftbound-card-catalog build`
Expected: success (no code uses effect-ir yet — this just confirms wiring).

- [ ] **Step 5: Commit**

```bash
git add packages/card-catalog/package.json packages/card-catalog/tsconfig.json pnpm-lock.yaml
git commit -m "build(card-catalog): depend on effect-ir for program plumbing"
git push
```

---

## Task 3: Add a program data source

**Files:**
- Modify: `packages/card-catalog/src/source.ts`
- Test: `packages/card-catalog/src/program-source.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/card-catalog/src/program-source.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { toCardDefId } from "@thejokersthief/riftbound-protocol";
import { defaultProgramSource } from "./source.js";

describe("defaultProgramSource", () => {
  it("loads compiled programs keyed by CardDefId", async () => {
    const programs = await defaultProgramSource.load();
    const prog = programs.get(toCardDefId("ogn-001-298"));
    expect(prog).toBeDefined();
    expect(prog!.type).toBe("Compiled");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @thejokersthief/riftbound-card-catalog test -- program-source`
Expected: FAIL — `defaultProgramSource` is not exported.

- [ ] **Step 3: Implement the program source**

In `packages/card-catalog/src/source.ts`, add imports at the top:

```ts
import type { CardDefId } from "@thejokersthief/riftbound-protocol";
import { CardDefIdSchema } from "@thejokersthief/riftbound-protocol";
import type { EffectProgram } from "@thejokersthief/riftbound-effect-ir";
import { EffectProgramSchema } from "@thejokersthief/riftbound-effect-ir";
import { z } from "zod";
```

(Keep the existing `import { readFile } from "fs/promises";` and the `CardDefId` type import — if `CardDefId` is already imported as a type-only import, merge rather than duplicate.)

At the bottom of the file, add:

```ts
// ---------------------------------------------------------------------------
// Program data source — loads compiled EffectPrograms keyed by CardDefId
// ---------------------------------------------------------------------------

const ProgramSnapshotSchema = z.record(CardDefIdSchema, EffectProgramSchema);

export interface ProgramDataSource {
  load(): Promise<Map<string, EffectProgram>>;
}

export class SnapshotProgramDataSource implements ProgramDataSource {
  constructor(private readonly snapshotPath: string) {}

  async load(): Promise<Map<string, EffectProgram>> {
    const raw = await readFile(this.snapshotPath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    const result = ProgramSnapshotSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(`Failed to parse program snapshot: ${result.error.message}`);
    }
    const map = new Map<string, EffectProgram>();
    for (const [defId, program] of Object.entries(result.data)) {
      if (program !== undefined) map.set(defId, program);
    }
    return map;
  }
}

export const defaultProgramSource = new SnapshotProgramDataSource(
  new URL("../data/compiled-catalog.json", import.meta.url).pathname,
);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @thejokersthief/riftbound-card-catalog test -- program-source`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/card-catalog/src/source.ts packages/card-catalog/src/program-source.test.ts
git commit -m "feat(card-catalog): add SnapshotProgramDataSource for compiled programs"
git push
```

---

## Task 4: Expose `programs()` / `programOf()` on the catalog

**Files:**
- Modify: `packages/card-catalog/src/catalog.ts`
- Test: `packages/card-catalog/src/catalog-programs.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/card-catalog/src/catalog-programs.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { toCardDefId } from "@thejokersthief/riftbound-protocol";
import { createCardCatalog } from "./catalog.js";
import { defaultSnapshotSource } from "./source.js";

describe("catalog programs", () => {
  it("returns a Compiled program for a known card", async () => {
    const catalog = await createCardCatalog(defaultSnapshotSource);
    expect(catalog.programOf(toCardDefId("ogn-001-298")).type).toBe("Compiled");
  });

  it("returns Unparsed for an unknown card", async () => {
    const catalog = await createCardCatalog(defaultSnapshotSource);
    expect(catalog.programOf(toCardDefId("does-not-exist")).type).toBe("Unparsed");
  });

  it("exposes the full programs map", async () => {
    const catalog = await createCardCatalog(defaultSnapshotSource);
    expect(catalog.programs().size).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @thejokersthief/riftbound-card-catalog test -- catalog-programs`
Expected: FAIL — `programOf` / `programs` not on the catalog.

- [ ] **Step 3: Implement on the catalog**

In `packages/card-catalog/src/catalog.ts`, replace the imports and the interface/function. New imports:

```ts
import type { CardDefId } from "@thejokersthief/riftbound-protocol";
import type { CardDataSource, ProgramDataSource } from "./source.js";
import { defaultProgramSource } from "./source.js";
import type { CardDefinition } from "./types.js";
import { CardDefinitionSchema } from "./types.js";
import type { EffectProgram } from "@thejokersthief/riftbound-effect-ir";
```

Extend the interface:

```ts
export interface CardCatalog {
  get(id: CardDefId): CardDefinition;
  find(id: CardDefId): CardDefinition | null;
  all(): CardDefinition[];
  programOf(id: CardDefId): EffectProgram;
  programs(): ReadonlyMap<string, EffectProgram>;
}
```

Update the factory signature and body:

```ts
export async function createCardCatalog(
  source: CardDataSource,
  programSource: ProgramDataSource = defaultProgramSource,
): Promise<CardCatalog> {
  const entries = await source.load();
  const programMap = await programSource.load();
  const map = new Map<CardDefId, CardDefinition>();

  for (const entry of entries) {
    const result = CardDefinitionSchema.safeParse(entry);
    if (!result.success) {
      console.warn("Skipping invalid card entry:", result.error.message);
      continue;
    }
    map.set(result.data.id, result.data);
  }

  const unparsed: EffectProgram = { type: "Unparsed" };

  return Object.freeze({
    get(id: CardDefId): CardDefinition {
      const card = map.get(id);
      if (card === undefined) {
        throw new Error(`Unknown card definition id: ${id}`);
      }
      return card;
    },

    find(id: CardDefId): CardDefinition | null {
      return map.get(id) ?? null;
    },

    all(): CardDefinition[] {
      return Array.from(map.values());
    },

    programOf(id: CardDefId): EffectProgram {
      return programMap.get(id) ?? unparsed;
    },

    programs(): ReadonlyMap<string, EffectProgram> {
      return programMap;
    },
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @thejokersthief/riftbound-card-catalog test -- catalog-programs`
Expected: PASS (all three).

- [ ] **Step 5: Run the full card-catalog suite**

Run: `pnpm --filter @thejokersthief/riftbound-card-catalog test`
Expected: PASS — existing tests that call `createCardCatalog(source)` still work because `programSource` defaults.

- [ ] **Step 6: Commit**

```bash
git add packages/card-catalog/src/catalog.ts packages/card-catalog/src/catalog-programs.test.ts
git commit -m "feat(card-catalog): expose programOf and programs on CardCatalog"
git push
```

---

## Task 5: `fold` — `CardPlayed` removes the card from hand

**Files:**
- Modify: `packages/engine/src/state/fold.ts`
- Test: `packages/engine/src/__tests__/fold-resolution.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/engine/src/__tests__/fold-resolution.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { toPlayerId, toCardDefId, toMatchId } from "@thejokersthief/riftbound-protocol";
import { createGame, fold } from "../index.js";
import type { DeckConfig } from "../match/state.js";

const P1 = toPlayerId("p1");
const P2 = toPlayerId("p2");

function deck(): DeckConfig {
  return {
    legendId: toCardDefId("ogs-017-024"),
    championId: toCardDefId("ogs-021-024"),
    battlefields: [toCardDefId("unl-t01"), toCardDefId("unl-t03"), toCardDefId("unl-205-219")],
    mainDeck: Array(40).fill(toCardDefId("ogn-001-298")),
    runeDeck: Array(10).fill(toCardDefId("ogn-007-298")),
  };
}

function newGame() {
  return createGame({
    players: [P1, P2],
    decks: { [P1]: deck(), [P2]: deck() },
    seed: 1,
    matchId: toMatchId("m1"),
  });
}

describe("fold CardPlayed", () => {
  it("removes the played card from the owner's hand", () => {
    const state = newGame();
    const cardId = state.players[P1]!.hand[0]!;
    const next = fold(state, { type: "CardPlayed", playerId: P1, cardId });
    expect(next.players[P1]!.hand).not.toContain(cardId);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @thejokersthief/riftbound-engine test -- fold-resolution`
Expected: FAIL — card still in hand (CardPlayed is a no-op).

- [ ] **Step 3: Implement the reducer**

In `packages/engine/src/state/fold.ts`, remove `CardPlayed` from the grouped no-op `case` list (lines around 181) and add a real case (place it near `CardDiscarded`):

```ts
    case "CardPlayed": {
      const player = state.players[event.playerId]!;
      return {
        ...state,
        players: {
          ...state.players,
          [event.playerId]: {
            ...player,
            hand: player.hand.filter((id) => id !== event.cardId),
          },
        },
      };
    }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @thejokersthief/riftbound-engine test -- fold-resolution`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/state/fold.ts packages/engine/src/__tests__/fold-resolution.test.ts
git commit -m "feat(engine): fold CardPlayed removes card from hand"
git push
```

---

## Task 6: `fold` — `CardMoved` performs zone transitions

**Files:**
- Modify: `packages/engine/src/state/fold.ts`
- Test: `packages/engine/src/__tests__/fold-resolution.test.ts` (extend)

Zone semantics: `toZone` is a `ZoneId` string. This task handles the destinations this slice needs: `"base"`, `"trash"`, `"hand"`, and any `"discard-*"` string (combat's destination) → the owner's `trash`. The card is first removed from every per-player zone and battlefield it currently occupies, then appended to the destination zone of its **owner**.

- [ ] **Step 1: Write the failing test (append to the file)**

```ts
import { toZoneId } from "@thejokersthief/riftbound-protocol";

describe("fold CardMoved", () => {
  it("moves a card from hand to base", () => {
    const state = newGame();
    const cardId = state.players[P1]!.hand[0]!;
    const next = fold(state, {
      type: "CardMoved",
      cardId,
      fromZone: toZoneId("hand"),
      toZone: toZoneId("base"),
    });
    expect(next.players[P1]!.hand).not.toContain(cardId);
    expect(next.players[P1]!.base).toContain(cardId);
  });

  it("routes a discard-* destination to the owner's trash", () => {
    const state = newGame();
    const cardId = state.players[P1]!.hand[0]!;
    const next = fold(state, {
      type: "CardMoved",
      cardId,
      fromZone: toZoneId("hand"),
      toZone: toZoneId(`discard-${P1}`),
    });
    expect(next.players[P1]!.trash).toContain(cardId);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @thejokersthief/riftbound-engine test -- fold-resolution`
Expected: FAIL — `CardMoved` is a no-op.

- [ ] **Step 3: Implement the reducer**

In `packages/engine/src/state/fold.ts`, add two helpers near `updateCard` at the top of the file:

```ts
function removeCardFromAllZones(state: GameState, cardId: CardId): GameState {
  const players = { ...state.players } as Record<PlayerId, PlayerState>;
  for (const pid of typedObjectKeys(players)) {
    const p = players[pid]!;
    players[pid] = {
      ...p,
      hand: p.hand.filter((id) => id !== cardId),
      mainDeck: p.mainDeck.filter((id) => id !== cardId),
      runeDeck: p.runeDeck.filter((id) => id !== cardId),
      base: p.base.filter((id) => id !== cardId),
      trash: p.trash.filter((id) => id !== cardId),
    };
  }
  const battlefields = { ...state.battlefields } as Record<BattlefieldId, BattlefieldState>;
  for (const bfId of typedObjectKeys(battlefields)) {
    const bf = battlefields[bfId]!;
    if (bf.units.includes(cardId)) {
      battlefields[bfId] = { ...bf, units: bf.units.filter((id) => id !== cardId) };
    }
  }
  return { ...state, players, battlefields };
}

function addCardToZone(state: GameState, cardId: CardId, toZone: string): GameState {
  const ownerId = state.cards[cardId]?.ownerId;
  if (!ownerId) return state;
  const player = state.players[ownerId]!;
  const destination = toZone.startsWith("discard") ? "trash" : toZone;
  switch (destination) {
    case "base":
      return { ...state, players: { ...state.players, [ownerId]: { ...player, base: [...player.base, cardId] } } };
    case "trash":
      return { ...state, players: { ...state.players, [ownerId]: { ...player, trash: [...player.trash, cardId] } } };
    default:
      // Destinations not produced by this slice (hand, mainDeck, a specific
      // battlefield) — leave the card removed. Add cases when a task emits them.
      return state;
  }
}
```

> YAGNI: only `base` and `trash` destinations are emitted in this slice (unit→base, spell/kill→trash). Do not add `hand`/`mainDeck` branches until a task actually produces them.

- [ ] **Step 3b: Reset `chain.passes` in the chain fold cases (robustness)**

While in `fold.ts`, harden the priority-pass counter so it cannot leak across chains. Update the existing `ChainOpened` and `ChainClosed` cases (near the top of `fold`):

```ts
    case "ChainOpened":
      return { ...state, chain: { ...state.chain, isOpen: true, passes: 0 } };

    case "ChainClosed":
      return { ...state, chain: { ...state.chain, isOpen: false, passes: 0, items: [], showdown: null } };
```
```

Then remove `CardMoved` from the no-op group and add:

```ts
    case "CardMoved": {
      const removed = removeCardFromAllZones(state, event.cardId);
      return addCardToZone(removed, event.cardId, event.toZone);
    }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @thejokersthief/riftbound-engine test -- fold-resolution`
Expected: PASS (both CardMoved tests).

- [ ] **Step 5: Run the full engine suite (combat uses CardMoved)**

Run: `pnpm --filter @thejokersthief/riftbound-engine test`
Expected: PASS. Combat already emits `CardMoved` to `discard-<owner>`; those now route to `trash`. If a combat test asserted the old no-op behavior, update it to expect the card in `trash`.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/state/fold.ts packages/engine/src/__tests__/fold-resolution.test.ts
git commit -m "feat(engine): fold CardMoved performs zone transitions"
git push
```

---

## Task 7: `fold` — `DamageDealt` accrues damage; `CardKilled` → trash + reset

**Files:**
- Modify: `packages/engine/src/state/fold.ts`
- Test: `packages/engine/src/__tests__/fold-resolution.test.ts` (extend)

- [ ] **Step 1: Write the failing test (append)**

```ts
describe("fold DamageDealt + CardKilled", () => {
  it("accrues damage on the target", () => {
    const state = newGame();
    const cardId = state.players[P1]!.hand[0]!;
    let next = fold(state, { type: "DamageDealt", sourceId: cardId, targetId: cardId, amount: 2, bonus: 1 });
    expect(next.cards[cardId]!.damage).toBe(3);
    next = fold(next, { type: "DamageDealt", sourceId: cardId, targetId: cardId, amount: 1, bonus: 0 });
    expect(next.cards[cardId]!.damage).toBe(4);
  });

  it("CardKilled moves the card to the owner's trash and clears its damage", () => {
    const state = newGame();
    const cardId = state.players[P1]!.hand[0]!;
    // Put the card in base and give it damage so we can observe the reset.
    let next = fold(state, { type: "CardMoved", cardId, fromZone: toZoneId("hand"), toZone: toZoneId("base") });
    next = fold(next, { type: "DamageDealt", sourceId: cardId, targetId: cardId, amount: 5, bonus: 0 });
    next = fold(next, { type: "CardKilled", cardId });
    expect(next.players[P1]!.base).not.toContain(cardId);
    expect(next.players[P1]!.trash).toContain(cardId);
    expect(next.cards[cardId]!.damage).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @thejokersthief/riftbound-engine test -- fold-resolution`
Expected: FAIL — `DamageDealt` no-op; `CardKilled` does not touch trash/damage.

- [ ] **Step 3: Implement `DamageDealt` and extend `CardKilled`**

Remove `DamageDealt` from the no-op group and add:

```ts
    case "DamageDealt":
      return updateCard(state, event.targetId, (card) => ({
        ...card,
        damage: card.damage + event.amount + event.bonus,
      }));
```

Replace the existing `CardKilled` case body so it also trashes and resets damage. The existing case (around line 110) removes the card from battlefields and base; extend it:

```ts
    case "CardKilled": {
      const killedId = event.cardId;
      const ownerId = state.cards[killedId]?.ownerId;
      const battlefields = { ...state.battlefields } as Record<BattlefieldId, BattlefieldState>;
      for (const bfId of typedObjectKeys(battlefields)) {
        const bf = battlefields[bfId]!;
        if (bf.units.includes(killedId)) {
          battlefields[bfId] = { ...bf, units: bf.units.filter((id) => id !== killedId) };
        }
      }
      const players = { ...state.players } as Record<PlayerId, PlayerState>;
      for (const pid of typedObjectKeys(players)) {
        const p = players[pid]!;
        const inBase = p.base.includes(killedId);
        players[pid] = {
          ...p,
          base: inBase ? p.base.filter((id) => id !== killedId) : p.base,
          trash: pid === ownerId ? [...p.trash, killedId] : p.trash,
        };
      }
      const withZones: GameState = { ...state, battlefields, players };
      return updateCard(withZones, killedId, (card) => ({ ...card, damage: 0 }));
    }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @thejokersthief/riftbound-engine test -- fold-resolution`
Expected: PASS.

- [ ] **Step 5: Run the full engine suite**

Run: `pnpm --filter @thejokersthief/riftbound-engine test`
Expected: PASS. If a combat test asserted killed units vanish (not in trash), update it to expect them in the owner's `trash`.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/state/fold.ts packages/engine/src/__tests__/fold-resolution.test.ts
git commit -m "feat(engine): fold DamageDealt accrues damage; CardKilled trashes and resets"
git push
```

---

## Task 8: Reset `damage` at end-of-turn cleanup

**Files:**
- Modify: `packages/engine/src/turn/cleanup.ts`
- Test: `packages/engine/src/__tests__/cleanup-damage.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/engine/src/__tests__/cleanup-damage.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { toPlayerId, toCardDefId, toMatchId } from "@thejokersthief/riftbound-protocol";
import { createGame, fold, createRulesQuery } from "../index.js";
import { runCleanup } from "../turn/cleanup.js";
import { createCardCatalog, defaultSnapshotSource } from "@thejokersthief/riftbound-card-catalog";
import type { DeckConfig } from "../match/state.js";

const P1 = toPlayerId("p1");
const P2 = toPlayerId("p2");
function deck(): DeckConfig {
  return {
    legendId: toCardDefId("ogs-017-024"),
    championId: toCardDefId("ogs-021-024"),
    battlefields: [toCardDefId("unl-t01"), toCardDefId("unl-t03"), toCardDefId("unl-205-219")],
    mainDeck: Array(40).fill(toCardDefId("ogn-001-298")),
    runeDeck: Array(10).fill(toCardDefId("ogn-007-298")),
  };
}

describe("cleanup resets damage", () => {
  it("clears all card damage during runCleanup", async () => {
    const catalog = await createCardCatalog(defaultSnapshotSource);
    let state = createGame({ players: [P1, P2], decks: { [P1]: deck(), [P2]: deck() }, seed: 1, matchId: toMatchId("m1") });
    const cardId = state.players[P1]!.hand[0]!;
    state = fold(state, { type: "DamageDealt", sourceId: cardId, targetId: cardId, amount: 3, bonus: 0 });
    expect(state.cards[cardId]!.damage).toBe(3);
    const query = createRulesQuery(state, catalog);
    const result = runCleanup(state, P1, query, catalog, catalog.programs());
    expect(result.state.cards[cardId]!.damage).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @thejokersthief/riftbound-engine test -- cleanup-damage`
Expected: FAIL — damage stays at 3.

- [ ] **Step 3: Implement the reset**

In `packages/engine/src/turn/cleanup.ts`, inside `runCleanup`, just before the final `return { state, events: allEvents };`, add:

```ts
  const clearedCards = { ...state.cards };
  for (const id of Object.keys(clearedCards) as (keyof typeof clearedCards)[]) {
    const card = clearedCards[id];
    if (card && card.damage !== 0) {
      clearedCards[id] = { ...card, damage: 0 };
    }
  }
  state = { ...state, cards: clearedCards };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @thejokersthief/riftbound-engine test -- cleanup-damage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/turn/cleanup.ts packages/engine/src/__tests__/cleanup-damage.test.ts
git commit -m "feat(engine): clear card damage at end-of-turn cleanup"
git push
```

---

## Task 9: Honor pre-chosen targets in selector resolution

**Files:**
- Modify: `packages/engine/src/interpreter/selectors.ts`
- Modify: `packages/engine/src/interpreter/actions.ts`
- Test: `packages/engine/src/__tests__/selector-candidates.test.ts` (create)

This task extracts the pre-quantity candidate pipeline as an exported `selectCandidates` (used later by `legalActions`), and makes the `Deal` action prefer `frame.targets` when they are populated.

- [ ] **Step 1: Write the failing test**

Create `packages/engine/src/__tests__/selector-candidates.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { selectCandidates } from "../interpreter/selectors.js";
import type { SelectorNode } from "@thejokersthief/riftbound-effect-ir";
import { toPlayerId, toCardDefId, toMatchId } from "@thejokersthief/riftbound-protocol";
import { createGame, createRulesQuery } from "../index.js";
import { createCardCatalog, defaultSnapshotSource } from "@thejokersthief/riftbound-card-catalog";
import type { DeckConfig } from "../match/state.js";

const P1 = toPlayerId("p1");
const P2 = toPlayerId("p2");
function deck(): DeckConfig {
  return {
    legendId: toCardDefId("ogs-017-024"),
    championId: toCardDefId("ogs-021-024"),
    battlefields: [toCardDefId("unl-t01"), toCardDefId("unl-t03"), toCardDefId("unl-205-219")],
    mainDeck: Array(40).fill(toCardDefId("ogn-001-298")),
    runeDeck: Array(10).fill(toCardDefId("ogn-007-298")),
  };
}

describe("selectCandidates", () => {
  it("returns all matching cards ignoring quantity", async () => {
    const catalog = await createCardCatalog(defaultSnapshotSource);
    const state = createGame({ players: [P1, P2], decks: { [P1]: deck(), [P2]: deck() }, seed: 1, matchId: toMatchId("m1") });
    const query = createRulesQuery(state, catalog);
    const sourceId = state.players[P1]!.hand[0]!;
    const selector: SelectorNode = {
      scope: "Any",
      objectType: "Card",
      location: { type: "InHand" },
      filters: [],
      quantity: { type: "One" },
      chooser: "You",
    };
    const candidates = selectCandidates(selector, state, sourceId, query, catalog);
    // Both players hold 5 cards; "One" quantity must NOT limit selectCandidates.
    expect(candidates.length).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @thejokersthief/riftbound-engine test -- selector-candidates`
Expected: FAIL — `selectCandidates` not exported.

- [ ] **Step 3: Refactor `resolveSelector` to expose `selectCandidates`**

In `packages/engine/src/interpreter/selectors.ts`, change `resolveSelector` so steps 1–4 live in a new exported function and step 5 (quantity) stays in `resolveSelector`:

```ts
export function selectCandidates(
  selector: SelectorNode,
  state: GameState,
  sourceId: CardId,
  query: RulesQuery,
  catalog: CardCatalog,
): CardId[] {
  // (Move the existing Step 1–Step 4 bodies — scope, objectType, location,
  //  filters — verbatim into here and return the `filtered` array.)
  // ... existing scope/typed/located/filtered logic ...
  return filtered;
}

export function resolveSelector(
  selector: SelectorNode,
  state: GameState,
  sourceId: CardId,
  query: RulesQuery,
  catalog: CardCatalog,
): CardId[] {
  const filtered = selectCandidates(selector, state, sourceId, query, catalog);
  const qty = selector.quantity;
  switch (qty.type) {
    case "All":
      return filtered;
    case "One":
      return filtered.slice(0, 1);
    case "UpTo":
      return filtered.slice(0, qty.count);
    case "Exactly":
      return filtered.length >= qty.count ? filtered.slice(0, qty.count) : [];
  }
}
```

(The `sourceCard`/`sourceOwner` locals used by Step 1 move into `selectCandidates`.)

- [ ] **Step 4: Make `Deal` honor `frame.targets` and apply lethality**

In `packages/engine/src/interpreter/actions.ts`, replace the entire `case "Deal": { ... }` block with:

```ts
    case "Deal": {
      const targets =
        frame.targets.length > 0
          ? frame.targets
          : resolveSelector(node.targets, state, frame.sourceId, query, catalog);
      const events: GameEvent[] = [];
      let s = state;
      for (const targetId of targets) {
        const amount = evalNumberExpr(node.amount, s, frame.sourceId, query, catalog);
        const bonus = node.bonus
          ? evalNumberExpr(node.bonus, s, frame.sourceId, query, catalog)
          : 0;
        const dmg: GameEvent = {
          type: "DamageDealt",
          sourceId: frame.sourceId,
          targetId,
          amount,
          bonus,
        };
        events.push(dmg);
        s = fold(s, dmg);
        // Lethality — same rule as combat/resolution.ts: might 0 with any damage,
        // or accumulated damage >= might. Emit CardKilled so fold trashes the unit.
        const might = query.mightOf(targetId);
        const total = s.cards[targetId]?.damage ?? 0;
        const lethal = (might === 0 && total > 0) || (might > 0 && total >= might);
        if (lethal) {
          const kill: GameEvent = { type: "CardKilled", cardId: targetId };
          events.push(kill);
          s = fold(s, kill);
        }
      }
      return { state: s, events };
    }
```

- [ ] **Step 5: Add a lethality unit test**

Append to `packages/engine/src/__tests__/selector-candidates.test.ts` (it already builds a game + catalog):

```ts
import { executeAction } from "../interpreter/actions.js";
import type { EffectFrame } from "../state/stack.js";

describe("Deal lethality", () => {
  it("kills a target whose accumulated damage reaches its might and trashes it", async () => {
    const catalog = await createCardCatalog(defaultSnapshotSource);
    let state = createGame({ players: [P1, P2], decks: { [P1]: deck(), [P2]: deck() }, seed: 1, matchId: toMatchId("m1") });
    // Place an enemy unit on a battlefield and pre-damage it to (might - 1).
    const enemy = Object.values(state.cards).find((c) => c!.ownerId === P2 && catalog.find(c!.defId)?.cardType === "Unit")!.id;
    const bfId = Object.keys(state.battlefields)[0]! as keyof typeof state.battlefields;
    state = { ...state, battlefields: { ...state.battlefields, [bfId]: { ...state.battlefields[bfId]!, units: [enemy] } } };
    const query = createRulesQuery(state, catalog);
    const might = query.mightOf(enemy);
    const source = Object.values(state.cards).find((c) => c!.ownerId === P1)!.id;
    const frame: EffectFrame = { type: "Effect", sourceId: source, controller: P1, remaining: [], targets: [enemy] };
    const node = { type: "Deal" as const, amount: might, targets: { scope: "Enemy" as const, objectType: "Unit" as const, location: { type: "AtBattlefields" as const }, filters: [], quantity: { type: "One" as const }, chooser: "You" as const } };
    const result = executeAction(node, frame, state, query, catalog);
    expect(result.events.some((e) => e.type === "CardKilled")).toBe(true);
    expect(result.state.players[P2]!.trash).toContain(enemy);
  });
});
```

> This requires `mightOf(enemy) > 0` for the seeded unit. `ogn-001-298` has a non-null might; if it is 0, pick a different unit defId in `deck()` with a positive might (any `Unit` in `cards.json` with `"might"` ≥ 1).

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @thejokersthief/riftbound-engine test -- selector-candidates`
Expected: PASS (both `selectCandidates` and `Deal lethality`).

- [ ] **Step 7: Run the full engine suite (resolveSelector is widely used)**

Run: `pnpm --filter @thejokersthief/riftbound-engine test`
Expected: PASS — `resolveSelector` behavior is unchanged for all existing callers. Combat already kills via `CardKilled`; the new lethality in `Deal` is additive and should not affect combat tests.

- [ ] **Step 8: Commit**

```bash
git add packages/engine/src/interpreter/selectors.ts packages/engine/src/interpreter/actions.ts packages/engine/src/__tests__/selector-candidates.test.ts
git commit -m "feat(engine): expose selectCandidates; Deal honors targets and applies lethality"
git push
```

---

## Task 10: Make `advance()` a unified driver over Effect and Chain frames

**Files:**
- Modify: `packages/engine/src/chain/index.ts`
- Test: `packages/engine/src/__tests__/advance-chain.test.ts` (create)

Currently `advance()` drains HOT then steps only Effect frames; a `ChainFrame` left on top is never pumped. This task loops: drain HOT, then pump the top frame — `step` for Effect frames, `feprStep` for Chain frames — until a `pendingDecision` is set or the top frame is neither (empty / Decision / Combat).

- [ ] **Step 1: Write the failing test**

Create `packages/engine/src/__tests__/advance-chain.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { toPlayerId, toCardDefId, toMatchId } from "@thejokersthief/riftbound-protocol";
import { createGame, createRulesQuery, fold } from "../index.js";
import { advance } from "../chain/index.js";
import { createCardCatalog, defaultSnapshotSource } from "@thejokersthief/riftbound-card-catalog";
import type { DeckConfig } from "../match/state.js";
import type { ChainItem } from "../state/types.js";

const P1 = toPlayerId("p1");
const P2 = toPlayerId("p2");
function deck(): DeckConfig {
  return {
    legendId: toCardDefId("ogs-017-024"),
    championId: toCardDefId("ogs-021-024"),
    battlefields: [toCardDefId("unl-t01"), toCardDefId("unl-t03"), toCardDefId("unl-205-219")],
    mainDeck: Array(40).fill(toCardDefId("ogn-001-298")),
    runeDeck: Array(10).fill(toCardDefId("ogn-007-298")),
  };
}

describe("advance() drives a Chain frame", () => {
  function craftChain(state: GameState, resumeAt: "Execute" | "Resolve", priority = P2) {
    const sourceId = state.players[P1]!.hand[0]!;
    const defId = state.cards[sourceId]!.defId;
    const item: ChainItem = { id: "ci1", sourceId, defId, controller: P1, targets: [], resolved: false };
    state = fold(state, { type: "ChainOpened" });
    return {
      ...state,
      chain: { ...state.chain, items: [item], priority },
      resolutionStack: [{ type: "Chain" as const, resumeAt }],
    } as GameState;
  }

  it("in Execute, yields a PriorityWindow for the priority holder", async () => {
    const catalog = await createCardCatalog(defaultSnapshotSource);
    let state = createGame({ players: [P1, P2], decks: { [P1]: deck(), [P2]: deck() }, seed: 1, matchId: toMatchId("m1") });
    state = craftChain(state, "Execute", P2);
    const query = createRulesQuery(state, catalog);
    const result = advance(state, query, catalog, catalog.programs());
    expect(result.state.pendingDecision?.type).toBe("PriorityWindow");
    if (result.state.pendingDecision?.type === "PriorityWindow") {
      expect(result.state.pendingDecision.playerId).toBe(P2);
    }
    // The Chain frame is still on the stack, parked on the decision.
    expect(result.state.resolutionStack.at(-1)?.type).toBe("Chain");
  });

  it("in Resolve, drains the chain item and closes the chain", async () => {
    const catalog = await createCardCatalog(defaultSnapshotSource);
    let state = createGame({ players: [P1, P2], decks: { [P1]: deck(), [P2]: deck() }, seed: 1, matchId: toMatchId("m1") });
    state = craftChain(state, "Resolve", P2);
    const query = createRulesQuery(state, catalog);
    const result = advance(state, query, catalog, catalog.programs());
    expect(result.state.resolutionStack.length).toBe(0);
    expect(result.state.chain.isOpen).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @thejokersthief/riftbound-engine test -- advance-chain`
Expected: FAIL — the Chain frame is left on the stack (advance never pumps it).

- [ ] **Step 3: Add a shared `drainEffectFrames` helper (DRY)**

The "step until the top frame is no longer an Effect" loop currently exists in both `advance` and `feprStep`. Factor it once. In `packages/engine/src/interpreter/index.ts`, add:

```ts
import type { RulesQuery } from "../rules-query/index.js";

// Step the interpreter while the top frame is an Effect frame and no decision
// is pending. Returns the drained state and the events emitted.
export function drainEffectFrames(
  state: GameState,
  query: RulesQuery,
  catalog: CardCatalog,
): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  let stepResult = step(state, query, catalog);
  while (
    stepResult.state.pendingDecision === null &&
    stepResult.state.resolutionStack.length > 0 &&
    stepResult.state.resolutionStack[stepResult.state.resolutionStack.length - 1]?.type === "Effect"
  ) {
    events.push(...stepResult.events);
    state = stepResult.state;
    stepResult = step(state, query, catalog);
  }
  events.push(...stepResult.events);
  return { state: stepResult.state, events };
}
```

(`GameState`, `GameEvent`, `CardCatalog`, and `step` are already in scope in this file.)

- [ ] **Step 4: Rewrite `advance()` as a unified driver with a real progress guard**

In `packages/engine/src/chain/index.ts`, add `import { feprStep } from "./fepr.js";` and `import { drainEffectFrames } from "../interpreter/index.js";` to the imports and replace the body of `advance` with:

```ts
export function advance(
  state: GameState,
  query: RulesQuery,
  catalog: CardCatalog,
  programs: ReadonlyMap<string, EffectProgram> = new Map(),
): { state: GameState; events: GameEvent[] } {
  if (state.pendingDecision !== null) {
    return { state, events: [] };
  }

  const allEvents: GameEvent[] = [];

  // Drive the resolution stack: drain HOT, then pump the top frame.
  // Effect frames step via the interpreter; Chain frames via FEPR.
  // Progress is detected by a signal (stack depth, top-frame resume state,
  // resolved-item count, pending decision) — NOT object identity, because
  // feprStep allocates a fresh state object on every call.
  const progressSignal = (s: GameState): string => {
    const top = s.resolutionStack[s.resolutionStack.length - 1];
    const topTag = top ? (top.type === "Chain" ? `Chain:${top.resumeAt}` : top.type) : "none";
    const resolved = s.chain.items.filter((i) => i.resolved).length;
    return `${s.resolutionStack.length}|${topTag}|${resolved}|${s.pendingDecision?.type ?? "none"}`;
  };

  for (let guard = 0; guard < 10_000; guard++) {
    const hotResult = drainHot(state, query, catalog, programs);
    state = hotResult.state;
    allEvents.push(...hotResult.events);
    if (state.pendingDecision !== null) break;

    const top = state.resolutionStack[state.resolutionStack.length - 1];
    if (!top) break;

    const before = progressSignal(state);

    if (top.type === "Effect") {
      const r = drainEffectFrames(state, query, catalog);
      allEvents.push(...r.events);
      state = r.state;
    } else if (top.type === "Chain") {
      const r = feprStep(state, query, catalog, programs);
      allEvents.push(...r.events);
      state = r.state;
    } else {
      // Decision / Combat frame — not driven here.
      break;
    }

    if (state.pendingDecision !== null) break;
    if (progressSignal(state) === before) break; // no progress — avoid spin
  }

  return { state, events: allEvents };
}
```

Note: `feprStep` is already re-exported at the bottom of this file; keep that re-export and add the direct `import { feprStep }` at the top so it can be called.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @thejokersthief/riftbound-engine test -- advance-chain`
Expected: PASS (both `Execute`→PriorityWindow and `Resolve`→close). Ensure the test file imports `GameState`: `import type { ChainItem, GameState } from "../state/types.js";`.

- [ ] **Step 6: Run the full engine suite**

Run: `pnpm --filter @thejokersthief/riftbound-engine test`
Expected: PASS — no existing code pushes Chain frames, so prior behavior is unchanged. `drainEffectFrames` is new; existing `step`-loop callers are untouched.

- [ ] **Step 7: Commit**

```bash
git add packages/engine/src/chain/index.ts packages/engine/src/interpreter/index.ts packages/engine/src/__tests__/advance-chain.test.ts
git commit -m "feat(engine): advance() drives Effect and Chain frames via shared drainEffectFrames"
git push
```

---

## Task 11: Send a resolved spell to its owner's trash

**Files:**
- Modify: `packages/engine/src/chain/fepr.ts`
- Test: `packages/engine/src/__tests__/advance-chain.test.ts` (extend)

When a chain item resolves and its source card is a `Spell`, the spell goes to its owner's trash. `feprStep` has the `catalog`, so it can check `cardType` and fold a `CardMoved` to `discard-<owner>` (which Task 6 routes to `trash`). **This must happen for every resolved Spell item — including those whose program is `Unparsed` or has only `Static` abilities** (which take `feprStep`'s early "mark resolved" branch and never reach the effect-push code), or the spell would silently vanish (removed from hand, landing nowhere).

- [ ] **Step 1: Write the failing test (append) — craft a Spell instance directly**

```ts
it("sends a resolved Spell source to its owner's trash (even with no parsed ability)", async () => {
  const catalog = await createCardCatalog(defaultSnapshotSource);
  let state = createGame({ players: [P1, P2], decks: { [P1]: deck(), [P2]: deck() }, seed: 1, matchId: toMatchId("m1") });
  // The seeded decks contain no Spell instance, so re-tag an owned card instance
  // as a Spell defId taken from the catalog. This guarantees the path is exercised.
  const spellDef = catalog.all().find((d) => d.cardType === "Spell");
  expect(spellDef).toBeDefined();
  const cardId = state.players[P1]!.hand[0]!;
  state = { ...state, cards: { ...state.cards, [cardId]: { ...state.cards[cardId]!, defId: spellDef!.id } } };
  // Remove from hand so it is "in flight" like a played spell.
  state = fold(state, { type: "CardPlayed", playerId: P1, cardId });
  const item: ChainItem = { id: "ci1", sourceId: cardId, defId: spellDef!.id, controller: P1, targets: [], resolved: false };
  state = fold(state, { type: "ChainOpened" });
  state = { ...state, chain: { ...state.chain, items: [item] }, resolutionStack: [{ type: "Chain" as const, resumeAt: "Resolve" }] };
  const query = createRulesQuery(state, catalog);
  const result = advance(state, query, catalog, catalog.programs());
  expect(result.state.players[P1]!.trash).toContain(cardId);
});
```

(Add `fold` and `ChainItem` to this file's imports if not already present.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @thejokersthief/riftbound-engine test -- advance-chain`
Expected: FAIL — the resolved spell is not moved to trash.

- [ ] **Step 3: Implement the trash-on-resolve (unconditional, at the resolved point)**

In `packages/engine/src/chain/fepr.ts`, in the `case "Resolve":` block, the spell-to-trash move must run for **every** resolved Spell item, regardless of whether it had a non-Static ability. Place it immediately after the item is marked `resolved: true` (i.e. covering BOTH the `!program || Unparsed` early branch AND the parsed-ability branch). Extract a small local helper at the top of the `Resolve` case and call it on every resolution path before the recursive `return feprStep(...)`:

```ts
      // declared once at the top of the "Resolve" case
      const trashIfSpell = (s: GameState): GameState => {
        const sourceDef = catalog.find(unresolved.defId);
        if (sourceDef?.cardType !== "Spell") return s;
        const owner = s.cards[unresolved.sourceId]?.ownerId;
        if (!owner) return s;
        const moveEvent: GameEvent = {
          type: "CardMoved",
          cardId: unresolved.sourceId,
          fromZone: toZoneId("inflight"),
          toZone: toZoneId(`discard-${owner}`),
        };
        allEvents.push(moveEvent);
        return fold(s, moveEvent);
      };
```

Then in the `!program || program.type === "Unparsed"` branch, after marking the item resolved and before `return feprStep(...)`, do `state = trashIfSpell(state);`. And in the parsed-ability branch, after the inner effect step-loop completes (after `state = stepResult.state;`), do `state = trashIfSpell(state);`.

Add `import { toZoneId } from "@thejokersthief/riftbound-protocol";` to the imports if not already present, and ensure `fold` is imported (it is).

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @thejokersthief/riftbound-engine test -- advance-chain`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/chain/fepr.ts packages/engine/src/__tests__/advance-chain.test.ts
git commit -m "feat(engine): resolved spell source moves to owner trash"
git push
```

---

## Task 12: `PlayCard` resolution + chain priority

**Files:**
- Modify: `packages/engine/src/index.ts` (submit)
- Modify: `packages/engine/src/rules-query/timing.ts` (allow Spell in Main without an already-open chain)
- Test: `packages/engine/src/__tests__/playcard-resolution.test.ts` (create)

This is the central task. `submit` builds the `programs` map once and threads it through every `advance`/`advanceTurn` call. `PlayCard`:
- **Unit/Gear:** pay cost, `CardPlayed`, `CardMoved` → base, collect `CardPlayed` triggers, then `advance`.
- **Spell:** pay cost, `CardPlayed`, open the chain if closed, push a `ChainItem`, push a `ChainFrame{resumeAt:"Execute"}`, set `chain.priority` to the opponent with `passes = 0`, then `advance` (which yields a `PriorityWindow`).

Priority on `PassPriority`: increment `chain.passes`; if `< playerIds.length` flip priority and re-issue (drive `advance`, which re-enters `feprStep` `Execute`); if all have passed, set the `ChainFrame` to `resumeAt:"Pass"` and `advance` (resolves the chain).

- [ ] **Step 1: Allow a Spell to be played in Main phase**

In `packages/engine/src/rules-query/timing.ts`, change the `Spell` case so a spell may be played in Main regardless of whether a chain is already open (playing it opens the chain):

```ts
    case "Spell":
      // Main phase. Playing a spell opens the chain if one is not already open.
      return state.phase === "Main";
```

- [ ] **Step 2: Write the failing test**

Create `packages/engine/src/__tests__/playcard-resolution.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { toPlayerId, toCardDefId, toMatchId } from "@thejokersthief/riftbound-protocol";
import { createGame, submit, createRulesQuery, runStartPhase, runChannelPhase, startMainPhase } from "../index.js";
import { createCardCatalog, defaultSnapshotSource } from "@thejokersthief/riftbound-card-catalog";
import type { DeckConfig } from "../match/state.js";
import type { GameState } from "../state/types.js";

const P1 = toPlayerId("p1");
const P2 = toPlayerId("p2");
function deck(): DeckConfig {
  return {
    legendId: toCardDefId("ogs-017-024"),
    championId: toCardDefId("ogs-021-024"),
    battlefields: [toCardDefId("unl-t01"), toCardDefId("unl-t03"), toCardDefId("unl-205-219")],
    mainDeck: Array(40).fill(toCardDefId("ogn-001-298")),
    runeDeck: Array(10).fill(toCardDefId("ogn-007-298")),
  };
}

function toMain(state: GameState, catalog: Awaited<ReturnType<typeof createCardCatalog>>): GameState {
  const query = createRulesQuery(state, catalog);
  state = runStartPhase(state, query).state;
  state = runChannelPhase(state).state;
  state = startMainPhase(state).state;
  return state;
}

describe("PlayCard resolution", () => {
  it("a played unit leaves hand and enters base", async () => {
    const catalog = await createCardCatalog(defaultSnapshotSource);
    let state = createGame({ players: [P1, P2], decks: { [P1]: deck(), [P2]: deck() }, seed: 1, matchId: toMatchId("m1") });
    state = submit(state, { type: "KeepHand", playerId: state.activePlayerId }, catalog).state;
    const active = state.activePlayerId;
    state = toMain(state, catalog);
    // ogn-001-298 is a Unit. Find a unit card in hand.
    const unitCardId = state.players[active]!.hand.find(
      (id) => catalog.find(state.cards[id]!.defId)?.cardType === "Unit",
    );
    expect(unitCardId).toBeDefined();
    const result = submit(state, { type: "PlayCard", playerId: active, cardId: unitCardId!, targets: undefined }, catalog);
    expect(result.state.players[active]!.hand).not.toContain(unitCardId);
    expect(result.state.players[active]!.base).toContain(unitCardId);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @thejokersthief/riftbound-engine test -- playcard-resolution`
Expected: FAIL — the unit stays in hand (PlayCard only emits CardPlayed today).

- [ ] **Step 4: Build the programs map and thread it through `submit`**

In `packages/engine/src/index.ts`, add imports:

```ts
import { collectTriggers } from "./chain/hot.js";
import { toZoneId, toDecisionId } from "@thejokersthief/riftbound-protocol";
```

(Keep existing imports; merge `toZoneId`/`toDecisionId` into the existing `@thejokersthief/riftbound-protocol` value import line.)

In `submit`, immediately after `const query = createRulesQuery(state, catalog);` (the one before the main `switch`), add:

```ts
  const programs = catalog.programs();
```

Update the existing handlers to pass `programs`:

```ts
    case "EndTurn": {
      return advanceTurn(state, query, catalog, programs);
    }

    case "PassPriority": {
      return passPriority(state, action.playerId, query, catalog, programs);
    }

    case "PassFocus": {
      return advance(state, query, catalog, programs);
    }
```

(`ActivateAbility`, `ChooseYesNo`, `ChooseOne`, `AssignDamage` cases: add `programs` as the 4th argument to their `advance(...)` calls.)

- [ ] **Step 5: Implement the `PlayCard` case**

Replace the existing `case "PlayCard": { ... }` body with:

```ts
    case "PlayCard": {
      const playerId = action.playerId;
      const cardId = action.cardId;
      if (!query.canBePlayed(cardId, playerId)) {
        return { state, events: [] };
      }
      const def = catalog.find(state.cards[cardId]!.defId);
      const cost = def?.playCost;

      const events: GameEvent[] = [];
      let s = state;

      // Pay cost (energy/power are signed deltas).
      if (cost) {
        const pay: GameEvent = {
          type: "ResourceAdded",
          playerId,
          energy: -cost.energy,
          power: -cost.power,
        };
        s = fold(s, pay);
        events.push(pay);
      }

      // Leave hand.
      const played: GameEvent = { type: "CardPlayed", playerId, cardId };
      s = fold(s, played);
      events.push(played);

      if (def?.cardType === "Spell") {
        // Spell → chain item, resolved via priority passing.
        if (!s.chain.isOpen) {
          const opened: GameEvent = { type: "ChainOpened" };
          s = fold(s, opened);
          events.push(opened);
        }
        const opponent = s.playerIds[0] === playerId ? s.playerIds[1] : s.playerIds[0];
        const item = {
          id: `ci_${Math.random().toString(36).slice(2, 9)}`,
          sourceId: cardId,
          defId: state.cards[cardId]!.defId,
          controller: playerId,
          targets: action.targets?.targets ?? [],
          resolved: false,
        };
        s = {
          ...s,
          chain: { ...s.chain, items: [...s.chain.items, item], priority: opponent, passes: 0 },
          resolutionStack: [...s.resolutionStack, { type: "Chain", resumeAt: "Execute" }],
        };
        const q = createRulesQuery(s, catalog);
        const adv = advance(s, q, catalog, programs);
        return { state: adv.state, events: [...events, ...adv.events] };
      }

      // Unit / Gear → enter base, then collect WhenPlayed/WhenEntersPlay triggers.
      const moved: GameEvent = {
        type: "CardMoved",
        cardId,
        fromZone: toZoneId("hand"),
        toZone: toZoneId("base"),
      };
      s = fold(s, moved);
      events.push(moved);

      const q = createRulesQuery(s, catalog);
      s = collectTriggers(s, [played], programs, catalog, q);
      const adv = advance(s, q, catalog, programs);
      return { state: adv.state, events: [...events, ...adv.events] };
    }
```

> Note on `action.targets`: `PlayCardAction.targets` is `TargetSelection | undefined`, where `TargetSelection = { targets: CardId[] }` (`protocol/src/actions.ts:4` — the field is `targets`, NOT `cardIds`). This slice reads `action.targets?.targets`; if absent, targeting is handled by the `ChooseTargets` flow in Task 13.

- [ ] **Step 6: Add the `passPriority` helper**

At the bottom of `packages/engine/src/index.ts` (after `legalActions`), add:

```ts
function passPriority(
  state: GameState,
  playerId: PlayerId,
  query: ReturnType<typeof createRulesQuery>,
  catalog: CardCatalog,
  programs: ReadonlyMap<string, import("@thejokersthief/riftbound-effect-ir").EffectProgram>,
): { state: GameState; events: GameEvent[] } {
  const top = state.resolutionStack[state.resolutionStack.length - 1];
  // No chain in progress → passing is a no-op (legacy behavior).
  if (!top || top.type !== "Chain") {
    return advance(state, query, catalog, programs);
  }

  const passes = state.chain.passes + 1;
  const playerCount = state.playerIds.length;

  if (passes < playerCount) {
    // Flip priority to the other player and re-issue the priority window.
    const next = state.chain.priority === state.playerIds[0] ? state.playerIds[1] : state.playerIds[0];
    const reissued: GameState = {
      ...state,
      pendingDecision: null,
      chain: { ...state.chain, passes, priority: next },
      resolutionStack: [
        ...state.resolutionStack.slice(0, -1),
        { type: "Chain", resumeAt: "Execute" },
      ],
    };
    const q = createRulesQuery(reissued, catalog);
    return advance(reissued, q, catalog, programs);
  }

  // All players have passed → resolve the chain.
  const resolving: GameState = {
    ...state,
    pendingDecision: null,
    chain: { ...state.chain, passes },
    resolutionStack: [
      ...state.resolutionStack.slice(0, -1),
      { type: "Chain", resumeAt: "Pass" },
    ],
  };
  const q = createRulesQuery(resolving, catalog);
  return advance(resolving, q, catalog, programs);
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm --filter @thejokersthief/riftbound-engine test -- playcard-resolution`
Expected: PASS (unit enters base).

- [ ] **Step 8: Run the full engine suite**

Run: `pnpm --filter @thejokersthief/riftbound-engine test`
Expected: PASS. The example/facade tests that submit `PlayCard` + `PassPriority` now route through real resolution; if a test asserted the old no-op `PlayCard` (card stays in hand), update it to expect hand removal / base entry.

- [ ] **Step 9: Commit**

```bash
git add packages/engine/src/index.ts packages/engine/src/rules-query/timing.ts packages/engine/src/__tests__/playcard-resolution.test.ts
git commit -m "feat(engine): PlayCard resolves through chain with priority passing"
git push
```

---

## Task 13: Target selection for chain items

**Files:**
- Modify: `packages/engine/src/index.ts` (`legalActions` + `submit` `ChooseTargets`)
- Modify: `packages/engine/src/interpreter/index.ts` (export a target-selector helper)
- Test: `packages/engine/src/__tests__/targeting.test.ts` (create)

When a played spell's first non-`Static` ability targets with `chooser` `You`/`Opponent` and more than one candidate exists, the player must choose before the chain resolves. The chosen targets are written onto the `ChainItem`; `feprStep` already passes `item.targets` into the `EffectFrame`, and Task 9 made `Deal` honor them.

Mechanism: after a spell is played (Task 12), if its item needs a target choice, `submit` sets a `ChooseTargets` `pendingDecision` instead of yielding the priority window. `legalActions` enumerates one `ChooseTargets` action per candidate. `submit(ChooseTargets)` writes the chosen targets onto the unresolved item, clears the decision, sets priority to the opponent, and `advance`s to the priority window.

- [ ] **Step 1: Add a target-selector helper to the interpreter**

In `packages/engine/src/interpreter/index.ts`, add:

```ts
import type { EffectNode, SelectorNode, AbilityNode, EffectProgram } from "@thejokersthief/riftbound-effect-ir";

// The single target selector this slice supports choosing for.
export function targetSelectorOf(node: EffectNode): SelectorNode | null {
  if (node.type === "Deal") return node.targets;
  return null;
}

// The first effect node of a program's first non-Static ability.
export function firstEffectNode(ability: AbilityNode): EffectNode | null {
  if (ability.type === "Static") return null;
  return ability.effect.type === "Sequence" ? (ability.effect.effects[0] ?? null) : ability.effect;
}

// Shared lookup: given a chain item's program, the target selector the
// controller must choose for (or null if none). Used by both legalActions
// and the PlayCard spell branch — keep it in one place so they cannot drift.
// NOTE: only the FIRST effect node of the first non-Static ability is inspected
// this slice; later/Sequence targeting nodes are out of scope (see self-review).
export function chainItemTargetSelector(program: EffectProgram | undefined): SelectorNode | null {
  if (!program || program.type !== "Compiled") return null;
  const ability = program.abilities.find((a) => a.type !== "Static");
  if (!ability) return null;
  const effect = firstEffectNode(ability);
  return effect ? targetSelectorOf(effect) : null;
}
```

(Keep the existing exports in this file.)

- [ ] **Step 2: Write the failing test**

Create `packages/engine/src/__tests__/targeting.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { toPlayerId, toCardDefId, toMatchId } from "@thejokersthief/riftbound-protocol";
import { createGame, submit, fold } from "../index.js";
import { createCardCatalog, defaultSnapshotSource } from "@thejokersthief/riftbound-card-catalog";
import type { GameState } from "../state/types.js";

// A hand-built catalog stub: one Spell that deals 2 to a chosen enemy unit.
// (Built via the program source in real runs; here we assert the decision flow
// using a state we craft directly.)

const P1 = toPlayerId("p1");
const P2 = toPlayerId("p2");

describe("target selection for a damage spell", () => {
  it("offers one ChooseTargets action per candidate, then applies the chosen target", async () => {
    const catalog = await createCardCatalog(defaultSnapshotSource);
    // Build a minimal state: P1 has a pending ChooseTargets created by playing a
    // spell whose item needs a target among two enemy units.
    // This test exercises legalActions + submit(ChooseTargets) on a crafted state.
    let state = createGame({
      players: [P1, P2],
      decks: {
        [P1]: { legendId: toCardDefId("ogs-017-024"), championId: toCardDefId("ogs-021-024"), battlefields: [toCardDefId("unl-t01"), toCardDefId("unl-t03"), toCardDefId("unl-205-219")], mainDeck: Array(40).fill(toCardDefId("ogn-001-298")), runeDeck: Array(10).fill(toCardDefId("ogn-007-298")) },
        [P2]: { legendId: toCardDefId("ogs-019-024"), championId: toCardDefId("ogs-023-024"), battlefields: [toCardDefId("unl-206-219"), toCardDefId("sfd-207-221"), toCardDefId("unl-207-219")], mainDeck: Array(40).fill(toCardDefId("ogn-001-298")), runeDeck: Array(10).fill(toCardDefId("ogn-007-298")) },
      },
      seed: 1,
      matchId: toMatchId("m1"),
    });
    state = submit(state, { type: "KeepHand", playerId: state.activePlayerId }, catalog).state;

    // The end-to-end behavior is fully exercised in Task 14. Here we assert the
    // decision-enumeration contract holds on a crafted ChooseTargets decision.
    const decisionId = "dec_test";
    const enemyA = Object.values(state.cards).find((c) => c!.ownerId === P2)!.id;
    const enemyB = Object.values(state.cards).filter((c) => c!.ownerId === P2)[1]!.id;
    const bfId = Object.keys(state.battlefields)[0]!;
    state = {
      ...state,
      battlefields: { ...state.battlefields, [bfId]: { ...state.battlefields[bfId as keyof typeof state.battlefields]!, units: [enemyA, enemyB] } },
    } as GameState;

    // Crafted Deal-targeting chain item + ChooseTargets decision.
    const item = { id: "ci1", sourceId: Object.values(state.cards).find((c) => c!.ownerId === P1)!.id, defId: toCardDefId("ogn-001-298"), controller: P1, targets: [], resolved: false };
    state = fold(state, { type: "ChainOpened" });
    state = {
      ...state,
      chain: { ...state.chain, items: [item] },
      resolutionStack: [{ type: "Chain", resumeAt: "Execute" }],
      pendingDecision: { type: "ChooseTargets", playerId: P1, decisionId, prompt: "Choose a target", min: 1, max: 1 },
    } as GameState;

    // submit(ChooseTargets) must (a) write the chosen target onto the unresolved
    // item, and (b) clear the ChooseTargets decision (advancing to the priority window).
    const chosen = enemyA;
    const result = submit(state, { type: "ChooseTargets", playerId: P1, decisionId, targets: [chosen] }, catalog);
    const item1 = result.state.chain.items.find((i) => i.id === "ci1");
    expect(item1?.targets).toContain(chosen);
    expect(result.state.pendingDecision?.type).not.toBe("ChooseTargets");
  });
});
```

> This task's test is intentionally light on enumeration specifics (the seeded catalog's `ogn-001-298` is a Unit with a Static ability, not a clean damage spell). The **authoritative** end-to-end targeting assertion lives in Task 14, which builds a custom catalog with a known "deal 2 to an enemy unit" spell. This test only pins the `submit(ChooseTargets)` contract: it clears the decision and advances.

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @thejokersthief/riftbound-engine test -- targeting`
Expected: FAIL — `submit(ChooseTargets)` currently pops the stack and discards targets (and may throw or leave the decision).

- [ ] **Step 4: Enumerate `ChooseTargets` in `legalActions`**

In `packages/engine/src/index.ts`, replace the `case "ChooseTargets":` block inside the `pendingDecision` branch of `legalActions` with:

```ts
      case "ChooseTargets": {
        const item = state.chain.items.find((i) => !i.resolved && i.controller === playerId);
        const selector = item ? chainItemTargetSelector(catalog.programs().get(item.defId)) : null;
        if (!item || !selector) {
          return [{ type: "ChooseTargets", playerId, decisionId: decision.decisionId, targets: [] }];
        }
        const candidates = selectCandidates(selector, state, item.sourceId, query, catalog);
        return candidates.map((id) => ({
          type: "ChooseTargets" as const,
          playerId,
          decisionId: decision.decisionId,
          targets: [id],
        }));
      }
```

Add imports at the top of `index.ts`:

```ts
import { selectCandidates } from "./interpreter/selectors.js";
import { chainItemTargetSelector } from "./interpreter/index.js";
```

- [ ] **Step 5: Handle `ChooseTargets` in `submit`**

In `packages/engine/src/index.ts`, split `ChooseTargets` out of the grouped case and implement:

```ts
    case "ChooseTargets": {
      const items = state.chain.items.map((i) =>
        !i.resolved && i.controller === action.playerId && i.targets.length === 0
          ? { ...i, targets: action.targets }
          : i,
      );
      const opponent = state.playerIds[0] === action.playerId ? state.playerIds[1] : state.playerIds[0];
      const next: GameState = {
        ...state,
        pendingDecision: null,
        chain: { ...state.chain, items, priority: opponent, passes: 0 },
      };
      return advance(next, createRulesQuery(next, catalog), catalog, programs);
    }
```

Keep `ChooseYesNo` / `ChooseOne` in their existing grouped case (unchanged behavior).

- [ ] **Step 6: Issue `ChooseTargets` when a played spell needs a target**

Back in the `PlayCard` Spell branch (Task 12, Step 5), after pushing the `ChainFrame` and before calling `advance`, insert a check: if the item needs a target choice, set a `ChooseTargets` decision instead of advancing to the priority window. Replace the Spell branch's tail (`const q = createRulesQuery(s, catalog); const adv = advance(...)`) with:

```ts
        const selector = chainItemTargetSelector(programs.get(item.defId));
        if (selector && (selector.chooser === "You" || selector.chooser === "Opponent")) {
          const q2 = createRulesQuery(s, catalog);
          const candidates = selectCandidates(selector, s, cardId, q2, catalog);
          if (candidates.length > 1) {
            const decisionId = toDecisionId(`dec_${Math.random().toString(36).slice(2, 9)}`);
            s = {
              ...s,
              pendingDecision: { type: "ChooseTargets", playerId, decisionId, prompt: "Choose a target", min: 1, max: 1 },
            };
            return { state: s, events };
          }
        }
        const q = createRulesQuery(s, catalog);
        const adv = advance(s, q, catalog, programs);
        return { state: adv.state, events: [...events, ...adv.events] };
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm --filter @thejokersthief/riftbound-engine test -- targeting`
Expected: PASS — `submit(ChooseTargets)` clears the decision and advances.

- [ ] **Step 8: Run the full engine suite**

Run: `pnpm --filter @thejokersthief/riftbound-engine test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/engine/src/index.ts packages/engine/src/interpreter/index.ts packages/engine/src/__tests__/targeting.test.ts
git commit -m "feat(engine): chain-item target selection via ChooseTargets"
git push
```

---

## Task 14: End-to-end integration tests with a curated catalog

**Files:**
- Test: `packages/engine/src/__tests__/e2e-resolution.test.ts` (create)

These tests use a **custom in-memory catalog** so the card behaviors are known exactly (independent of compiler parse quality): a Spell that deals 2 to a chosen enemy unit, and a Unit with a `WhenPlayed` `Draw 1` trigger.

- [ ] **Step 1: Write the integration tests**

Create `packages/engine/src/__tests__/e2e-resolution.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { toPlayerId, toCardDefId, toMatchId } from "@thejokersthief/riftbound-protocol";
import type { CardDefId } from "@thejokersthief/riftbound-protocol";
import type { EffectProgram } from "@thejokersthief/riftbound-effect-ir";
import { createCardCatalog } from "@thejokersthief/riftbound-card-catalog";
import type { CardDataSource, ProgramDataSource, CardDefinition } from "@thejokersthief/riftbound-card-catalog";
import {
  createGame, submit, legalActions, createRulesQuery,
  runStartPhase, runChannelPhase, startMainPhase,
} from "../index.js";
import type { GameState } from "../state/types.js";

const P1 = toPlayerId("p1");
const P2 = toPlayerId("p2");

// --- Curated definitions ---
const SPELL = toCardDefId("test-bolt");      // deal 3 to a chosen enemy unit (lethal to might-3)
const UNIT = toCardDefId("test-drawer");      // WhenPlayed: Draw 1
const VANILLA = toCardDefId("test-vanilla");  // plain unit, no abilities
const LEGEND = toCardDefId("test-legend");
const CHAMP = toCardDefId("test-champ");
const BF = toCardDefId("test-bf");
const RUNE = toCardDefId("test-rune");

function def(id: CardDefId, cardType: CardDefinition["cardType"], extra: Partial<CardDefinition> = {}): CardDefinition {
  return {
    id, name: String(id), cardType, set: "test", rarity: null, abilityText: "",
    might: cardType === "Unit" ? 3 : null,
    playCost: { energy: 0, power: 0, runes: [] },
    deckZone: cardType === "Unit" || cardType === "Spell" ? "Main" : cardType === "Rune" ? "Rune" : cardType === "Legend" ? "Legend" : cardType === "ChosenChampion" ? "Champion" : "Battlefield",
    keywords: [],
    ...extra,
  };
}

const cardSource: CardDataSource = {
  async load() {
    return [
      def(SPELL, "Spell"),
      def(UNIT, "Unit"),
      def(VANILLA, "Unit"),
      def(LEGEND, "Legend"),
      def(CHAMP, "ChosenChampion"),
      def(BF, "Battlefield"),
      def(RUNE, "Rune"),
    ];
  },
};

const boltProgram: EffectProgram = {
  type: "Compiled",
  abilities: [{
    type: "Triggered",
    event: { type: "WhenPlayed" },
    effect: {
      type: "Deal",
      amount: 3,
      targets: { scope: "Enemy", objectType: "Unit", location: { type: "AtBattlefields" }, filters: [], quantity: { type: "One" }, chooser: "You" },
    },
  }],
};

const drawerProgram: EffectProgram = {
  type: "Compiled",
  abilities: [{ type: "Triggered", event: { type: "WhenPlayed" }, effect: { type: "Draw", player: "You", count: 1 } }],
};

const programSource: ProgramDataSource = {
  async load() {
    return new Map<string, EffectProgram>([
      [SPELL, boltProgram],
      [UNIT, drawerProgram],
    ]);
  },
};

function toMain(state: GameState, catalog: Awaited<ReturnType<typeof createCardCatalog>>): GameState {
  const query = createRulesQuery(state, catalog);
  state = runStartPhase(state, query).state;
  state = runChannelPhase(state).state;
  state = startMainPhase(state).state;
  return state;
}

describe("end-to-end card resolution", () => {
  it("damage spell: choose an enemy unit, deal 3 (lethal), unit dies into trash", async () => {
    const catalog = await createCardCatalog(cardSource, programSource);
    let state = createGame({
      players: [P1, P2],
      decks: {
        [P1]: { legendId: LEGEND, championId: CHAMP, battlefields: [BF, BF, BF], mainDeck: [SPELL, ...Array(39).fill(VANILLA)], runeDeck: Array(10).fill(RUNE) },
        [P2]: { legendId: LEGEND, championId: CHAMP, battlefields: [BF, BF, BF], mainDeck: Array(40).fill(VANILLA), runeDeck: Array(10).fill(RUNE) },
      },
      seed: 7, matchId: toMatchId("m1"),
    });
    const active = state.activePlayerId;
    const opp = active === P1 ? P2 : P1;
    state = submit(state, { type: "KeepHand", playerId: active }, catalog).state;
    state = toMain(state, catalog);

    // Put two enemy (might-3) units on a battlefield so a choice is required.
    const enemyUnits = Object.values(state.cards).filter((c) => c!.ownerId === opp).slice(0, 2).map((c) => c!.id);
    const bfId = Object.keys(state.battlefields)[0]! as keyof typeof state.battlefields;
    state = { ...state, battlefields: { ...state.battlefields, [bfId]: { ...state.battlefields[bfId]!, units: enemyUnits } } };

    // Ensure the spell is in the active player's hand.
    let spellId = state.players[active]!.hand.find((id) => state.cards[id]!.defId === SPELL);
    expect(spellId).toBeDefined();

    // Play the spell → ChooseTargets decision.
    let r = submit(state, { type: "PlayCard", playerId: active, cardId: spellId!, targets: undefined }, catalog);
    state = r.state;
    expect(state.pendingDecision?.type).toBe("ChooseTargets");

    // legalActions offers one ChooseTargets per enemy unit.
    const choices = legalActions(state, active, catalog).filter((a) => a.type === "ChooseTargets");
    expect(choices.length).toBe(2);

    // Choose the first enemy unit.
    const target = enemyUnits[0]!;
    r = submit(state, { type: "ChooseTargets", playerId: active, decisionId: (state.pendingDecision as any).decisionId, targets: [target] }, catalog);
    state = r.state;

    // Resolve the chain: opponent passes, then active passes.
    expect(state.pendingDecision?.type).toBe("PriorityWindow");
    state = submit(state, { type: "PassPriority", playerId: opp }, catalog).state;
    state = submit(state, { type: "PassPriority", playerId: active }, catalog).state;

    // 3 damage to a might-3 unit is lethal → CardKilled → target in opponent's trash;
    // chain closed; the spent spell is in the active player's trash.
    expect(state.players[opp]!.trash).toContain(target);
    expect(state.battlefields[bfId]!.units).not.toContain(target);
    expect(state.chain.isOpen).toBe(false);
    expect(state.players[active]!.trash).toContain(spellId);
  });

  it("unit ETB trigger: playing the drawer unit draws a card", async () => {
    const catalog = await createCardCatalog(cardSource, programSource);
    let state = createGame({
      players: [P1, P2],
      decks: {
        [P1]: { legendId: LEGEND, championId: CHAMP, battlefields: [BF, BF, BF], mainDeck: [UNIT, ...Array(39).fill(VANILLA)], runeDeck: Array(10).fill(RUNE) },
        [P2]: { legendId: LEGEND, championId: CHAMP, battlefields: [BF, BF, BF], mainDeck: Array(40).fill(VANILLA), runeDeck: Array(10).fill(RUNE) },
      },
      seed: 7, matchId: toMatchId("m1"),
    });
    const active = state.activePlayerId;
    state = submit(state, { type: "KeepHand", playerId: active }, catalog).state;
    state = toMain(state, catalog);

    const unitId = state.players[active]!.hand.find((id) => state.cards[id]!.defId === UNIT);
    expect(unitId).toBeDefined();
    const handBefore = state.players[active]!.hand.length;

    const r = submit(state, { type: "PlayCard", playerId: active, cardId: unitId!, targets: undefined }, catalog);
    state = r.state;

    // Unit entered base; WhenPlayed → Draw 1 ran via HOT.
    expect(state.players[active]!.base).toContain(unitId);
    // Net hand change: -1 (played the unit) +1 (drew) = handBefore - 1 ... + 1.
    expect(state.players[active]!.hand.length).toBe(handBefore - 1 + 1);
  });
});
```

- [ ] **Step 2: Run the integration tests**

Run: `pnpm --filter @thejokersthief/riftbound-engine test -- e2e-resolution`
Expected: PASS (both). If the damage-spell test shows the target untouched, confirm Task 9 (`Deal` honors `frame.targets`) and Task 13 (item gets `targets`) are in place. If the draw test fails, confirm Task 12 calls `collectTriggers` for the `CardPlayed` event and that `advance` drains HOT.

- [ ] **Step 3: Run the entire workspace suite + example**

Run: `pnpm -r test`
Expected: PASS across all packages.

Run: `pnpm --filter @thejokersthief/riftbound-example start`
Expected: still runs to game-over (the example uses `PlayCard`/`PassPriority`/`EndTurn`; real resolution now occurs but the example should still terminate). If the example errors on a now-active code path, adjust the example narrative comments — do not weaken the engine.

- [ ] **Step 4: Commit**

```bash
git add packages/engine/src/__tests__/e2e-resolution.test.ts
git commit -m "test(engine): end-to-end damage spell targeting and unit ETB trigger"
git push
```

---

## Self-Review notes (for the implementer)

- **Determinism:** chain-item ids and decision ids use `Math.random()` to match the existing convention in `interpreter/nodes.ts`. This is a pre-existing determinism gap; do not introduce new RNG infrastructure in this slice, but be aware byte-identical replays of games with chains are not guaranteed until ids are seeded (future work).
- **Priority model:** the chain uses "fully empty priority resolution" — once all players pass consecutively, the whole chain resolves top-to-bottom without re-offering priority between items. This matches `feprStep`'s design. The `passes` counter logic in `passPriority` is correct for **2 players only** (the priority flip is a hardcoded `playerIds[0] ↔ playerIds[1]`); this is fine for the 1v1 Match format. `chain.passes` is reset both by `fold(ChainOpened/ChainClosed)` (Task 6 Step 3b) and by the entry points that add items.
- **Responses are fenced off (Task 12 Step 1):** a Spell is playable only in Main phase when **no chain is open** (`checkTiming` → `Main && !isOpen`). So a spell always opens a fresh single-item chain; once open, neither player can add another spell, so both can only `PassPriority`. This deliberately avoids the untested multi-item / double-Chain-frame path. Real responses (multiple chain items, reactions) are deferred to the chain/showdown sub-project (#4).
- **Lethality (Task 9 Step 4):** `Deal` now emits `CardKilled` when accumulated `damage >= might` (same rule as `combat/resolution.ts`), so spell damage can kill. Non-lethal damage persists on the unit until end-of-turn cleanup (Task 8).
- **Targeting is play-time and first-node only:** the player chooses targets when the spell is put on the chain (not mid-resolution), and only the **first effect node of the first non-Static ability** is inspected for a target selector (`chainItemTargetSelector`). A `Sequence` whose *later* node targets will auto-pick via `resolveSelector` fallback — keep curated test cards' targeting in the first node. Mid-resolution `ChooseTargets` pausing (as the spec §5 prose describes inside `interpreter/nodes.ts`) is intentionally NOT implemented here; the pause lives in `submit`/`PlayCard` instead. This is a deliberate simplification of the spec for this slice.
- **Units do not open the priority chain** in this slice; only spells do. Unit `WhenPlayed`/`WhenEntersPlay` abilities resolve via the HOT queue without a priority window.
- **Static abilities are still inert** — `rules-query/layers.ts` is unchanged (out of scope).
- **`action.targets` (PlayCard):** `TargetSelection = { targets: CardId[] }`; read `action.targets?.targets ?? []`. There is no `cardIds` field.
