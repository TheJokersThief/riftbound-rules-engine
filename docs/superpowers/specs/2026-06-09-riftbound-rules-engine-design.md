# Riftbound Rules Engine — Design Specification

**Date:** 2026-06-09
**Status:** Approved design, pending implementation plan
**Scope:** A modular, extensible TypeScript rules engine that manages a complete game of the Riftbound trading card game from start to finish, for the 1v1 (Match) mode of play only.

> Terminology note: this document expands all acronyms. The only initialisms retained are the rulebook's own named sequences — **Finalize, Execute, Pass, Resolve** (the chain-resolution sequence the rulebook abbreviates "FEPR") and **Handle Outstanding Tasks, then Finalize, Execute, Pass, Resolve** (which the rulebook abbreviates "HOT FEPR"). They are written in full on first use in each section.

---

## 1. Goal and constraints

Build a rules engine that handles gameplay management end to end: turn structure, card effects, targeting, resource management (runes producing energy and power), win conditions, and action–reaction chains.

Fixed constraints:

- **Language:** TypeScript.
- **Workspace:** an Nx + pnpm monorepo. Distinct packages are used wherever a stable seam justifies the split, and no further (Nx makes additional packages cheap, but each one must earn its place at a real seam).
- **Architecture basis:** the deep-module philosophy from the `improve-codebase-architecture` skill — every module is a small interface hiding a large implementation, testable through that interface alone. Vocabulary used throughout: *module* (interface + implementation), *depth* (a lot of behaviour behind a small interface), *seam* (a place behaviour can be swapped), *adapter* (a concrete thing satisfying an interface at a seam), *locality* (change and knowledge concentrated in one place).
- **Mode of play:** 1v1 (Match) only (core rule 481). 1v1 (Duel), three-player free-for-all, four-player free-for-all, and two-versus-two are explicitly out of scope.
- **Card data source:** the riftdex public catalog endpoint (`https://riftdex.gg/api/v1/cards`), captured as a frozen snapshot for the engine to consume.

Deck composition for a legal deck (deck construction, unchanged from the rulebook):

- 3 battlefields
- 1 legend
- 1 chosen champion
- 39 main-deck cards (the chosen champion brings the main deck to 40)
- 12 rune-deck cards

---

## 2. Primary consumer and the requirements it imposes

The engine's primary consumer is a **networked game client** with a server-authoritative backend and two human players. This single fact drives the core of the design:

- **Deterministic.** No wall-clock, no ambient randomness. All randomness comes from a seeded pseudo-random-number generator stored inside the game state, so shuffles and any random step replay identically.
- **Serializable.** Game state is a plain object that round-trips to and from a string for the wire and for storage.
- **Replayable / resyncable.** The full game equals an initial state plus an ordered log of actions, so a reconnecting player can be brought back to the exact current state.
- **Hidden-information-correct.** The authoritative state holds everything; each player only ever receives a redacted projection of it.

The engine itself is a **pure library**: it performs no input/output, no networking, and no persistence. Those concerns belong to the consuming server.

---

## 3. Architectural approach

The engine is an **event-sourced core driven by a small-step reducer**:

```
submit(state, action) -> { state, events, pending }
```

All mutation happens by appending immutable **events** (for example `DamageDealt`, `ControlChanged`, `PointScored`) that fold into state. Each call advances the world until it needs a player input, then returns a **`DecisionRequest`** (pass priority? declare a reaction? choose a target? assign damage?) and stops. The player's answer arrives as the *next* action. Nothing is ever suspended in memory across calls; resuming is simply the next `submit`.

The mechanism that makes deeply nested resolution serializable is an explicit **resolution stack** held inside the game state: frames for in-progress effects, the chain, and pending choices. Because the suspension point is data in the state rather than a live call stack, a reconnecting player can resume mid-combat with no loss of state.

### Approaches considered and rejected

