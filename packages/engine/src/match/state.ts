import type { CardDefId, MatchId, PlayerId } from '@thejokersthief/riftbound-protocol'
import type { GameState } from '../state/types.js'

export type DeckConfig = {
  mainDeck: CardDefId[]
  runeDeck: CardDefId[]
  legendId: CardDefId
  championId: CardDefId
  battlefields: [CardDefId, CardDefId, CardDefId]
}

export type MatchState = {
  matchId: MatchId
  playerIds: readonly [PlayerId, PlayerId]
  decks: Record<PlayerId, DeckConfig>
  gameWins: Record<PlayerId, number>
  usedBattlefields: Record<PlayerId, CardDefId[]>
  currentGame: GameState
  status: 'playing' | 'ended'
  winner: PlayerId | null
}
