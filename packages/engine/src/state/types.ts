import { z } from 'zod'
import {
  CardIdSchema,
  CardDefIdSchema,
  PlayerIdSchema,
  BattlefieldIdSchema,
  GameIdSchema,
  MatchIdSchema,
} from '@thejokersthief/riftbound-protocol'
import { PhaseSchema, DecisionRequestSchema } from '@thejokersthief/riftbound-protocol'
import { StackFrameSchema } from './stack.js'

// RuneSlot
export const RuneSlotSchema = z.object({
  filled: z.boolean(),
  runeCardId: CardIdSchema.nullable(),
})
export type RuneSlot = z.infer<typeof RuneSlotSchema>

// PlayerState
export const PlayerStateSchema = z.object({
  hand: z.array(CardIdSchema),
  mainDeck: z.array(CardIdSchema),
  runeDeck: z.array(CardIdSchema),
  runePool: z.array(RuneSlotSchema),
  legendZone: CardIdSchema,
  championZone: CardIdSchema,
  base: z.array(CardIdSchema),
  resources: z.object({ energy: z.number().int(), power: z.number().int() }),
  points: z.number().int().nonnegative(),
})
export type PlayerState = z.infer<typeof PlayerStateSchema>

// CardInstance
export const CardInstanceSchema = z.object({
  id: CardIdSchema,
  defId: CardDefIdSchema,
  ownerId: PlayerIdSchema,
  exhausted: z.boolean(),
  buffAmount: z.number().int(),
  keywords: z.array(z.string()),
  xp: z.number().int().nonnegative(),
  counters: z.record(z.string(), z.number().int()),
  faceDown: z.boolean(),
})
export type CardInstance = z.infer<typeof CardInstanceSchema>

// BattlefieldState
export const BattlefieldStateSchema = z.object({
  id: BattlefieldIdSchema,
  cardId: CardIdSchema,
  controllerId: PlayerIdSchema.nullable(),
  units: z.array(CardIdSchema),
})
export type BattlefieldState = z.infer<typeof BattlefieldStateSchema>

// ChainItem
export const ChainItemSchema = z.object({
  id: z.string(),
  sourceId: CardIdSchema,
  defId: CardDefIdSchema,
  controller: PlayerIdSchema,
  targets: z.array(CardIdSchema),
  resolved: z.boolean(),
})
export type ChainItem = z.infer<typeof ChainItemSchema>

// ShowdownState
export const ShowdownStateSchema = z.object({
  battlefieldId: BattlefieldIdSchema,
  kind: z.enum(['Combat', 'Control']),
})
export type ShowdownState = z.infer<typeof ShowdownStateSchema>

// ChainState
export const ChainStateSchema = z.object({
  isOpen: z.boolean(),
  items: z.array(ChainItemSchema),
  priority: PlayerIdSchema.nullable(),
  focus: PlayerIdSchema.nullable(),
  showdown: ShowdownStateSchema.nullable(),
})
export type ChainState = z.infer<typeof ChainStateSchema>

// TriggeredAbilityTask — stub for sub-spec #9
export const TriggeredAbilityTaskSchema = z.object({
  sourceId: CardIdSchema,
  abilityIndex: z.number().int().nonnegative(),
  controller: PlayerIdSchema,
})
export type TriggeredAbilityTask = z.infer<typeof TriggeredAbilityTaskSchema>

// GameState
export const GameStateSchema = z.object({
  gameId: GameIdSchema,
  matchId: MatchIdSchema,
  playerIds: z.tuple([PlayerIdSchema, PlayerIdSchema]),
  cards: z.record(CardIdSchema, CardInstanceSchema),
  players: z.record(PlayerIdSchema, PlayerStateSchema),
  battlefields: z.record(BattlefieldIdSchema, BattlefieldStateSchema),
  turnNumber: z.number().int().nonnegative(),
  activePlayerId: PlayerIdSchema,
  phase: PhaseSchema,
  chain: ChainStateSchema,
  resolutionStack: z.array(StackFrameSchema),
  pendingDecision: DecisionRequestSchema.nullable(),
  rng: z.object({ seed: z.number().int() }),
  scoredThisTurn: z.record(PlayerIdSchema, z.array(BattlefieldIdSchema)),
  status: z.enum(['setup', 'playing', 'ended']),
  winner: PlayerIdSchema.nullable(),
  hotQueue: z.array(TriggeredAbilityTaskSchema),
  holdEligible: z.array(BattlefieldIdSchema),
  firstTurnSecondPlayer: z.boolean(),
})
export type GameState = z.infer<typeof GameStateSchema>
