import type { CardDefId } from "@thejokersthief/riftbound-protocol";
import type { EffectProgram } from "@thejokersthief/riftbound-effect-ir";
import type { CardDataSource, ProgramDataSource } from "./source.js";
import { defaultProgramSource } from "./source.js";
import type { CardDefinition } from "./types.js";
import { CardDefinitionSchema } from "./types.js";

export interface CardCatalog {
  get(id: CardDefId): CardDefinition;
  find(id: CardDefId): CardDefinition | null;
  all(): CardDefinition[];
  programOf(id: CardDefId): EffectProgram;
  programs(): ReadonlyMap<string, EffectProgram>;
}

export async function createCardCatalog(
  source: CardDataSource,
  programSource: ProgramDataSource = defaultProgramSource,
): Promise<CardCatalog> {
  const entries = await source.load();
  const programMap = await programSource.load();
  const map = new Map<CardDefId, CardDefinition>();

  for (const entry of entries) {
    const result = CardDefinitionSchema.safeParse(entry);
    if (!result.success) {
      console.warn("Skipping invalid card entry:", result.error.message);
      continue;
    }
    map.set(result.data.id, result.data);
  }

  const unparsed: EffectProgram = { type: "Unparsed" };

  return Object.freeze({
    get(id: CardDefId): CardDefinition {
      const card = map.get(id);
      if (card === undefined) {
        throw new Error(`Unknown card definition id: ${id}`);
      }
      return card;
    },

    find(id: CardDefId): CardDefinition | null {
      return map.get(id) ?? null;
    },

    all(): CardDefinition[] {
      return Array.from(map.values());
    },

    programOf(id: CardDefId): EffectProgram {
      return programMap.get(id) ?? unparsed;
    },

    programs(): ReadonlyMap<string, EffectProgram> {
      return programMap;
    },
  });
}
