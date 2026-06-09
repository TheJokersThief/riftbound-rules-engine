import { z } from 'zod'
import {
  CardIdSchema,
  BattlefieldIdSchema,
  DecisionIdSchema,
  PlayerIdSchema,
} from '@thejokersthief/riftbound-protocol'
import { EffectNodeSchema } from '@thejokersthief/riftbound-effect-ir'

// DamageAssignment — defined locally (protocol uses 'defenderId', this uses 'targetId' per engine spec)
export const DamageAssignmentSchema = z.object({
  attackerId: CardIdSchema,
  targetId: CardIdSchema,
  amount: z.number().int().nonnegative(),
})
export type DamageAssignment = z.infer<typeof DamageAssignmentSchema>

// EffectFrame
export const EffectFrameSchema = z.object({
  type: z.literal('Effect'),
  sourceId: CardIdSchema,
  controller: PlayerIdSchema,
  remaining: z.array(EffectNodeSchema),
  targets: z.array(CardIdSchema),
})
export type EffectFrame = z.infer<typeof EffectFrameSchema>

// ChainFrame
export const ChainFrameSchema = z.object({
  type: z.literal('Chain'),
  resumeAt: z.enum(['Finalize', 'Execute', 'Pass', 'Resolve']),
})
export type ChainFrame = z.infer<typeof ChainFrameSchema>

// CombatFrame
export const CombatFrameSchema = z.object({
  type: z.literal('Combat'),
  battlefieldId: BattlefieldIdSchema,
  step: z.enum(['Showdown', 'Damage', 'Resolution']),
  assignments: z.array(DamageAssignmentSchema).nullable(),
})
export type CombatFrame = z.infer<typeof CombatFrameSchema>

// DecisionFrame — resumeFrame is one of the above (not DecisionFrame itself)
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

// StackFrame union
export const StackFrameSchema = z.discriminatedUnion('type', [
  EffectFrameSchema,
  ChainFrameSchema,
  CombatFrameSchema,
  DecisionFrameSchema,
])
export type StackFrame = z.infer<typeof StackFrameSchema>
