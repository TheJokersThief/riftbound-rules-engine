import { readFile } from 'fs/promises'
import type { CardDefId } from '@thejokersthief/riftbound-protocol'
import { CardDefinition, CardSnapshotSchema, CardType, DeckZone } from './types.js'

export interface CardDataSource {
  load(): Promise<CardDefinition[]>
}

// ---------------------------------------------------------------------------
// Raw API shape from https://riftdex.gg/api/v1/cards
// ---------------------------------------------------------------------------

interface RiftdexCard {
  id: string
  name: string
  cardType: string
  setId: string
  rarityName: string | null
  energyCost: number | null
  power: number | null
  might: number | null
  abilityHtml: string | null
  abilityText: string | null
  tags: string[]
}

interface RiftdexResponse {
  data: RiftdexCard[]
  pagination: { page: number; limit: number; total: number; totalPages: number }
}

function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/:rb_energy_(\d+):/g, '[E$1]')
    .replace(/:rb_exhaust:/g, '[EXHAUST]')
    .replace(/:rb_might:/g, '[MIGHT]')
    .replace(/:rb_rune_([a-z]+):/g, '[RUNE:$1]')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
    .trim()
}

const API_CARD_TYPE_MAP: Record<string, CardType> = {
  unit: 'Unit',
  gear: 'Gear',
  spell: 'Spell',
  legend: 'Legend',
  champion: 'ChosenChampion',
  battlefield: 'Battlefield',
  rune: 'Rune',
}

const DECK_ZONE_MAP: Record<CardType, DeckZone> = {
  Unit: 'Main',
  Gear: 'Main',
  Spell: 'Main',
  Legend: 'Legend',
  ChosenChampion: 'Champion',
  Battlefield: 'Battlefield',
  Rune: 'Rune',
}

function normalizeCard(raw: RiftdexCard): CardDefinition | null {
  const cardType = API_CARD_TYPE_MAP[raw.cardType.toLowerCase()]
  if (!cardType) return null

  const abilityText = raw.abilityHtml
    ? htmlToPlainText(raw.abilityHtml)
    : (raw.abilityText ?? '')

  return {
    id: raw.id as CardDefId,
    name: raw.name,
    cardType,
    set: raw.setId,
    rarity: raw.rarityName,
    abilityText,
    might: raw.might,
    playCost:
      raw.energyCost !== null
        ? { energy: raw.energyCost, power: raw.power ?? 0, runes: [] }
        : null,
    deckZone: DECK_ZONE_MAP[cardType],
    keywords: raw.tags ?? [],
  }
}

// ---------------------------------------------------------------------------
// LiveCardDataSource — fetches all pages from the riftdex endpoint
// ---------------------------------------------------------------------------

export class LiveCardDataSource implements CardDataSource {
  private readonly endpoint: string

  constructor(endpoint = 'https://riftdex.gg/api/v1/cards') {
    this.endpoint = endpoint
  }

  async load(): Promise<CardDefinition[]> {
    const cards: CardDefinition[] = []
    let page = 1
    let totalPages = 1

    while (page <= totalPages) {
      const url = `${this.endpoint}?limit=100&page=${page}`
      const resp = await fetch(url)
      if (!resp.ok) throw new Error(`Riftdex API responded ${resp.status} for page ${page}`)
      const body = (await resp.json()) as RiftdexResponse
      totalPages = body.pagination.totalPages
      for (const raw of body.data) {
        const def = normalizeCard(raw)
        if (def) cards.push(def)
      }
      page++
    }

    return cards
  }
}

export class SnapshotCardDataSource implements CardDataSource {
  constructor(private readonly snapshotPath: string) {}

  async load(): Promise<CardDefinition[]> {
    const raw = await readFile(this.snapshotPath, 'utf-8')
    const parsed = JSON.parse(raw) as unknown
    const result = CardSnapshotSchema.safeParse(parsed)
    if (!result.success) {
      throw new Error(`Failed to parse card snapshot: ${result.error.message}`)
    }
    return Object.values(result.data).filter((v): v is CardDefinition => v !== undefined)
  }
}

export const defaultSnapshotSource = new SnapshotCardDataSource(
  new URL('../data/cards.json', import.meta.url).pathname,
)
