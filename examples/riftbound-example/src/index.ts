// ─── RIFTBOUND ENGINE — EXAMPLE WALKTHROUGH ─────────────────────────────────
//
// This script demonstrates the Riftbound rules engine from first call to
// game-end. All inputs are static and fixed; change SEED to see a different
// game. Run with:
//
//   pnpm --filter @thejokersthief/riftbound-example start
//
// The engine separates concerns into layers:
//   createGame   → builds the initial GameState
//   submit       → applies player actions (returns new state + events)
//   legalActions → lists what a player may do right now
//   viewFor      → projects state into a per-player view (hides opponent info)
//
// Lower-level functions (runStartPhase, runChannelPhase, startMainPhase) advance
// automatic turn phases — a game server would call these between player actions.
// ---------------------------------------------------------------------------

import type { PlayerId, CardDefId } from '@thejokersthief/riftbound-protocol'
import type { GameEvent } from '@thejokersthief/riftbound-protocol'
import { toPlayerId, toCardDefId, toMatchId, typedObjectKeys } from '@thejokersthief/riftbound-protocol'
import type { DeckConfig, GameState } from '@thejokersthief/riftbound-engine'
import type { CardCatalog } from '@thejokersthief/riftbound-card-catalog'
import {
  createGame,
  submit,
  legalActions,
  viewFor,
  createRulesQuery,
  runStartPhase,
  runChannelPhase,
  startMainPhase,
  fold,
  resolveCombat,
} from '@thejokersthief/riftbound-engine'
import {
  createCardCatalog,
  defaultSnapshotSource,
} from '@thejokersthief/riftbound-card-catalog'

// ─── PLAYERS ────────────────────────────────────────────────────────────────
//
// Two players with readable IDs so log output is easy to follow. In a real
// server these would be generated UUIDs.
//
const ARIA  = toPlayerId('aria')
const BOWEN = toPlayerId('bowen')

// ─── SEED ───────────────────────────────────────────────────────────────────
//
// A fixed seed makes this example fully deterministic and reproducible. The
// Mulberry32 RNG in the engine uses this for every shuffle, coin flip, and
// random selection. Change to see a different game.
//
const SEED = 1

// ─── DECKS ──────────────────────────────────────────────────────────────────
//
// DeckConfig specifies which cards each player brings. These are real CardDefIds
// from the committed cards.json snapshot. createGame() instantiates CardInstances
// from these definitions and shuffles the decks using the seeded RNG.
//
const RUNE_IDS: CardDefId[] = [
  'ogn-007-298', 'ogn-007a-298', 'ogn-042-298', 'ogn-042a-298', 'ogn-089a-298',
  'ogn-089-298', 'ogn-126a-298', 'ogn-126-298', 'ogn-166-298', 'ogn-166a-298',
].map(toCardDefId)

const UNIT_POOL: CardDefId[] = [
  'ogn-001-298', 'ogs-001-024', 'unl-001-219', 'sfd-002-221', 'ogn-002-298',
  'unl-002-219', 'ogn-003-298', 'unl-003-219', 'ogs-004-024', 'unl-004-219',
  'ogs-005-024', 'unl-005-219', 'ogs-006-024', 'sfd-006-221', 'ogn-004-298',
].map(toCardDefId)

function buildMainDeck(): CardDefId[] {
  const deck: CardDefId[] = []
  let i = 0
  while (deck.length < 40) {
    deck.push(UNIT_POOL[i % UNIT_POOL.length]!)
    i++
  }
  return deck
}

const ARIA_DECK: DeckConfig = {
  legendId:    toCardDefId('ogs-017-024'),
  championId:  toCardDefId('ogs-021-024'),
  battlefields: [toCardDefId('unl-t01'), toCardDefId('unl-t03'), toCardDefId('unl-205-219')],
  mainDeck:    buildMainDeck(),
  runeDeck:    RUNE_IDS,
}

const BOWEN_DECK: DeckConfig = {
  legendId:    toCardDefId('ogs-019-024'),
  championId:  toCardDefId('ogs-023-024'),
  battlefields: [toCardDefId('unl-206-219'), toCardDefId('sfd-207-221'), toCardDefId('unl-207-219')],
  mainDeck:    buildMainDeck(),
  runeDeck:    RUNE_IDS,
}

// ─── HELPERS ────────────────────────────────────────────────────────────────

