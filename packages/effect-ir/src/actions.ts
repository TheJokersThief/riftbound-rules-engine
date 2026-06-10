import { CardDefIdSchema } from "@thejokersthief/riftbound-protocol";
import { z } from "zod";
import { PlayerRefSchema, ZoneRefSchema } from "./primitives.js";
import { NumberExprSchema, SelectorNodeSchema } from "./selectors.js";

export const ActionNodeSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("Deal"),
    targets: SelectorNodeSchema,
    amount: NumberExprSchema,
    bonus: NumberExprSchema.optional(),
  }),
  z.object({ type: z.literal("Draw"), player: PlayerRefSchema, count: NumberExprSchema }),
  z.object({ type: z.literal("Discard"), targets: SelectorNodeSchema }),
  z.object({ type: z.literal("Move"), targets: SelectorNodeSchema, toZone: ZoneRefSchema }),
  z.object({ type: z.literal("Recall"), targets: SelectorNodeSchema }),
  z.object({ type: z.literal("ReturnToHand"), targets: SelectorNodeSchema }),
  z.object({ type: z.literal("Buff"), targets: SelectorNodeSchema, amount: NumberExprSchema }),
  z.object({ type: z.literal("Ready"), targets: SelectorNodeSchema }),
  z.object({ type: z.literal("Exhaust"), targets: SelectorNodeSchema }),
  z.object({ type: z.literal("Kill"), targets: SelectorNodeSchema }),
  z.object({ type: z.literal("Banish"), targets: SelectorNodeSchema }),
  z.object({
    type: z.literal("CreateToken"),
    defId: CardDefIdSchema,
    zone: ZoneRefSchema,
    count: NumberExprSchema,
  }),
  z.object({ type: z.literal("Counter"), targets: SelectorNodeSchema }),
  z.object({
    type: z.literal("AddResource"),
    player: PlayerRefSchema,
    energy: NumberExprSchema,
    power: NumberExprSchema,
  }),
  z.object({ type: z.literal("GainXP"), targets: SelectorNodeSchema, amount: NumberExprSchema }),
  z.object({ type: z.literal("SpendXP"), targets: SelectorNodeSchema, amount: NumberExprSchema }),
  z.object({ type: z.literal("Reveal"), targets: SelectorNodeSchema }),
  z.object({ type: z.literal("Recycle"), targets: SelectorNodeSchema }),
  z.object({ type: z.literal("GiveMight"), targets: SelectorNodeSchema, amount: NumberExprSchema }),
  z.object({ type: z.literal("GrantKeyword"), targets: SelectorNodeSchema, keyword: z.string() }),
  z.object({ type: z.literal("TakeExtraTurn"), player: PlayerRefSchema }),
]);
export type ActionNode = z.infer<typeof ActionNodeSchema>;
