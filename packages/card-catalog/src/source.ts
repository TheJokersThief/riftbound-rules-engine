import { readFile } from 'fs/promises'
import { CardDefinition, CardSnapshotSchema } from './types.js'

export interface CardDataSource {
  load(): Promise<CardDefinition[]>
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