- **Mutable game-object graph with a trigger bus.** Intuitive mapping to "game objects" and fast to start, but mutable shared state makes deterministic replay, serialization, and per-player hidden views much harder, and implicit trigger ordering fights the rulebook's explicit layer/timestamp/dependency system. Rejected.
- **Immutable state with generator/coroutine resolution.** Elegant and linear to author, but JavaScript generators do not serialize — a suspended coroutine cannot be snapshotted, sent over the wire, or persisted, which is disqualifying for a networked authority that must survive reconnects. Rejected. (Recorded as an architecture decision record; see section 8.)

---

## 4. Package layout (Nx + pnpm workspace)

Five packages, drawn only at stable seams. Tightly-coupled runtime resolvers stay together inside the engine package rather than being split further.

| Package | Responsibility | Depends on |
| --- | --- | --- |
| `@thejokersthief/riftbound-protocol` | Wire contract: `Action`, `DecisionRequest`, `GameEvent`, `PlayerView` types. No logic. | — |
| `@thejokersthief/riftbound-effect-ir` | The effect **intermediate representation** types and the small-step interpreter contract. The shared kernel both the compiler (producer) and the engine (consumer) agree on. | — |
| `@thejokersthief/riftbound-card-catalog` | `CardDefinition` types, the frozen riftdex data snapshot, and the offline data ingestion/refresh tool. | — |
| `@thejokersthief/riftbound-card-compiler` | The text-to-intermediate-representation parser and the fallback registry. A build-time concern. | `effect-ir`, `card-catalog` |
| `@thejokersthief/riftbound-engine` | Runtime core: game state, the chain/combat/turn resolvers, the interpreter driver, the layers system, visibility, and the public façade. | `protocol`, `effect-ir`, `card-catalog` |

Key property: **the engine does not depend on the compiler.** At load it consumes already-compiled effect programs, so the grammar and tokenizer never ship in the server's hot path. The deterministic seeded random-number generator and other small utilities live *inside* the engine as internal modules — splitting them would be overhead with no seam to justify it.

The dependency direction is enforced by Nx's `enforce-module-boundaries` lint rule (for example, "`engine` may not import `card-compiler`" becomes a continuous-integration failure rather than a code-review hope).

`CONTEXT.md` (domain glossary) and `docs/adr/` (architecture decision records) live at the workspace root, shared across all packages.

---

## 5. Module map (within `@thejokersthief/riftbound-engine`)

Each module is deep: a small interface over a large implementation, testable through that interface.

- **`CardCatalog`** — `get(cardId): CardDefinition`. Hides riftdex ingestion, HTML cleanup, and set merging. Seam: a `CardDataSource` adapter (frozen JSON snapshot versus live endpoint) so tests never touch the network.
- **`CardCompiler`** (in its own package) — `compile(def): { program: EffectProgram } | { unparsed: true }`. Hides the tokenizer and grammar. Seam: a `FallbackRegistry` adapter supplying hand-authored programs for cards the parser cannot handle.
- **`EffectInterpreter`** — `step(state): StepResult`. A small-step machine that advances one effect program over the resolution stack, emitting events or a decision request.
- **`ChainResolver`** — `advance(state): StepResult`. Drives the chain and the Handle-Outstanding-Tasks-then-Finalize-Execute-Pass-Resolve loop, plus priority and focus (core rules 327–348).
- **`CombatResolver`** — the three combat steps, damage assignment, and resolution (core rules 454–461).
- **`TurnEngine`** — the phase machine (start / main / ending), cleanups, the scoring check, and the win-condition check (core rules 300–323, 462–467).
- **`RulesQuery` (the layers system)** — derived state. Interface: `mightOf(unit)`, `isMighty(unit)`, `keywordsOf(unit)`, `canBePlayed(card, state)`. Hides the whole layer / dependency / timestamp system (core rules 468–475).
- **`GameState` + `EventLog`** — event-sourced state: events fold into state; state is a plain serializable object including the resolution stack and the seeded random-number generator.
- **`Visibility`** — `viewFor(player, state): PlayerView`. Projects hidden information per player.
- **`MatchEngine`** — the best-of-three orchestrator (see section 7).
- **`Engine` façade** — the only public entry point (see section 9).