function logEvents(label: string, events: GameEvent[]): void {
  if (events.length === 0) return
  console.log(`\n▶ ${label}`)
  for (const e of events) console.log(`  ${e.type}`)
}

function printBoard(state: GameState, playerId: PlayerId, cat: CardCatalog): void {
  const view = viewFor(state, playerId, cat)
  const runesCharged = view.self.runePool.filter(s => s.filled).length
  const bfControl = Object.entries(state.battlefields)
    .map(([id, bf]) => `${id}→${bf?.controllerId ?? 'none'}`)
    .join(', ')
  console.log(
    `\n── ${playerId}: ${view.self.points} pts | ` +
    `hand: ${view.self.hand.length} | ` +
    `runes: ${runesCharged}/${view.self.runePool.length} | ` +
    `bfs: [${bfControl}]`,
  )
}

function advanceTurnStart(
  state: GameState,
  cat: CardCatalog,
): { state: GameState; events: GameEvent[] } {
  const allEvents: GameEvent[] = []
  const query = createRulesQuery(state, cat)

  const s = runStartPhase(state, query)
  allEvents.push(...s.events)
  state = s.state

  const c = runChannelPhase(state)
  allEvents.push(...c.events)
  state = c.state

  const m = startMainPhase(state)
  allEvents.push(...m.events)
  state = m.state

  return { state, events: allEvents }
}

// ─── CATALOG ────────────────────────────────────────────────────────────────
//
// Load card definitions from the committed cards.json snapshot.
// defaultSnapshotSource resolves the path relative to the package using
// import.meta.url, so no path manipulation is needed.
//
const catalog = await createCardCatalog(defaultSnapshotSource)
console.log(`Catalog loaded: ${catalog.all().length} card definitions`)

// ─── CREATE GAME ──────────────────────────────────────────────────────────
//
// createGame validates the deck configurations, instantiates CardInstances
// (assigning each a unique CardId), shuffles the decks with the seeded RNG,
// coin-flips to determine first player, and deals 5-card opening hands.
// The returned state has status='setup' and a ChooseMulligan pending decision
// for the first player.
//
let state = createGame({
  players:  [ARIA, BOWEN],
  decks:    { [ARIA]: ARIA_DECK, [BOWEN]: BOWEN_DECK },
  seed:     SEED,
  matchId:  toMatchId('match-example-01'),
})

const firstPlayer  = state.activePlayerId
const secondPlayer = firstPlayer === ARIA ? BOWEN : ARIA
console.log(`\nGame created — first player: ${firstPlayer} (seed ${SEED})`)
console.log(`status: ${state.status}  phase: ${state.phase}  turn: ${state.turnNumber}`)

// ─── MULLIGAN ─────────────────────────────────────────────────────────────
//
// The game starts with a ChooseMulligan pending decision for the first player.
// legalActions() returns KeepHand and Mulligan. Here the first player keeps
// their opening hand. Submitting KeepHand clears the pending decision and
// transitions status from 'setup' to 'playing'.
//
// In this simplified engine, only the first player goes through mulligan.
// A full implementation would rotate the decision to the second player too.
//
const mulliganOptions = legalActions(state, firstPlayer, catalog)
console.log(`\nMulligan options for ${firstPlayer}: ${mulliganOptions.map(a => a.type).join(', ')}`)

const r_keep = submit(state, { type: 'KeepHand', playerId: firstPlayer }, catalog)
logEvents(`${firstPlayer} keeps opening hand`, r_keep.events)
state = r_keep.state

console.log(`status: ${state.status}  phase: ${state.phase}`)
console.log(`${firstPlayer} hand: ${state.players[firstPlayer]?.hand.length} cards`)
console.log(`${secondPlayer} hand: ${state.players[secondPlayer]?.hand.length} cards`)

// ─── TURN 1 — FIRST PLAYER ────────────────────────────────────────────────
//
// The game is now in 'playing' status at phase 'Start'. The turn engine runs
// three automatic phases before the player may act:
//
//   Start   — ready exhausted cards owned by active player; snapshot holdEligible
//   Channel — active player channels the top rune from their rune deck
//   Main    — player may play cards, activate abilities, etc.
//
// These phases involve no player decisions so the game server calls them
// directly rather than routing through submit().
//
console.log(`\n${'═'.repeat(60)}`)
console.log(`TURN ${state.turnNumber} — ${firstPlayer.toUpperCase()}`)
console.log('═'.repeat(60))

