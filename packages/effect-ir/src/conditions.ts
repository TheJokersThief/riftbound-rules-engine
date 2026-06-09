import { z } from 'zod'
import { PhaseSchema, PlayerRefSchema } from './primitives.js'
import { FilterNodeSchema, SelectorNodeSchema, SelectorNode } from './selectors.js'

export type ConditionNode =
  | { type: 'And'; conditions: ConditionNode[] }
  | { type: 'Or'; conditions: ConditionNode[] }
  | { type: 'Not'; condition: ConditionNode }
  | { type: 'SelectorNonEmpty'; selector: SelectorNode }
  | { type: 'CardIsBuffed'; selector: SelectorNode }
  | { type: 'CardHasKeyword'; selector: SelectorNode; keyword: string }
  | { type: 'ControlsBattlefield'; player: z.infer<typeof PlayerRefSchema> }
  | { type: 'PlayerHasPoints'; player: z.infer<typeof PlayerRefSchema>; atLeast: number }
  | { type: 'IsPhase'; phase: z.infer<typeof PhaseSchema> }
  | { type: 'IsMyTurn' }

// Use ZodType<ConditionNode | undefined> for the optional variant used in parent schemas
export type OptionalConditionNode = ConditionNode | undefined

export const ConditionNodeSchema: z.ZodType<ConditionNode> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({ type: z.literal('And'), conditions: z.array(ConditionNodeSchema) }),
    z.object({ type: z.literal('Or'), conditions: z.array(ConditionNodeSchema) }),
    z.object({ type: z.literal('Not'), condition: ConditionNodeSchema }),
    z.object({ type: z.literal('SelectorNonEmpty'), selector: SelectorNodeSchema }),
    z.object({ type: z.literal('CardIsBuffed'), selector: SelectorNodeSchema }),
    z.object({ type: z.literal('CardHasKeyword'), selector: SelectorNodeSchema, keyword: z.string() }),
    z.object({ type: z.literal('ControlsBattlefield'), player: PlayerRefSchema }),
    z.object({ type: z.literal('PlayerHasPoints'), player: PlayerRefSchema, atLeast: z.number().int().nonnegative() }),
    z.object({ type: z.literal('IsPhase'), phase: PhaseSchema }),
    z.object({ type: z.literal('IsMyTurn') }),
  ])
)

// Suppress unused import warning — FilterNodeSchema is used for type completeness
void FilterNodeSchema