Dependency arrows point inward: the façade depends on the resolvers; the resolvers depend on the interpreter and `RulesQuery`; everything depends on the `GameState` types.

---

## 6. Resolution: chain, showdown, and combat

All of this runs through the small-step reducer from section 3.

**Windows of opportunity** (core rule 326). The `ChainResolver` is a state machine over the turn's four states — Neutral/Showdown combined with Open/Closed (core rules 307–310). It tracks two tokens the rules keep strictly separate:

- **Priority** — who may act within the chain.
- **Focus** — whose turn it is to act within a showdown.

Conflating these is the classic engine bug, so they are separate fields in state.

**The chain (Finalize, Execute, Pass, Resolve).** When a card is played or an ability activated, a chain comes into existence (core rule 333). The resolver walks the rulebook's four steps literally:

1. **Finalize** — pending chain items complete their play steps in append order; resource-adding abilities resolve immediately and never reach Execute (core rule 337).
2. **Execute** — the player with Priority may play a legally-timed card, activate an ability, or pass; anything added returns the loop to Finalize (core rule 338).
3. **Pass** — once all players pass in sequence with nothing added, proceed to Resolve (core rule 339).
4. **Resolve** — the newest item resolves in full through the `EffectInterpreter`; if items remain, loop back (core rule 340).

"Handle Outstanding Tasks" is modeled as a queue of pending tasks drained before the chain proceeds (core rule 335), so triggered abilities and cleanups slot in at the rulebook's exact moments.

**Showdowns** (core rules 341–348) open when a battlefield's control is Contested in a Neutral Open state. The resolver grants Focus to the contester, alternates Focus on each pass, and closes the showdown when all players pass — then either proceeds into combat (a combat showdown) or settles control (a non-combat showdown).

**Combat** (`CombatResolver`, core rules 454–461) runs the three steps — the Combat Showdown step, the Combat Damage step (with assignment and excess/bonus damage), and the Resolution step — then hands off to scoring.

The resolution stack holds the in-progress chain, the current combat step, and any half-finished effect, so a reconnecting player resumes exactly where play paused.

---

## 7. The 1v1 (Match) frame, setup, and win condition

The engine targets 1v1 (Match) (core rule 481). Two nesting units are modeled as distinct modules.

### Board shape

Two battlefields are in play (core rule 481.4), not three. Each player brings three battlefields in their deck, selects one during setup, and sets the other two aside.

### Setup selection

By default each player **selects** which of their three battlefields to keep — modeled as a setup `DecisionRequest` answered by each player (faithful to core rule 481.5). A configurable option switches this to **random** selection via the seeded random-number generator; the default remains player-choice. Both kept battlefields enter the Battlefield Zone simultaneously.

The full setup process otherwise follows core rules 111–119: each player places their champion legend in the Legend Zone and their chosen champion in the Champion Zone, shuffles both decks into their zones, determines turn order by a fair random method (seeded), each draws four, performs a mulligan in turn order, and play begins with the first player.

### Per-game first-turn process

At the start of each game, the player going second channels an extra rune from their Rune Deck during their first Channel Phase (core rule 481.7).

### Game versus Match

- **`GameEngine`** — one game, start to finish. The deep core everything else is built on. A game ends when, during a cleanup, a player has points greater than or equal to the Victory Score of 8 **and** strictly more points than the opponent (core rules 467 and 323.1).
- **`MatchEngine`** — a thin orchestrator over best-of-three. It tracks game wins; between games it resets game state, removes the battlefields that were used, and requires each player to choose a new battlefield from those they set aside (core rules 481.5 and 481.6). The first player to two game wins takes the match.

### Win condition (exact, per game)

Scoring happens two ways (core rule 464), once per battlefield per turn (core rule 465):

