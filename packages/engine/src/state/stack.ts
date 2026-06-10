import { EffectNodeSchema } from '@thejokersthief/riftbound-effect-ir'
import {
  BattlefieldIdSchema,
  CardIdSchema,
  DecisionIdSchema,
  PlayerIdSchema,
} from '@thejokersthief/riftbound-protocol'
import { z } from 'zod'

// DamageAssignment — defined locally (protocol uses 'defenderId', this uses 'targetId' per engine spec)
export const DamageAssignmentSchema = z.object({
  attackerId: CardIdSchema,
  targetId: CardIdSchema,
  amount: z.number().int().nonnegative(),
})
export type DamageAssignment = z.infer<typeof DamageAssignmentSchema>

export const EffectFrameSchema = z.object({
  type: z.literal('Effect'),
  sourceId: CardIdSchema,
  controller: PlayerIdSchema,
  remaining: z.array(EffectNodeSchema),
  targets: z.array(CardIdSchema),
})
export type EffectFrame = z.infer<typeof EffectFrameSchema>

export const ChainFrameSchema = z.object({
  type: z.literal('Chain'),
  resumeAt: z.enum(['Finalize', 'Execute', 'Pass', 'Resolve']),
})
export type ChainFrame = z.infer<typeof ChainFrameSchema>

export const CombatFrameSchema = z.object({
  type: z.literal('Combat'),
  battlefieldId: BattlefieldIdSchema,
  step: z.enum(['Showdown', 'Damage', 'Resolution']),
  assignments: z.array(DamageAssignmentSchema).nullable(),
})
export type CombatFrame = z.infer<typeof CombatFrameSchema>

export const DecisionFrameSchema = z.object({
  type: z.literal('Decision'),
  decisionId: DecisionIdSchema,
  resumeFrame: z.discriminatedUnion('type', [
    EffectFrameSchema,
    ChainFrameSchema,
    CombatFrameSchema,
  ]),
})
export type DecisionFrame = z.infer<typeof DecisionFrameSchema>

export const StackFrameSchema = z.discriminatedUnion('type', [
  EffectFrameSchema,
  ChainFrameSchema,
  CombatFrameSchema,
  DecisionFrameSchema,
])
export type StackFrame = z.infer<typeof StackFrameSchema>