{
  const t = advanceTurnStart(state, catalog)
  logEvents(`Turn ${state.turnNumber} start phases (Start → Channel → Main)`, t.events)
  state = t.state
}

// ─── PLAY A UNIT ────────────────────────────────────────────────────────────
//
// In Main phase the active player may play Unit and Gear cards from their hand.
// submit(PlayCard) emits a CardPlayed event; in a full implementation the effect
// interpreter would resolve the card's play effect (placing the unit on a
// battlefield). The v1 effect pipeline is a stub — CardPlayed is emitted but
// the unit does not change zones automatically. The submit call demonstrates
// the action dispatch pattern.
//
{
  const hand = state.players[firstPlayer]?.hand ?? []
  const cardId = hand[0]
  if (cardId) {
    const defId = state.cards[cardId]?.defId
    const def = defId ? catalog.find(defId) : null
    console.log(`\n${firstPlayer} plays ${def?.name ?? cardId} from hand`)

    const r = submit(state, { type: 'PlayCard', playerId: firstPlayer, cardId, targets: undefined }, catalog)
    logEvents(`${firstPlayer} plays a unit (CardPlayed event)`, r.events)
    state = r.state
  }
}

// PassPriority — in Main phase the active player passes priority to signal
// "I am done acting." When both players have passed consecutively, queued
// chain items resolve. With no open chain here, PassPriority is a no-op.
{
  const r = submit(state, { type: 'PassPriority', playerId: firstPlayer }, catalog)
  logEvents(`${firstPlayer} passes priority`, r.events)
  state = r.state
}

// EndTurn transitions to the Ending phase: Hold/Conquer scoring is checked,
// the HOT queue is drained, the win condition is tested, and per-turn tracking
// resets. Active player then rotates to the opponent.
{
  const r = submit(state, { type: 'EndTurn', playerId: firstPlayer }, catalog)
  logEvents(`${firstPlayer} ends turn`, r.events)
  state = r.state
}

printBoard(state, firstPlayer, catalog)

// ─── TURN 2 — SECOND PLAYER ───────────────────────────────────────────────
//
// The second player channels their own rune. The firstTurnSecondPlayer flag
// is set to true in the initial state and cleared after the first Channel phase
// runs — it grants an extra channel the first time it fires. In this engine the
// flag fires on the first Channel call (Turn 1), so both players end up with
// the same rune count by end of Turn 2.
//
console.log(`\n${'═'.repeat(60)}`)
console.log(`TURN ${state.turnNumber} — ${secondPlayer.toUpperCase()}`)
console.log('═'.repeat(60))

{
  const t = advanceTurnStart(state, catalog)
  logEvents(`Turn ${state.turnNumber} start phases`, t.events)
  state = t.state
}

{
  const hand = state.players[secondPlayer]?.hand ?? []
  const cardId = hand[0]
  if (cardId) {
    const defId = state.cards[cardId]?.defId
    const def = defId ? catalog.find(defId) : null
    console.log(`\n${secondPlayer} plays ${def?.name ?? cardId} from hand`)

    const r = submit(state, { type: 'PlayCard', playerId: secondPlayer, cardId, targets: undefined }, catalog)
    logEvents(`${secondPlayer} plays a unit`, r.events)
    state = r.state
  }
}

{
  const r = submit(state, { type: 'EndTurn', playerId: secondPlayer }, catalog)
  logEvents(`${secondPlayer} ends turn`, r.events)
  state = r.state
}

printBoard(state, secondPlayer, catalog)

// ─── SET UP BATTLEFIELD CONTROL ─────────────────────────────────────────────
//
// In a fully-wired engine, units resolve their entry effects via the interpreter
// and combat showdowns produce ControlChanged events organically. Since the v1
// effect pipeline is a stub, we inject ControlChanged events here via fold() to
// demonstrate the scoring and win-condition machinery.
//
// fold() is the engine's pure state reducer — the same function used internally
// by every resolver. Emitting ControlChanged sets the battlefield's controllerId,
// which the scoring system reads during cleanup.
//
const bfIds     = typedObjectKeys(state.battlefields)
const bfAria    = bfIds[0]!
const bfBowen   = bfIds[1]!

state = fold(state, { type: 'ControlChanged', battlefieldId: bfAria,  newControllerId: firstPlayer })
state = fold(state, { type: 'ControlChanged', battlefieldId: bfBowen, newControllerId: firstPlayer })
console.log(`\n[setup] ${firstPlayer} now controls both battlefields (fold-injected for demo)`)