- **Conquer** — a player gains control of a battlefield they had not yet scored this turn (core rule 464.1).
- **Hold** — a player maintains control of a battlefield through their Beginning Phase (core rule 464.2).

The **Winning Point** — the point that would bring a player to the Victory Score — carries additional restrictions (core rule 466.1.b). When a player whose current point total is one point below the Victory Score or higher (that is, at 7 or more) attempts to score:

- via **Hold**, they gain the Winning Point (core rule 466.1.b.1);
- via **Conquer**, they gain the Winning Point **only if** they have scored every battlefield this turn (by either method); otherwise they draw a card instead of scoring (core rule 466.1.b.2);
- a point gained from a source that is **not** Conquer or Hold (for example a card effect) is **not** bound by these restrictions (core rule 466.1.a.1).

In the two-battlefield Match board, "scored every battlefield this turn" means both battlefields. The win is then realised at cleanup per the rule above.

This is encoded as an explicit, rule-cited predicate in the scoring module — `Hold` and `Conquer` as the two scoring paths, the Winning-Point restriction as a guard, and the non-Conquer/Hold-source bypass as an exception — so it is independently testable rather than expressed as a loose paraphrase.

---

## 8. Effect representation, parser, and fallback

### The intermediate representation

A card's behaviour compiles into an `EffectProgram`: a small tree of typed nodes in four families, drawn from the real card text observed in the catalog.

- **Abilities** wrap everything else:
  - `Triggered { event, condition?, effect }` — for example "When I attack…", "When you play me…", "When another friendly unit dies…".
  - `Activated { cost, timing, effect }` — for example ":rb_exhaust:: Buff an exhausted friendly unit", "Spend 3 XP: …".
  - `Static { layer, modification }` — continuous effects feeding the layers system, for example "While I'm buffed, I have Ganking" or "Your spells and abilities deal 1 Bonus Damage".
- **Actions** — the imperative verbs the interpreter executes by emitting events: `Deal`, `Draw`, `Discard`, `Move`, `Recall`, `ReturnToHand`, `Buff`, `Ready`, `Exhaust`, `Kill`, `Banish`, `CreateToken`, `Counter`, `AddResource`, `GainXP` / `SpendXP`, `Reveal`, `Recycle`, `GiveMight`, `GrantKeyword`, `TakeExtraTurn`.
- **Selectors** — a typed target query: scope (friendly / enemy / any), object type (unit / gear / spell), location (here / at battlefields / base / top N of Main Deck), filters (might less than or equal to N, ready, buffed, has keyword, named X), quantity (one / all / up to N), and chooser (you / opponent). The interpreter resolves selectors against current state, emitting a target `DecisionRequest` when a choice is required.
- **Conditions** — predicates over state, for example "if there is a ready enemy unit here".
- **Costs** — energy, power, and rune symbols, plus exhaust, sacrifice, discard, XP, and "additional cost" clauses.

"you may …" compiles to an optional effect gated on a yes/no decision request; "choose …" compiles to a selector with an explicit chooser.

### The parser

A pipeline in `@thejokersthief/riftbound-card-compiler`:

1. Ability HTML → **normalize**: strip `<p>` and `<br>`, tokenize the `:rb_*:` resource symbols and `[Keyword]` tags, and **discard the parenthetical reminder text** (it only restates a keyword's meaning).
2. **Sentence segmentation.**
3. A hand-written **recursive-descent grammar** producing intermediate-representation nodes.
4. **Validation.**

Keywords resolve through a single **keyword registry** (Accelerate, Reaction, Action, Ambush, Deflect N, Hidden, Assault, Repeat, Equip, Ganking, Deathknell, Shield, Tank, Vision, Weaponmaster, Legion, Hunt, Backline, Unique, and the rest of the glossary in core rules 805–826), each expanding to a structured ability, property, or cost modifier defined once.

### The fallback path

Compilation runs **offline** as a build step that emits a compiled catalog (card id to effect program) plus a **coverage report**. Any card the parser cannot handle confidently is marked `unparsed`; the **`FallbackRegistry`** supplies a hand-authored effect program for it, keyed by card id, merged into the compiled catalog. The engine only ever loads the merged, compiled result — it never parses at runtime.

As a correctness guard, the compiler can "decompile" an intermediate representation back to normalized text and diff it against the original to catch silent mis-parses; this doubles as a test oracle.

This holds the agreed scope: a full rules core, a parser for the common shapes, and explicit hooks for the long tail — with no commitment to 100% card coverage in version one.

---

## 9. Public interface

The engine is a pure library; the entire surface is a handful of pure functions on the `Engine` façade.

- `createGame({ players, seed, options }) -> GameState` — builds initial state from two decks and a random seed; `options` carries the battlefield-selection mode (player-choice default, or random).
- `submit(state, action) -> { state, events, pending }` — the small-step reducer; returns the next state, the events produced, and the next `DecisionRequest` (or `null`).
- `legalActions(state, player) -> Action[]` — every action the player may currently take; drives both validation and any automated player.
- `viewFor(state, player) -> PlayerView` — the redacted, hidden-information-correct projection a client is allowed to see.
- `serialize(state) -> string` / `deserialize(s) -> GameState` — plain-object round-trip for the wire and for storage.
- `createMatch(...)` and its companions mirror the above for the best-of-three wrapper.

`Action`, `DecisionRequest`, `GameEvent`, and `PlayerView` all live in `@thejokersthief/riftbound-protocol`, so a client depends only on the contract, never on the engine implementation.

---

## 10. Testing strategy

The interface is the test surface.

- **Scenario tests** — scripted games expressed as action logs, asserting the resulting events and state; each is annotated with the core-rule number(s) it exercises, for traceability.
- **Determinism test** — the same seed plus the same action log must reproduce byte-identical serialized state (this is the replay and resync guarantee).
- **Parser corpus tests** — run the compiler over the full catalog (~964 cards): assert a minimum parse rate as a continuous-integration gate, snapshot the compiled intermediate representation per card, and run the decompile round-trip diff to catch silent mis-parses.
- **Property / invariant tests** — card conservation across zones, points never decreasing illegally, never holding both Priority and Focus incorrectly, and the score-once-per-battlefield-per-turn invariant.
- **Fuzz playthroughs** — random legal-action games to surface crashes or illegal states.
- **Fixtures** — a deck-builder helper and a board-state setup helper so scenarios stay terse.

---

## 11. Conventions and decision records

Carrying the architecture skill's discipline into the repository:

- **`CONTEXT.md`** at the workspace root — the domain glossary in rulebook vocabulary (Chain, Showdown, Priority, Focus, Conquer, Hold, Rune Pool, Battlefield, Legend, Chosen Champion, Resolution Stack, and so on). This names the good seams so module names track the domain.
- **`docs/adr/`** — architecture decision records, seeded with:
  - ADR-0001: Target 1v1 (Match) as the only mode of play.
  - ADR-0002: Event-sourced reducer core with an explicit resolution stack; generators rejected because they do not serialize.
  - ADR-0003: Player-choice battlefield selection as the default, with random as a configurable option.
  - ADR-0004: Offline card compilation plus a fallback registry; the engine never parses at runtime.
  - ADR-0005: The five-package split and the Nx tag boundaries that enforce the dependency direction.
- **Nx `enforce-module-boundaries`** — encodes the dependency direction (for example, `engine` may not import `card-compiler`) as a continuous-integration failure.

---

## 12. Out of scope for version one

- Modes of play other than 1v1 (Match).
- 100% card coverage by the parser (the fallback registry covers the long tail as needed).
- Networking, persistence, matchmaking, and any user interface — all owned by the consuming server/client.
- A built-in automated player or artificial-intelligence opponent (the `legalActions` surface makes one possible later, but it is not part of this engine).
