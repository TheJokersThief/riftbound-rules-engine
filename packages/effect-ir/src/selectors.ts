import { z } from "zod";

// FilterNode (non-recursive)
export const FilterNodeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("MightLE"), value: z.number().int() }),
  z.object({ type: z.literal("MightGE"), value: z.number().int() }),
  z.object({ type: z.literal("IsReady") }),
  z.object({ type: z.literal("IsExhausted") }),
  z.object({ type: z.literal("IsBuffed") }),
  z.object({ type: z.literal("HasKeyword"), keyword: z.string() }),
  z.object({ type: z.literal("Named"), name: z.string() }),
  z.object({ type: z.literal("IsThis") }),
]);
export type FilterNode = z.infer<typeof FilterNodeSchema>;

// LocationFilter (non-recursive)
export const LocationFilterSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("Here") }),
  z.object({ type: z.literal("AtBattlefields") }),
  z.object({ type: z.literal("AtBase") }),
  z.object({ type: z.literal("InHand") }),
  z.object({ type: z.literal("TopOfDeck"), count: z.number().int().positive() }),
]);
export type LocationFilter = z.infer<typeof LocationFilterSchema>;

export const QuantitySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("One") }),
  z.object({ type: z.literal("All") }),
  z.object({ type: z.literal("UpTo"), count: z.number().int().positive() }),
  z.object({ type: z.literal("Exactly"), count: z.number().int().positive() }),
]);
export type Quantity = z.infer<typeof QuantitySchema>;

export type SelectorNode = {
  scope: "Friendly" | "Enemy" | "Any";
  objectType: "Unit" | "Gear" | "Spell" | "Card" | "Player";
  location: LocationFilter;
  filters: FilterNode[];
  quantity: Quantity;
  chooser: "You" | "Opponent" | "Controller" | "None";
};

export const SelectorNodeSchema: z.ZodType<SelectorNode> = z.object({
  scope: z.enum(["Friendly", "Enemy", "Any"]),
  objectType: z.enum(["Unit", "Gear", "Spell", "Card", "Player"]),
  location: LocationFilterSchema,
  filters: z.array(FilterNodeSchema),
  quantity: QuantitySchema,
  chooser: z.enum(["You", "Opponent", "Controller", "None"]),
});

// NumberExpr — may reference SelectorNode
export type NumberExpr =
  | number
  | { type: "MightOf"; target: SelectorNode }
  | { type: "CountOf"; selector: SelectorNode };

export const NumberExprSchema: z.ZodType<NumberExpr> = z.union([
  z.number(),
  z.object({ type: z.literal("MightOf"), target: SelectorNodeSchema }),
  z.object({ type: z.literal("CountOf"), selector: SelectorNodeSchema }),
]);
