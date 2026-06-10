import type { PlayerId, CardDefId, BattlefieldId, CardId, GameId, MatchId } from '@thejokersthief/riftbound-protocol'
import type { CardCatalog } from '@thejokersthief/riftbound-card-catalog'
import type { DeckConfig, GameState, MatchState } from '@thejokersthief/riftbound-engine'
import { createMatchEngine } from '@thejokersthief/riftbound-engine'

// Infer sub-types from GameState to avoid engine re-exporting them
type _Players = GameState['players']
type _Cards = GameState['cards']
type _Battlefields = GameState['battlefields']
type PlayerState = NonNullable<_Players[keyof _Players]>
type CardInstance = NonNullable<_Cards[keyof _Cards]>
type BattlefieldState = NonNullable<_Battlefields[keyof _Battlefields]>

// ---------------------------------------------------------------------------
// Hard-coded card IDs from data/cards.json
// ---------------------------------------------------------------------------

const LEGEND_ID = 'ogs-017-024' as CardDefId
const CHAMPION_ID = 'ogs-021-024' as CardDefId
const BATTLEFIELD_IDS: [CardDefId, CardDefId, CardDefId] = [
  'unl-t01' as CardDefId,
  'unl-t03' as CardDefId,
  'unl-205-219' as CardDefId,
]
const RUNE_IDS: CardDefId[] = [
  'ogn-007-298', 'ogn-007a-298', 'ogn-042-298', 'ogn-042a-298', 'ogn-089a-298',
  'ogn-089-298', 'ogn-126a-298', 'ogn-126-298', 'ogn-166-298', 'ogn-166a-298',
] as CardDefId[]

const MAIN_DECK_POOL: CardDefId[] = [
  'ogn-001-298', 'ogs-001-024', 'unl-001-219', 'sfd-002-221', 'ogn-002-298',
  'unl-002-219', 'ogn-003-298', 'unl-003-219', 'ogs-004-024', 'unl-004-219',
  'ogs-005-024', 'unl-005-219', 'ogs-006-024', 'sfd-006-221', 'ogn-004-298',
] as CardDefId[]

function buildDefaultMainDeck(): CardDefId[] {
  const deck: CardDefId[] = []
  let i = 0
  while (deck.length < 40) {
    deck.push(MAIN_DECK_POOL[i % MAIN_DECK_POOL.length]!)
    i++
  }
  return deck
}

// ---------------------------------------------------------------------------
// buildDeck
// ---------------------------------------------------------------------------

export function buildDeck(overrides?: Partial<DeckConfig>): DeckConfig {
  const base: DeckConfig = {
    mainDeck: buildDefaultMainDeck(),
    runeDeck: RUNE_IDS,
    legendId: LEGEND_ID,
    championId: CHAMPION_ID,
    battlefields: BATTLEFIELD_IDS,
  }
  if (!overrides) return base
  return { ...base, ...overrides }
}

// ---------------------------------------------------------------------------
// buildBoard
// ---------------------------------------------------------------------------

let _boardCounter = 0

function makeCardId(seed: number): CardId {
  return `board-card-${seed}-${_boardCounter++}` as CardId
}

