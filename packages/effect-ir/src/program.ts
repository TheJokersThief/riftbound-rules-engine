import { z } from 'zod'
import { type ActionNode, ActionNodeSchema } from './actions.js'
import { type ConditionNode, ConditionNodeSchema } from './conditions.js'
import { type CostNode, CostNodeSchema, type TriggerEvent, TriggerEventSchema } from './costs.js'
import {
  type AbilityTiming,
  AbilityTimingSchema,
  type LayerNumber,
  LayerNumberSchema,
  type PlayerRef,
  PlayerRefSchema,
} from './primitives.js'
import { type SelectorNode, SelectorNodeSchema } from './selectors.js'

// ---- Types (declared first so they can reference each other) ----

export type ModificationNode =
  | { type: 'ModifyMight'; targets: SelectorNode; amount: number }
  | { type: 'AddKeyword'; targets: SelectorNode; keyword: string }
  | { type: 'GrantAbility'; targets: SelectorNode; ability: AbilityNode }
  | { type: 'ModifySpellDamage'; player: PlayerRef; amount: number }
  | { type: 'PreventDamage'; targets: SelectorNode }

export type AbilityNode =
  | {
      type: 'Triggered'
      event: TriggerEvent
      condition?: ConditionNode | undefined
      effect: EffectNode
    }
  | { type: 'Activated'; cost: CostNode[]; timing: AbilityTiming; effect: EffectNode }
  | { type: 'Static'; layer: LayerNumber; modification: ModificationNode }

export type EffectNode =
  | ActionNode
  | { type: 'Sequence'; effects: EffectNode[] }
  | { type: 'Optional'; effect: EffectNode; prompt?: string | undefined }
  | { type: 'ChooseOne'; options: EffectNode[] }
  | {
      type: 'Conditional'
      condition: ConditionNode
      then: EffectNode
      else?: EffectNode | undefined
    }
  | { type: 'ForEach'; selector: SelectorNode; effect: EffectNode }

export type EffectProgram = { type: 'Compiled'; abilities: AbilityNode[] } | { type: 'Unparsed' }

// ---- Schemas (all z.lazy to handle mutual recursion) ----

export const ModificationNodeSchema: z.ZodType<ModificationNode, z.ZodTypeDef, unknown> = z.lazy(
  () =>
    z.discriminatedUnion('type', [
      z.object({
        type: z.literal('ModifyMight'),
        targets: SelectorNodeSchema,
        amount: z.number().int(),
      }),
      z.object({ type: z.literal('AddKeyword'), targets: SelectorNodeSchema, keyword: z.string() }),
      z.object({
        type: z.literal('GrantAbility'),
        targets: SelectorNodeSchema,
        ability: AbilityNodeSchema,
      }),
      z.object({
        type: z.literal('ModifySpellDamage'),
        player: PlayerRefSchema,
        amount: z.number().int(),
      }),
      z.object({ type: z.literal('PreventDamage'), targets: SelectorNodeSchema }),
    ])
)

export const AbilityNodeSchema: z.ZodType<AbilityNode, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({
      type: z.literal('Triggered'),
      event: TriggerEventSchema,
      condition: ConditionNodeSchema.optional(),
      effect: EffectNodeSchema,
    }),
    z.object({
      type: z.literal('Activated'),
      cost: z.array(CostNodeSchema),
      timing: AbilityTimingSchema,
      effect: EffectNodeSchema,
    }),
    z.object({
      type: z.literal('Static'),
      layer: LayerNumberSchema,
      modification: ModificationNodeSchema,
    }),
  ])
)

export const EffectNodeSchema: z.ZodType<EffectNode, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.discriminatedUnion('type', [
    // Spread ActionNode options inline so they participate in the same discriminated union
    ...ActionNodeSchema.options,
    z.object({ type: z.literal('Sequence'), effects: z.array(EffectNodeSchema) }),
    z.object({
      type: z.literal('Optional'),
      effect: EffectNodeSchema,
      prompt: z.string().optional(),
    }),
    z.object({ type: z.literal('ChooseOne'), options: z.array(EffectNodeSchema) }),
    z.object({
      type: z.literal('Conditional'),
      condition: ConditionNodeSchema,
      then: EffectNodeSchema,
      else: EffectNodeSchema.optional(),
    }),
    z.object({
      type: z.literal('ForEach'),
      selector: SelectorNodeSchema,
      effect: EffectNodeSchema,
    }),
  ])
)

export const EffectProgramSchema: z.ZodType<EffectProgram, z.ZodTypeDef, unknown> =
  z.discriminatedUnion('type', [
    z.object({ type: z.literal('Compiled'), abilities: z.array(AbilityNodeSchema) }),
    z.object({ type: z.literal('Unparsed') }),
  ])