// ─── TURN 3 — FIRST PLAYER: chain exchange ──────────────────────────────────
//
// With firstPlayer controlling both battlefields, the Start phase snapshots
// holdEligible = [bfAria, bfBowen]. At EndTurn cleanup, checkScoring awards
// 1 Hold point for each still-controlled battlefield.
//
// This turn also demonstrates a two-player PassPriority exchange (chain closed,
// both players pass → no effect but illustrates the call pattern).
//
console.log(`\n${'═'.repeat(60)}`)
console.log(`TURN ${state.turnNumber} — ${firstPlayer.toUpperCase()} (Hold scoring + chain exchange)`)
console.log('═'.repeat(60))

{
  const t = advanceTurnStart(state, catalog)
  logEvents('Turn start — holdEligible snapshotted for both battlefields', t.events)
  state = t.state
}

{
  const hand = state.players[firstPlayer]?.hand ?? []
  const cardId = hand[0]
  if (cardId) {
    const defId = state.cards[cardId]?.defId
    const def = defId ? catalog.find(defId) : null
    console.log(`\n${firstPlayer} plays ${def?.name ?? cardId} — opens chain`)

    const r = submit(state, { type: 'PlayCard', playerId: firstPlayer, cardId, targets: undefined }, catalog)
    logEvents('PlayCard → CardPlayed event', r.events)
    state = r.state

    // Opponent passes priority (no response this turn)
    const r2 = submit(state, { type: 'PassPriority', playerId: secondPlayer }, catalog)
    logEvents(`${secondPlayer} passes priority (no response)`, r2.events)
    state = r2.state

    // Active player passes priority → both have passed → chain resolves
    const r3 = submit(state, { type: 'PassPriority', playerId: firstPlayer }, catalog)
    logEvents(`${firstPlayer} passes priority → chain resolves`, r3.events)
    state = r3.state
  }
}

{
  const r = submit(state, { type: 'EndTurn', playerId: firstPlayer }, catalog)
  logEvents(`${firstPlayer} ends turn — Hold scoring fires (×2 pts)`, r.events)
  state = r.state
}

printBoard(state, firstPlayer, catalog)
console.log(`${firstPlayer} points after turn 3: ${state.players[firstPlayer]?.points}`)

// ─── TURN 4 — SECOND PLAYER: combat showdown ────────────────────────────────
//
// To demonstrate combat resolution, inject two unit instances onto bfAria —
// one per player — then call resolveCombat(). This mirrors what happens during a
// Showdown: the engine computes damage pools (via query.mightOf), builds default
// assignments (Tank units targeted first), applies DamageDealt events, kills
// units with damage ≥ might (CardKilled + CardMoved), and awards ControlChanged
// to the surviving side.
//
console.log(`\n${'═'.repeat(60)}`)
console.log(`TURN ${state.turnNumber} — ${secondPlayer.toUpperCase()} (combat showdown demo)`)
console.log('═'.repeat(60))

{
  const t = advanceTurnStart(state, catalog)
  logEvents('Turn start', t.events)
  state = t.state
}

{
  // Find one card owned by each player (any card instance will do for the demo)
  const p1CombatCard = Object.values(state.cards).find(c => c?.ownerId === firstPlayer)?.id
  const p2CombatCard = Object.values(state.cards).find(c => c?.ownerId === secondPlayer)?.id

  if (p1CombatCard && p2CombatCard) {
    // Inject both units onto bfAria so the active player (secondPlayer) contests it
    state = {
      ...state,
      battlefields: {
        ...state.battlefields,
        [bfAria]: {
          ...state.battlefields[bfAria]!,
          units: [p1CombatCard, p2CombatCard],
        },
      },
    }

    const p1DefId = state.cards[p1CombatCard]?.defId
    const p2DefId = state.cards[p2CombatCard]?.defId
    const p1CardName = (p1DefId ? catalog.find(p1DefId)?.name : null) ?? p1CombatCard
    const p2CardName = (p2DefId ? catalog.find(p2DefId)?.name : null) ?? p2CombatCard
    console.log(`\n[combat setup] ${bfAria}: ${p1CardName} (${firstPlayer}) vs ${p2CardName} (${secondPlayer})`)

    // resolveCombat: active player = secondPlayer is the contesting player.
    // It computes both sides' damage pools, assigns damage, kills the unit(s)
    // with lethal damage, and resolves control.
    const query4 = createRulesQuery(state, catalog)
    const combatResult = resolveCombat(state, bfAria, query4, catalog)
    logEvents('resolveCombat — damage → deaths → control change', combatResult.events)
    state = combatResult.state

    const newController = state.battlefields[bfAria]?.controllerId
    console.log(`${bfAria} controller after combat: ${newController ?? 'none'}`)
  }
}

