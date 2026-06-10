import { createCardCatalog, defaultSnapshotSource } from "@thejokersthief/riftbound-card-catalog";
import { serialize } from "@thejokersthief/riftbound-engine";
import { playFuzzGame } from "@thejokersthief/riftbound-test-helpers";
import { describe, expect, it } from "vitest";

const catalog = await createCardCatalog(defaultSnapshotSource);
const DETERMINISM_ITERATIONS = 50;

describe("determinism", () => {
  it("produces byte-identical serialized state when replayed with the same seed", () => {
    const seed = 42;
    const run1 = playFuzzGame(seed, catalog, DETERMINISM_ITERATIONS);
    const run2 = playFuzzGame(seed, catalog, DETERMINISM_ITERATIONS);
    expect(serialize(run1.matchState.currentGame)).toBe(serialize(run2.matchState.currentGame));
  });
});
