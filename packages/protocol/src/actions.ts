import { z } from 'zod'
import { CardDefIdSchema, CardIdSchema, DecisionIdSchema, PlayerIdSchema } from './ids.js'

export const TargetSelectionSchema = z.object({ targets: z.array(CardIdSchema) })
export type TargetSelection = z.infer<typeof TargetSelectionSchema>

export const DamageAssignmentSchema = z.object({
  attackerId: CardIdSchema,
  defenderId: CardIdSchema,
  amount: z.number().int().nonnegative(),
})
export type DamageAssignment = z.infer<typeof DamageAssignmentSchema>

const ChooseBattlefieldActionSchema = z.object({ type: z.literal('ChooseBattlefield'), playerId: PlayerIdSchema, cardDefId: CardDefIdSchema })
const KeepHandActionSchema = z.object({ type: z.literal('KeepHand'), playerId: PlayerIdSchema })
const MulliganActionSchema = z.object({ type: z.literal('Mulligan'), playerId: PlayerIdSchema })
const EndTurnActionSchema = z.object({ type: z.literal('EndTurn'), playerId: PlayerIdSchema })
const PlayCardActionSchema = z.object({ type: z.literal('PlayCard'), playerId: PlayerIdSchema, cardId: CardIdSchema, targets: TargetSelectionSchema.optional() })
const ActivateAbilityActionSchema = z.object({ type: z.literal('ActivateAbility'), playerId: PlayerIdSchema, sourceId: CardIdSchema, abilityIndex: z.number().int().nonnegative(), targets: TargetSelectionSchema.optional() })
const PassPriorityActionSchema = z.object({ type: z.literal('PassPriority'), playerId: PlayerIdSchema })
const PassFocusActionSchema = z.object({ type: z.literal('PassFocus'), playerId: PlayerIdSchema })
const AssignDamageActionSchema = z.object({ type: z.literal('AssignDamage'), playerId: PlayerIdSchema, assignments: z.array(DamageAssignmentSchema) })
const ChooseTargetsActionSchema = z.object({ type: z.literal('ChooseTargets'), playerId: PlayerIdSchema, decisionId: DecisionIdSchema, targets: z.array(CardIdSchema) })
const ChooseYesNoActionSchema = z.object({ type: z.literal('ChooseYesNo'), playerId: PlayerIdSchema, decisionId: DecisionIdSchema, choice: z.boolean() })
const ChooseOneActionSchema = z.object({ type: z.literal('ChooseOne'), playerId: PlayerIdSchema, decisionId: DecisionIdSchema, index: z.number().int().nonnegative() })

export const ActionSchema = z.discriminatedUnion('type', [
  ChooseBattlefieldActionSchema,
  KeepHandActionSchema,
  MulliganActionSchema,
  EndTurnActionSchema,
  PlayCardActionSchema,
  ActivateAbilityActionSchema,
  PassPriorityActionSchema,
  PassFocusActionSchema,
  AssignDamageActionSchema,
  ChooseTargetsActionSchema,
  ChooseYesNoActionSchema,
  ChooseOneActionSchema,
])
export type Action = z.infer<typeof ActionSchema>
