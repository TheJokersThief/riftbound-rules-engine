import { describe, it, expect, vi } from 'vitest'
import { CardDefinitionSchema, CardDefinition } from './types.js'
import { SnapshotCardDataSource, CardDataSource, defaultSnapshotSource } from './source.js'
import { createCardCatalog } from './catalog.js'
import type { CardDefId } from '@thejokersthief/riftbound-protocol'
import { fileURLToPath } from 'url'
import { join, dirname } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const snapshotPath = join(__dirname, '..', 'data', 'cards.json')

// ─── Schema tests ────────────────────────────────────────────────────────────

describe('CardDefinitionSchema', () => {
  it('parses a valid unit card', () => {
    const input = {
      id: 'unt001',
      name: 'Ashguard Sentinel',
      cardType: 'Unit',
      set: 'core',
      rarity: 'Common',
      abilityText: 'Armor.',
      might: 3,
      playCost: { energy: 2, power: 1, runes: [] },
      deckZone: 'Main',
      keywords: ['Armor'],
    }
    const result = CardDefinitionSchema.safeParse(input)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.name).toBe('Ashguard Sentinel')
      expect(result.data.might).toBe(3)
    }
  })

  it('parses a valid Battlefield card with might: null and playCost: null', () => {
    const input = {
      id: 'btf001',
      name: 'The Verdant Hollow',
      cardType: 'Battlefield',
      set: 'core',
      rarity: null,
      abilityText: 'At the start of each turn, gain 1 energy.',
      might: null,
      playCost: null,
      deckZone: 'Battlefield',
      keywords: ['Forest'],
    }
    const result = CardDefinitionSchema.safeParse(input)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.might).toBeNull()
      expect(result.data.playCost).toBeNull()
    }
  })

  it('rejects a card with negative might', () => {
    const input = {
      id: 'unt999',
      name: 'Bad Unit',
      cardType: 'Unit',
      set: 'core',
      rarity: null,
      abilityText: '',
      might: -1,
      playCost: { energy: 1, power: 0, runes: [] },
      deckZone: 'Main',
      keywords: [],
    }
    const result = CardDefinitionSchema.safeParse(input)
    expect(result.success).toBe(false)
  })
})

// ─── SnapshotCardDataSource tests ─────────────────────────────────────────────

describe('SnapshotCardDataSource', () => {
  it('loads the real data/cards.json and returns an array of cards', async () => {
    const source = new SnapshotCardDataSource(snapshotPath)
    const cards = await source.load()
    expect(Array.isArray(cards)).toBe(true)
    expect(cards.length).toBeGreaterThan(0)
  })
})

// ─── createCardCatalog tests ──────────────────────────────────────────────────

describe('createCardCatalog with real snapshot', () => {
  it('get() returns a known card by ID', async () => {
    const catalog = await createCardCatalog(defaultSnapshotSource)
    const card = catalog.get('unt001' as CardDefId)
    expect(card.name).toBe('Ashguard Sentinel')
  })

  it('find() returns null for an unknown ID', async () => {
    const catalog = await createCardCatalog(defaultSnapshotSource)
    const card = catalog.find('zzzzzz' as CardDefId)
    expect(card).toBeNull()
  })

  it('get() throws for an unknown ID', async () => {
    const catalog = await createCardCatalog(defaultSnapshotSource)
    expect(() => catalog.get('zzzzzz' as CardDefId)).toThrow()
  })
})

// ─── createCardCatalog with inline fixture ────────────────────────────────────

describe('createCardCatalog with inline fixture', () => {
  const validCard: unknown = {
    id: 'aaa001',
    name: 'Valid Unit',
    cardType: 'Unit',
    set: 'test',
    rarity: null,
    abilityText: 'Does something.',
    might: 2,
    playCost: { energy: 1, power: 0, runes: [] },
    deckZone: 'Main',
    keywords: [],
  }

  it('skips invalid entries and logs warnings', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // Source returns one valid and one invalid card
    // We parse them through CardDefinitionSchema in createCardCatalog
    // But source.load() returns CardDefinition[] — so we need to fake-parse
    // the invalid card as passing through source.load() but failing re-validation.
    // Since createCardCatalog re-validates each entry, we can return a manipulated object.
    const invalidAsDefinition = {
      id: 'bad001',
      name: 'Bad Unit',
      cardType: 'Unit',
      set: 'test',
      rarity: null,
      abilityText: '',
      might: -5, // negative — will fail CardDefinitionSchema
      playCost: { energy: 1, power: 0, runes: [] },
      deckZone: 'Main',
      keywords: [],
    } as unknown as CardDefinition

    const fakeSource: CardDataSource = {
      load: async () => [
        CardDefinitionSchema.parse(validCard),
        invalidAsDefinition,
      ],
    }

    const catalog = await createCardCatalog(fakeSource)
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()

    const all = catalog.all()
    expect(all.length).toBe(1)
    expect(all[0]?.name).toBe('Valid Unit')
  })

  it('all() returns all valid entries', async () => {
    const anotherValid: unknown = {
      id: 'aaa002',
      name: 'Another Valid Unit',
      cardType: 'Unit',
      set: 'test',
      rarity: null,
      abilityText: 'Also does something.',
      might: 4,
      playCost: { energy: 3, power: 0, runes: [] },
      deckZone: 'Main',
      keywords: [],
    }

    const fakeSource: CardDataSource = {
      load: async () => [
        CardDefinitionSchema.parse(validCard),
        CardDefinitionSchema.parse(anotherValid),
      ],
    }

    const catalog = await createCardCatalog(fakeSource)
    const all = catalog.all()
    expect(all.length).toBe(2)
    const names = all.map(c => c.name).sort()
    expect(names).toEqual(['Another Valid Unit', 'Valid Unit'])
  })
})
