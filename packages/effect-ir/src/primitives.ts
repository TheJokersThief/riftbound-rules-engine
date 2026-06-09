import { z } from 'zod'

export { Phase, PhaseSchema } from '@thejokersthief/riftbound-protocol'

export const PlayerRefSchema = z.enum(['You', 'Opponent', 'Controller', 'NonController'])
export type PlayerRef = z.infer<typeof PlayerRefSchema>

export const ZoneRefSchema = z.enum(['Hand', 'MainDeck', 'RuneDeck', 'Base', 'BattlefieldZone'])
export type ZoneRef = z.infer<typeof ZoneRefSchema>

export const AbilityTimingSchema = z.enum(['Chain', 'Showdown', 'Anytime', 'YourTurn'])
export type AbilityTiming = z.infer<typeof AbilityTimingSchema>

export const LayerNumberSchema = z.union([
  z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5),
])
export type LayerNumber = z.infer<typeof LayerNumberSchema>
