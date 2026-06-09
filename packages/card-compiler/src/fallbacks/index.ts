import type { CardDefId } from '@thejokersthief/riftbound-protocol'
import type { EffectProgram } from '@thejokersthief/riftbound-effect-ir'

export interface FallbackRegistry {
  get(defId: CardDefId): EffectProgram | null
}

const registry: Record<string, EffectProgram> = {}

export const fallbackRegistry: FallbackRegistry = {
  get: (defId) => registry[defId] ?? null,
}
