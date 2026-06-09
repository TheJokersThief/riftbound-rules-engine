import { z } from 'zod'
import { BattlefieldIdSchema, CardIdSchema, DecisionIdSchema, PlayerIdSchema } from './ids.js'

export const CombatUnitSchema = z.object({ cardId: CardIdSchema, might: z.number().int().nonnegative() })
export type CombatUnit = z.infer<typeof CombatUnitSchema>

const PriorityWindowSchema = z.object({ type: z.literal('PriorityWindow'), playerId: PlayerIdSchema })
const FocusWindowSchema = z.object({ type: z.literal('FocusWindow'), playerId: PlayerIdSchema, battlefieldId: BattlefieldIdSchema })
const ChooseTargetsDecisionSchema = z.object({ type: z.literal('ChooseTargets'), playerId: PlayerIdSchema, decisionId: DecisionIdSchema, prompt: z.string(), min: z.number().int().nonnegative(), max: z.number().int().positive() })
const ChooseYesNoDecisionSchema = z.object({ type: z.literal('ChooseYesNo'), playerId: PlayerIdSchema, decisionId: DecisionIdSchema, prompt: z.string() })
const ChooseOneDecisionSchema = z.object({ type: z.literal('ChooseOne'), playerId: PlayerIdSchema, decisionId: DecisionIdSchema, options: z.array(z.string()) })
const AssignDamageDecisionSchema = z.object({ type: z.literal('AssignDamage'), playerId: PlayerIdSchema, decisionId: DecisionIdSchema, attackers: z.array(CombatUnitSchema), totalDamage: z.number().int().nonnegative() })
const ChooseBattlefieldDecisionSchema = z.object({ type: z.literal('ChooseBattlefield'), playerId: PlayerIdSchema, options: z.array(CardIdSchema) })
const ChooseMulliganDecisionSchema = z.object({ type: z.literal('ChooseMulligan'), playerId: PlayerIdSchema, handSize: z.number().int().nonnegative() })

export const DecisionRequestSchema = z.discriminatedUnion('type', [
  PriorityWindowSchema,
  FocusWindowSchema,
  ChooseTargetsDecisionSchema,
  ChooseYesNoDecisionSchema,
  ChooseOneDecisionSchema,
  AssignDamageDecisionSchema,
  ChooseBattlefieldDecisionSchema,
  ChooseMulliganDecisionSchema,
])
export type DecisionRequest = z.infer<typeof DecisionRequestSchema>