{
  const r = submit(state, { type: 'EndTurn', playerId: secondPlayer }, catalog)
  logEvents(`${secondPlayer} ends turn`, r.events)
  state = r.state
}

printBoard(state, secondPlayer, catalog)

// ─── viewFor — PlayerView projection ────────────────────────────────────────
//
// viewFor() projects the GameState into a PlayerView for a specific player.
// Opponent hand cards are redacted (handCount instead of card list), face-down
// cards in the base zone are hidden, and runeDeck is a count (not IDs). This
// enforces information-hiding: a player can only see what the rules allow.
//
{
  const view = viewFor(state, firstPlayer, catalog)
  console.log(`\n── viewFor(${firstPlayer}) after Turn 4 ──`)
  console.log(`  self.points:         ${view.self.points}`)
  console.log(`  self.hand.length:    ${view.self.hand.length}`)
  console.log(`  self.runePool:       ${view.self.runePool.filter(s => s.filled).length} filled / ${view.self.runePool.length}`)
  console.log(`  opponent.handCount:  ${view.opponent.handCount}   (hand cards are hidden)`)
  console.log(`  opponent.points:     ${view.opponent.points}`)
  console.log(`  shared.turnNumber:   ${view.shared.turnNumber}`)
  console.log(`  shared.phase:        ${view.shared.phase}`)
}

// ─── TURNS 5+ — score to victory ────────────────────────────────────────────
//
// Run turns until a player reaches 8 points. Each of the first player's turns
// awards Hold points for battlefields they control at both the start and end of
// their turn. A player needs 8 points with strictly more than the opponent
// (checkWinCondition, called every EndTurn cleanup).
//
// Restore firstPlayer's control after the combat demo so Hold scoring resumes.
//
if (state.battlefields[bfAria]?.controllerId !== firstPlayer) {
  state = fold(state, { type: 'ControlChanged', battlefieldId: bfAria, newControllerId: firstPlayer })
  console.log(`\n[setup] restored ${bfAria} to ${firstPlayer} (Hold scoring demo)`)
}

let turnCount = 4
const MAX_TURNS = 40

console.log('\n── Running turns until win condition ──')

while (state.status === 'playing' && turnCount < MAX_TURNS) {
  const active = state.activePlayerId

  const tResult = advanceTurnStart(state, catalog)
  state = tResult.state

  const rEnd = submit(state, { type: 'EndTurn', playerId: active }, catalog)
  const scored = rEnd.events.filter(e => e.type === 'PointScored').length
  state = rEnd.state
  turnCount++

  const ariaScore  = state.players[ARIA]?.points  ?? 0
  const bowenScore = state.players[BOWEN]?.points ?? 0
  console.log(`  Turn ${state.turnNumber - 1} (${active}): scored ${scored} pts — ${ARIA} ${ariaScore} | ${BOWEN} ${bowenScore}`)

  // Winning Point guard: when firstPlayer reaches 7 pts, the next Conquer
  // attempt (gaining a new battlefield mid-turn) draws a card instead of
  // scoring, unless all battlefields have already been scored this turn.
  // This prevents an easy 8th point from a single Conquer action.
  const fpPoints = state.players[firstPlayer]?.points ?? 0
  if (fpPoints === 7 && active === firstPlayer) {
    console.log(`  [Winning Point guard active] next Conquer by ${firstPlayer} draws a card unless all bfs scored`)
  }

  if (state.status === 'ended') break
}

// ─── GAME END ────────────────────────────────────────────────────────────────
//
// The engine sets state.status = 'ended' and state.winner when a player reaches
// 8+ points with strictly more than their opponent. A tied score at 8+ requires
// one more point to break the tie (checkWinCondition in cleanup).
//
if (state.status === 'ended') {
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`GAME OVER — winner: ${state.winner}`)
  console.log(`Final score — ${ARIA}: ${state.players[ARIA]?.points ?? 0}  |  ${BOWEN}: ${state.players[BOWEN]?.points ?? 0}`)
  console.log('═'.repeat(60))
} else {
  console.log(`\nGame not yet ended after ${turnCount} turns (status: ${state.status})`)
}
