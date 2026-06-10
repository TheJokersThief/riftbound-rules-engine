import { describe, expect, it } from "vitest";
import { ConditionNodeSchema } from "./conditions.js";
import { CostNodeSchema } from "./costs.js";
import { AbilityNodeSchema, EffectNodeSchema, EffectProgramSchema } from "./program.js";
import { NumberExprSchema } from "./selectors.js";

// Helper: a minimal SelectorNode for tests
const anySelector = {
  scope: "Any" as const,
  objectType: "Unit" as const,
  location: { type: "Here" as const },
  filters: [],
  quantity: { type: "All" as const },
  chooser: "None" as const,
};

describe("EffectProgramSchema", () => {
  it("parses Unparsed program", () => {
    const result = EffectProgramSchema.safeParse({ type: "Unparsed" });
    expect(result.success).toBe(true);
  });

  it("parses a Compiled program with a Triggered ability and Deal action", () => {
    const program = {
      type: "Compiled",
      abilities: [
        {
          type: "Triggered",
          event: { type: "WhenPlayed" },
          effect: {
            type: "Deal",
            targets: anySelector,
            amount: 3,
          },
        },
      ],
    };
    const result = EffectProgramSchema.safeParse(program);
    if (!result.success) {
      console.error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });

  it("parses a Compiled program with a nested Sequence of Draw actions", () => {
    const program = {
      type: "Compiled",
      abilities: [
        {
          type: "Triggered",
          event: { type: "AtStartOfTurn" },
          effect: {
            type: "Sequence",
            effects: [
              { type: "Draw", player: "You", count: 1 },
              { type: "Draw", player: "You", count: 2 },
            ],
          },
        },
      ],
    };
    const result = EffectProgramSchema.safeParse(program);
    if (!result.success) {
      console.error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });

  it("parses a Conditional effect", () => {
    const program = {
      type: "Compiled",
      abilities: [
        {
          type: "Triggered",
          event: { type: "WhenAttacks" },
          effect: {
            type: "Conditional",
            condition: {
              type: "SelectorNonEmpty",
              selector: anySelector,
            },
            then: {
              type: "Buff",
              targets: anySelector,
              amount: 2,
            },
            else: {
              type: "Draw",
              player: "You",
              count: 1,
            },
          },
        },
      ],
    };
    const result = EffectProgramSchema.safeParse(program);
    if (!result.success) {
      console.error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });
});

describe("AbilityNodeSchema", () => {
  it("parses an Activated ability", () => {
    const ability = {
      type: "Activated",
      cost: [{ type: "Energy", amount: 2 }],
      timing: "Chain",
      effect: {
        type: "Draw",
        player: "You",
        count: 1,
      },
    };
    const result = AbilityNodeSchema.safeParse(ability);
    if (!result.success) {
      console.error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });

  it("parses a Static ability", () => {
    const ability = {
      type: "Static",
      layer: 2,
      modification: {
        type: "ModifyMight",
        targets: anySelector,
        amount: 1,
      },
    };
    const result = AbilityNodeSchema.safeParse(ability);
    if (!result.success) {
      console.error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });
});

describe("EffectNodeSchema", () => {
  it("parses a ForEach effect", () => {
    const effect = {
      type: "ForEach",
      selector: anySelector,
      effect: {
        type: "Kill",
        targets: anySelector,
      },
    };
    const result = EffectNodeSchema.safeParse(effect);
    expect(result.success).toBe(true);
  });

  it("parses a ChooseOne effect", () => {
    const effect = {
      type: "ChooseOne",
      options: [
        { type: "Draw", player: "You", count: 2 },
        { type: "AddResource", player: "You", energy: 1, power: 0 },
      ],
    };
    const result = EffectNodeSchema.safeParse(effect);
    expect(result.success).toBe(true);
  });

  it("rejects invalid effect type", () => {
    const result = EffectNodeSchema.safeParse({ type: "NotAnEffect" });
    expect(result.success).toBe(false);
  });
});

describe("CostNodeSchema", () => {
  it("rejects Energy cost with amount 0 (must be positive)", () => {
    const result = CostNodeSchema.safeParse({ type: "Energy", amount: 0 });
    expect(result.success).toBe(false);
  });
});

describe("ConditionNodeSchema", () => {
  it("parses a nested And containing two IsMyTurn conditions", () => {
    const condition = {
      type: "And",
      conditions: [{ type: "IsMyTurn" }, { type: "IsMyTurn" }],
    };
    const result = ConditionNodeSchema.safeParse(condition);
    if (!result.success) {
      console.error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });
});

describe("NumberExprSchema", () => {
  it("parses a CountOf expression with a valid selector", () => {
    const expr = {
      type: "CountOf",
      selector: anySelector,
    };
    const result = NumberExprSchema.safeParse(expr);
    if (!result.success) {
      console.error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });
});
