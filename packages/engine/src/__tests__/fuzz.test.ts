import { createCardCatalog, defaultSnapshotSource } from "@thejokersthief/riftbound-card-catalog";
import { FUZZ_ITERATIONS, playFuzzGame } from "@thejokersthief/riftbound-test-helpers";
import { describe, expect, it } from "vitest";

const catalog = await createCardCatalog(defaultSnapshotSource);
const REDUCED_ITERATIONS = Math.min(FUZZ_ITERATIONS, 20);

describe("fuzz playthroughs", () => {
  it("completes random games without throwing", () => {
    for (let seed = 0; seed < REDUCED_ITERATIONS; seed++) {
      expect(() => playFuzzGame(seed, catalog, 100)).not.toThrow();
    }
  });
});
