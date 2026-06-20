import { describe, it, expect } from "vitest";
import { toCardDefId } from "@thejokersthief/riftbound-protocol";
import { createCardCatalog } from "./catalog.js";
import { defaultSnapshotSource } from "./source.js";

describe("catalog programs", () => {
  it("returns a Compiled program for a known card", async () => {
    const catalog = await createCardCatalog(defaultSnapshotSource);
    expect(catalog.programOf(toCardDefId("ogn-001-298")).type).toBe("Compiled");
  });

  it("returns Unparsed for an unknown card", async () => {
    const catalog = await createCardCatalog(defaultSnapshotSource);
    expect(catalog.programOf(toCardDefId("does-not-exist")).type).toBe("Unparsed");
  });

  it("exposes the full programs map", async () => {
    const catalog = await createCardCatalog(defaultSnapshotSource);
    expect(catalog.programs().size).toBeGreaterThan(0);
  });
});