export function buildBoard(config: {
  players: readonly [PlayerId, PlayerId]
  seed?: number
  board: Record<string, Partial<PlayerState>>
  cards?: Record<string, Partial<CardInstance>>
  battlefields?: Record<string, Partial<BattlefieldState>>
  catalog: CardCatalog
}): GameState {
  const [p1, p2] = config.players
  const seed = config.seed ?? 0

  // Create stub legend/champion cards for each player
  const p1LegendCardId = makeCardId(seed)
  const p1ChampionCardId = makeCardId(seed)
  const p2LegendCardId = makeCardId(seed)
  const p2ChampionCardId = makeCardId(seed)

  const baseCards: Record<CardId, CardInstance> = {
    [p1LegendCardId]: {
      id: p1LegendCardId,
      defId: LEGEND_ID,
      ownerId: p1,
      exhausted: false,
      buffAmount: 0,
      keywords: [],
      xp: 0,
      counters: {},
      faceDown: false,
    },
    [p1ChampionCardId]: {
      id: p1ChampionCardId,
      defId: CHAMPION_ID,
      ownerId: p1,
      exhausted: false,
      buffAmount: 0,
      keywords: [],
      xp: 0,
      counters: {},
      faceDown: false,
    },
    [p2LegendCardId]: {
      id: p2LegendCardId,
      defId: LEGEND_ID,
      ownerId: p2,
      exhausted: false,
      buffAmount: 0,
      keywords: [],
      xp: 0,
      counters: {},
      faceDown: false,
    },
    [p2ChampionCardId]: {
      id: p2ChampionCardId,
      defId: CHAMPION_ID,
      ownerId: p2,
      exhausted: false,
      buffAmount: 0,
      keywords: [],
      xp: 0,
      counters: {},
      faceDown: false,
    },
  }

  // Apply card overrides
  const allCards: Record<CardId, CardInstance> = { ...baseCards }
  if (config.cards) {
    for (const [cardId, partial] of Object.entries(config.cards)) {
      const existing = allCards[cardId as CardId]
      if (existing) {
        allCards[cardId as CardId] = { ...existing, ...partial }
      } else {
        // Create new card from partial, requiring at minimum id + defId + ownerId
        const inst = partial as CardInstance
        allCards[cardId as CardId] = {
          id: cardId as CardId,
          defId: inst.defId ?? (LEGEND_ID as CardDefId),
          ownerId: inst.ownerId ?? p1,
          exhausted: inst.exhausted ?? false,
          buffAmount: inst.buffAmount ?? 0,
          keywords: inst.keywords ?? [],
          xp: inst.xp ?? 0,
          counters: inst.counters ?? {},
          faceDown: inst.faceDown ?? false,
        }
      }
    }
  }

  function buildPlayerState(pid: PlayerId, legendId: CardId, championId: CardId): PlayerState {
    const override = config.board[pid] ?? {}
    return {
      hand: override.hand ?? [],
      mainDeck: override.mainDeck ?? [],
      runeDeck: override.runeDeck ?? [],
      runePool: override.runePool ?? [
        { filled: false, runeCardId: null },
        { filled: false, runeCardId: null },
      ],
      legendZone: override.legendZone ?? legendId,
      championZone: override.championZone ?? championId,
      base: override.base ?? [],
      resources: override.resources ?? { energy: 3, power: 2 },
      points: override.points ?? 0,
    }
  }

  const p1State = buildPlayerState(p1, p1LegendCardId, p1ChampionCardId)
  const p2State = buildPlayerState(p2, p2LegendCardId, p2ChampionCardId)

  // Build battlefields
  const p1BfId = `bf-${p1}` as BattlefieldId
  const p2BfId = `bf-${p2}` as BattlefieldId

  const baseBattlefields: Record<BattlefieldId, BattlefieldState> = {
    [p1BfId]: { id: p1BfId, cardId: p1LegendCardId, controllerId: p1, units: [] },
    [p2BfId]: { id: p2BfId, cardId: p2LegendCardId, controllerId: p2, units: [] },
  }

  if (config.battlefields) {
    for (const [bfId, partial] of Object.entries(config.battlefields)) {
      const existing = baseBattlefields[bfId as BattlefieldId]
      if (existing) {
        baseBattlefields[bfId as BattlefieldId] = { ...existing, ...partial }
      }
    }
  }

  const state: GameState = {
    gameId: `game-board-${seed}` as GameId,
    matchId: `match-board-${seed}` as MatchId,
    playerIds: [p1, p2],
    cards: allCards,
    players: {
      [p1]: p1State,
      [p2]: p2State,
    } as Record<PlayerId, PlayerState>,
    battlefields: baseBattlefields,
    turnNumber: 1,
    activePlayerId: p1,
    phase: 'Main',
    chain: { isOpen: false, items: [], priority: null, focus: null, showdown: null },
    resolutionStack: [],
    pendingDecision: null,
    rng: { seed },
    scoredThisTurn: {} as Record<PlayerId, BattlefieldId[]>,
    status: 'playing',
    winner: null,
    hotQueue: [],
    holdEligible: [],
    firstTurnSecondPlayer: false,
  }

  return state
}

// ---------------------------------------------------------------------------
// buildMatch
// ---------------------------------------------------------------------------

export function buildMatch(config: {
  players: readonly [PlayerId, PlayerId]
  seed?: number
  catalog: CardCatalog
}): MatchState {
  const [p1, p2] = config.players
  const matchEngine = createMatchEngine(config.catalog)
  const decks: Record<PlayerId, DeckConfig> = {
    [p1]: buildDeck(),
    [p2]: buildDeck(),
  } as Record<PlayerId, DeckConfig>

  return matchEngine.createMatch({
    players: config.players,
    decks,
    seed: config.seed ?? 0,
  })
}
