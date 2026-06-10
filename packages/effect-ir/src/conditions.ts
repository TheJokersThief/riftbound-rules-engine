import { z } from "zod";
import { type Phase, PhaseSchema, type PlayerRef, PlayerRefSchema } from "./primitives.js";
import { type SelectorNode, SelectorNodeSchema } from "./selectors.js";

export type ConditionNode =
  | { type: "And"; conditions: ConditionNode[] }
  | { type: "Or"; conditions: ConditionNode[] }
  | { type: "Not"; condition: ConditionNode }
  | { type: "SelectorNonEmpty"; selector: SelectorNode }
  | { type: "CardIsBuffed"; selector: SelectorNode }
  | { type: "CardHasKeyword"; selector: SelectorNode; keyword: string }
  | { type: "ControlsBattlefield"; player: PlayerRef }
  | { type: "PlayerHasPoints"; player: PlayerRef; atLeast: number }
  | { type: "IsPhase"; phase: Phase }
  | { type: "IsMyTurn" };

export const ConditionNodeSchema: z.ZodType<ConditionNode> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.object({ type: z.literal("And"), conditions: z.array(ConditionNodeSchema) }),
    z.object({ type: z.literal("Or"), conditions: z.array(ConditionNodeSchema) }),
    z.object({ type: z.literal("Not"), condition: ConditionNodeSchema }),
    z.object({ type: z.literal("SelectorNonEmpty"), selector: SelectorNodeSchema }),
    z.object({ type: z.literal("CardIsBuffed"), selector: SelectorNodeSchema }),
    z.object({
      type: z.literal("CardHasKeyword"),
      selector: SelectorNodeSchema,
      keyword: z.string(),
    }),
    z.object({ type: z.literal("ControlsBattlefield"), player: PlayerRefSchema }),
    z.object({
      type: z.literal("PlayerHasPoints"),
      player: PlayerRefSchema,
      atLeast: z.number().int().nonnegative(),
    }),
    z.object({ type: z.literal("IsPhase"), phase: PhaseSchema }),
    z.object({ type: z.literal("IsMyTurn") }),
  ]),
);
