import type {
  Action,
  CardDefId,
  GameEvent,
  MatchId,
  PlayerId,
  PlayerView,
} from '@thejokersthief/riftbound-protocol'
import { toMatchId } from '@thejokersthief/riftbound-protocol'
import type { GameState } from '../state/types.js'
import type { DeckConfig, MatchState } from './state.js'

export type { DeckConfig, MatchState } from './state.js'

export type GameEngineFunctions = {
  createGame: (config: {
    players: readonly [PlayerId, PlayerId]
    decks: Record<PlayerId, DeckConfig>
    seed: number
  }) => GameState
  submit: (state: GameState, action: Action) => { state: GameState; events: GameEvent[] }
  legalActions: (state: GameState, playerId: PlayerId) => Action[]
  viewFor: (state: GameState, playerId: PlayerId) => PlayerView
}

export function createMatch(
  config: {
    players: readonly [PlayerId, PlayerId]
    decks: Record<PlayerId, DeckConfig>
    seed: number
  },
  engine: GameEngineFunctions
): MatchState {
  const gameState = engine.createGame({
    players: config.players,
    decks: config.decks,
    seed: config.seed,
  })
  return {
    matchId: toMatchId(`match-${config.seed}`),
    playerIds: config.players,
    decks: config.decks,
    gameWins: { [config.players[0]]: 0, [config.players[1]]: 0 } as Record<PlayerId, number>,
    usedBattlefields: { [config.players[0]]: [], [config.players[1]]: [] } as Record<
      PlayerId,
      CardDefId[]
    >,
    currentGame: gameState,
    status: 'playing',
    winner: null,
  }
}

function handleGameEnd(matchState: MatchState, _engine: GameEngineFunctions): MatchState {
  const winner = matchState.currentGame.winner
  if (winner === null) return matchState

  const currentWins = matchState.gameWins[winner] ?? 0
  const newWins = currentWins + 1
  const newGameWins: Record<PlayerId, number> = { ...matchState.gameWins, [winner]: newWins }

  if (newWins >= 2) {
    return {
      ...matchState,
      gameWins: newGameWins,
      status: 'ended',
      winner,
    }
  }

  return {
    ...matchState,
    gameWins: newGameWins,
  }
}

export function submitToMatch(
  matchState: MatchState,
  action: Action,
  engine: GameEngineFunctions
): { matchState: MatchState; events: GameEvent[] } {
  const { state: newGame, events } = engine.submit(matchState.currentGame, action)
  let updated: MatchState = { ...matchState, currentGame: newGame }

  if (newGame.status === 'ended' && newGame.winner !== null) {
    updated = handleGameEnd(updated, engine)
  }

  return { matchState: updated, events }
}

export function legalMatchActions(
  matchState: MatchState,
  playerId: PlayerId,
  engine: GameEngineFunctions
): Action[] {
  if (matchState.status === 'ended') return []
  return engine.legalActions(matchState.currentGame, playerId)
}

export function viewForMatch(
  matchState: MatchState,
  playerId: PlayerId,
  engine: GameEngineFunctions
): PlayerView {
  return engine.viewFor(matchState.currentGame, playerId)
}
