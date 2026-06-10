import type { GameEvent } from '@thejokersthief/riftbound-protocol'
import { expect } from 'vitest'

export function expectEvent(events: GameEvent[], partialEvent: Partial<GameEvent>): void {
  expect(events).toContainEqual(expect.objectContaining(partialEvent))
}

export function expectNoEvent(events: GameEvent[], eventType: GameEvent['type']): void {
  expect(events.every((e) => e.type !== eventType)).toBe(true)
}
