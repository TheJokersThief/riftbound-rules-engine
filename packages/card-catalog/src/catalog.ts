import type { CardDefId } from '@thejokersthief/riftbound-protocol'
import type { CardDataSource } from './source.js'
import type { CardDefinition } from './types.js'
import { CardDefinitionSchema } from './types.js'

export interface CardCatalog {
  get(id: CardDefId): CardDefinition
  find(id: CardDefId): CardDefinition | null
  all(): CardDefinition[]
}

export async function createCardCatalog(source: CardDataSource): Promise<CardCatalog> {
  const entries = await source.load()
  const map = new Map<CardDefId, CardDefinition>()

  for (const entry of entries) {
    const result = CardDefinitionSchema.safeParse(entry)
    if (!result.success) {
      console.warn('Skipping invalid card entry:', result.error.message)
      continue
    }
    map.set(result.data.id, result.data)
  }

  return Object.freeze({
    get(id: CardDefId): CardDefinition {
      const card = map.get(id)
      if (card === undefined) {
        throw new Error(`Unknown card definition id: ${id}`)
      }
      return card
    },

    find(id: CardDefId): CardDefinition | null {
      return map.get(id) ?? null
    },

    all(): CardDefinition[] {
      return Array.from(map.values())
    },
  })
}
