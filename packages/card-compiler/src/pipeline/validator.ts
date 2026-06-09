import type { AbilityNode } from '@thejokersthief/riftbound-effect-ir'

export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

/**
 * Validate parsed AbilityNode[].
 *
 * Currently a pass-through; validates once parser produces output.
 */
export function validate(abilities: AbilityNode[]): AbilityNode[] {
  return abilities
}
