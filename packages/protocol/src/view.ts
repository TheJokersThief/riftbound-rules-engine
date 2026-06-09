import { z } from 'zod'
import { CardDefIdSchema, CardIdSchema, GameIdSchema, MatchIdSchema, PlayerIdSchema } from './ids.js'
import { DecisionRequestSchema } from './decisions.js'
import { PhaseSchema } from './events.js'

export const RuneSlotViewSchema = z.object({
  filled: z.boolean(),
  runeDefId: CardDefIdSchema.nullable(),
})
export type RuneSlotView = z.infer<typeof RuneSlotViewSchema>

export const ChainItemViewSchema = z.object({
  cardId: CardIdSchema,
  defId: CardDefIdSchema,
  controllerId: PlayerIdSchema,
  resolved: z.boolean(),
})
export type ChainItemView = z.infer<typeof ChainItemViewSchema>

export const CardInstanceViewSchema = z.object({
  cardId: CardIdSchema,
  defId: CardDefIdSchema.nullable(),
  exhausted: z.boolean(),
  buffAmount: z.number().int(),
  keywords: z.array(z.string()),
  counters: z.record(z.string(), z.number().int()),
  hidden: z.boolean(),
  faceDown: z.boolean(),
})
export type CardInstanceView = z.infer<typeof CardInstanceViewSchema>

const PlayerStateBaseSchema = z.object({
  mainDeck:    z.object({ count: z.number().int().nonnegative() }),
  runeDeck:    z.object({ count: z.number().int().nonnegative() }),
  runePool:    z.array(RuneSlotViewSchema),
  legend:      CardInstanceViewSchema,
  champion:    CardInstanceViewSchema,
  battlefield: CardInstanceViewSchema.nullable(),
  base:        z.array(CardInstanceViewSchema),
  resources:   z.object({ energy: z.number().int().nonnegative(), power: z.number().int().nonnegative() }),
  points:      z.number().int().nonnegative(),
})

export const SelfViewSchema = PlayerStateBaseSchema.extend({
  playerId: PlayerIdSchema,
  hand:     z.array(CardInstanceViewSchema),
})
export type SelfView = z.infer<typeof SelfViewSchema>

export const OpponentViewSchema = PlayerStateBaseSchema.extend({
  playerId:  PlayerIdSchema,
  handCount: z.number().int().nonnegative(),
})
export type OpponentView = z.infer<typeof OpponentViewSchema>

export const SharedViewSchema = z.object({
  gameId: GameIdSchema,
  matchId: MatchIdSchema,
  turnNumber: z.number().int().nonnegative(),
  activePlayerId: PlayerIdSchema,
  phase: PhaseSchema,
  chain: z.array(ChainItemViewSchema),
  pendingDecision: DecisionRequestSchema.nullable(),
  matchRecord: z.object({ wins: z.record(z.string(), z.number().int().nonnegative()) }),
})
export type SharedView = z.infer<typeof SharedViewSchema>

export const PlayerViewSchema = z.object({
  self: SelfViewSchema,
  opponent: OpponentViewSchema,
  shared: SharedViewSchema,
})
export type PlayerView = z.infer<typeof PlayerViewSchema>
