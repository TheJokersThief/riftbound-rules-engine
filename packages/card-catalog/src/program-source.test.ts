import { describe, it, expect } from "vitest";
import { toCardDefId } from "@thejokersthief/riftbound-protocol";
import { defaultProgramSource } from "./source.js";

describe("defaultProgramSource", () => {
  it("loads compiled programs keyed by CardDefId", async () => {
    const programs = await defaultProgramSource.load();
    const prog = programs.get(toCardDefId("ogn-001-298"));
    expect(prog).toBeDefined();
    expect(prog!.type).toBe("Compiled");
  });
});
