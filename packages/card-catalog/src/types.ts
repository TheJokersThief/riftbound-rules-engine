import { z } from 'zod'
import { CardDefIdSchema } from '@thejokersthief/riftbound-protocol'

export const PlayCostSchema = z.object({
  energy: z.number().int().min(0),
  power: z.number().int().min(0),
  runes: z.array(z.string()),
})

export type PlayCost = z.infer<typeof PlayCostSchema>

export const CardTypeSchema = z.enum([
  'Unit',
  'Gear',
  'Spell',
  'Legend',
  'ChosenChampion',
  'Battlefield',
  'Rune',
])

export type CardType = z.infer<typeof CardTypeSchema>

export const DeckZoneSchema = z.enum([
  'Main',
  'Rune',
  'Legend',
  'Champion',
  'Battlefield',
])

export type DeckZone = z.infer<typeof DeckZoneSchema>

export const CardDefinitionSchema = z.object({
  id: CardDefIdSchema,
  name: z.string(),
  cardType: CardTypeSchema,
  set: z.string(),
  rarity: z.string().nullable(),
  abilityText: z.string(),
  might: z.number().int().min(0).nullable(),
  playCost: PlayCostSchema.nullable(),
  deckZone: DeckZoneSchema,
  keywords: z.array(z.string()),
})

export type CardDefinition = z.infer<typeof CardDefinitionSchema>

export const CardSnapshotSchema = z.record(CardDefIdSchema, CardDefinitionSchema)
