import { z } from 'zod'
import { FilterNodeSchema, type SelectorNode, SelectorNodeSchema } from './selectors.js'

export const RuneSymbolSchema = z.enum(['action', 'reaction', 'any'])
export type RuneSymbol = z.infer<typeof RuneSymbolSchema>

export const TriggerEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('WhenPlayed') }),
  z.object({ type: z.literal('WhenAttacks') }),
  z.object({ type: z.literal('WhenDealtDamage') }),
  z.object({ type: z.literal('WhenKilled') }),
  z.object({ type: z.literal('WhenFriendlyDies'), filter: z.array(FilterNodeSchema).optional() }),
  z.object({ type: z.literal('WhenEnemyDies'), filter: z.array(FilterNodeSchema).optional() }),
  z.object({ type: z.literal('WhenChanneled') }),
  z.object({ type: z.literal('AtStartOfTurn') }),
  z.object({ type: z.literal('AtEndOfTurn') }),
  z.object({
    type: z.literal('WhenEntersPlay'),
    scope: z.enum(['Friendly', 'Enemy', 'Any']),
    filter: z.array(FilterNodeSchema).optional(),
  }),
  z.object({ type: z.literal('WhenConquer') }),
  z.object({ type: z.literal('WhenHold') }),
])
export type TriggerEvent = z.infer<typeof TriggerEventSchema>

export type CostNode =
  | { type: 'Energy'; amount: number }
  | { type: 'Power'; amount: number }
  | { type: 'Rune'; symbols: RuneSymbol[] }
  | { type: 'Exhaust' }
  | { type: 'Sacrifice'; targets: SelectorNode }
  | { type: 'Discard'; targets: SelectorNode }
  | { type: 'SpendXP'; amount: number }
  | { type: 'AdditionalCost'; cost: CostNode }

export const CostNodeSchema: z.ZodType<CostNode> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({ type: z.literal('Energy'), amount: z.number().int().positive() }),
    z.object({ type: z.literal('Power'), amount: z.number().int().positive() }),
    z.object({ type: z.literal('Rune'), symbols: z.array(RuneSymbolSchema) }),
    z.object({ type: z.literal('Exhaust') }),
    z.object({ type: z.literal('Sacrifice'), targets: SelectorNodeSchema }),
    z.object({ type: z.literal('Discard'), targets: SelectorNodeSchema }),
    z.object({ type: z.literal('SpendXP'), amount: z.number().int().positive() }),
    z.object({ type: z.literal('AdditionalCost'), cost: CostNodeSchema }),
  ])
)
