import { z } from 'zod'
import { BattlefieldIdSchema, CardDefIdSchema, CardIdSchema, GameIdSchema, MatchIdSchema, PlayerIdSchema, ZoneIdSchema } from './ids.js'

export const PhaseSchema = z.enum(['Start', 'Channel', 'Main', 'Ending'])
export type Phase = z.infer<typeof PhaseSchema>

export const GameEventSchema = z.discriminatedUnion('type', [
  // Lifecycle
  z.object({ type: z.literal('GameStarted'), gameId: GameIdSchema, playerIds: z.tuple([PlayerIdSchema, PlayerIdSchema]) }),
  z.object({ type: z.literal('GameEnded'), gameId: GameIdSchema, winner: PlayerIdSchema }),
  z.object({ type: z.literal('MatchEnded'), matchId: MatchIdSchema, winner: PlayerIdSchema }),
  z.object({ type: z.literal('TurnStarted'), turnNumber: z.number().int(), activePlayerId: PlayerIdSchema }),
  z.object({ type: z.literal('TurnEnded'), turnNumber: z.number().int(), activePlayerId: PlayerIdSchema }),
  z.object({ type: z.literal('PhaseStarted'), phase: PhaseSchema }),
  // Setup
  z.object({ type: z.literal('BattlefieldChosen'), playerId: PlayerIdSchema, cardId: CardIdSchema }),
  z.object({ type: z.literal('MulliganChosen'), playerId: PlayerIdSchema, kept: z.boolean() }),
  // Chain & showdown
  z.object({ type: z.literal('ChainOpened') }),
  z.object({ type: z.literal('ChainClosed') }),
  z.object({ type: z.literal('ShowdownOpened'), battlefieldId: BattlefieldIdSchema, kind: z.enum(['Combat', 'Control']) }),
  z.object({ type: z.literal('ShowdownClosed'), battlefieldId: BattlefieldIdSchema }),
  z.object({ type: z.literal('PriorityPassed'), playerId: PlayerIdSchema }),
  z.object({ type: z.literal('FocusPassed'), playerId: PlayerIdSchema }),
  // Card movement
  z.object({ type: z.literal('CardDrawn'), playerId: PlayerIdSchema, cardId: CardIdSchema.nullable() }),
  z.object({ type: z.literal('CardDiscarded'), playerId: PlayerIdSchema, cardId: CardIdSchema }),
  z.object({ type: z.literal('CardPlayed'), playerId: PlayerIdSchema, cardId: CardIdSchema }),
  z.object({ type: z.literal('CardMoved'), cardId: CardIdSchema, fromZone: ZoneIdSchema, toZone: ZoneIdSchema }),
  z.object({ type: z.literal('CardRecalled'), cardId: CardIdSchema }),
  z.object({ type: z.literal('CardReturnedToHand'), cardId: CardIdSchema, playerId: PlayerIdSchema }),
  z.object({ type: z.literal('CardCountered'), cardId: CardIdSchema }),
  z.object({ type: z.literal('CardBanished'), cardId: CardIdSchema }),
  z.object({ type: z.literal('TokenCreated'), cardId: CardIdSchema, defId: CardDefIdSchema, zoneId: ZoneIdSchema }),
  z.object({ type: z.literal('CardRevealed'), cardId: CardIdSchema, defId: CardDefIdSchema }),
  z.object({ type: z.literal('CardRecycled'), cardId: CardIdSchema, playerId: PlayerIdSchema }),
  // Unit state
  z.object({ type: z.literal('CardReadied'), cardId: CardIdSchema }),
  z.object({ type: z.literal('CardExhausted'), cardId: CardIdSchema }),
  z.object({ type: z.literal('CardKilled'), cardId: CardIdSchema }),
  z.object({ type: z.literal('CardBuffed'), cardId: CardIdSchema, amount: z.number().int() }),
  z.object({ type: z.literal('MightGiven'), cardId: CardIdSchema, amount: z.number().int() }),
  z.object({ type: z.literal('KeywordGranted'), cardId: CardIdSchema, keyword: z.string() }),
  // Combat
  z.object({ type: z.literal('DamageDealt'), sourceId: CardIdSchema, targetId: CardIdSchema, amount: z.number().int().nonnegative(), bonus: z.number().int().nonnegative() }),
  z.object({ type: z.literal('ControlChanged'), battlefieldId: BattlefieldIdSchema, newControllerId: PlayerIdSchema }),
  // Scoring
  z.object({ type: z.literal('PointScored'), playerId: PlayerIdSchema, method: z.enum(['Conquer', 'Hold', 'Effect']), battlefieldId: BattlefieldIdSchema.nullable() }),
  // Resources
  z.object({ type: z.literal('ResourceAdded'), playerId: PlayerIdSchema, energy: z.number().int(), power: z.number().int() }),
  z.object({ type: z.literal('RuneChanneled'), playerId: PlayerIdSchema, cardId: CardIdSchema }),
  z.object({ type: z.literal('XPGained'), cardId: CardIdSchema, amount: z.number().int().positive() }),
  z.object({ type: z.literal('XPSpent'), cardId: CardIdSchema, amount: z.number().int().positive() }),
  z.object({ type: z.literal('ExtraTurnGranted'), playerId: PlayerIdSchema }),
])
export type GameEvent = z.infer<typeof GameEventSchema>
