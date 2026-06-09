import type { AbilityNode } from '@thejokersthief/riftbound-effect-ir'

export class ParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ParseError'
  }
}

/**
 * Parse segments into AbilityNode[].
 *
 * v1: intentionally throws ParseError for all input.
 * The compiler infrastructure is valuable now; parser coverage will improve over time.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function parse(_sentences: string[]): AbilityNode[] {
  throw new ParseError('parser not yet implemented')
}
