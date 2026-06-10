import { writeFile, readFile } from 'fs/promises'
import { fileURLToPath } from 'url'
import { LiveCardDataSource } from '../src/source.js'
import type { CardDefinition } from '../src/types.js'

const outputPath = new URL('../data/cards.json', import.meta.url)
const outputFile = fileURLToPath(outputPath)

// Load existing snapshot to compute delta
let existingIds = new Set<string>()
try {
  const prev = JSON.parse(await readFile(outputFile, 'utf-8')) as Record<string, unknown>
  existingIds = new Set(Object.keys(prev))
} catch {
  // No existing snapshot — first run
}

console.log('Fetching cards from riftdex...')
const source = new LiveCardDataSource()
const cards = await source.load()

const snapshot: Record<string, CardDefinition> = {}
for (const card of cards) {
  snapshot[card.id] = card
}

const newIds = new Set(Object.keys(snapshot))
const added = [...newIds].filter((id) => !existingIds.has(id))
const removed = [...existingIds].filter((id) => !newIds.has(id))

await writeFile(outputFile, JSON.stringify(snapshot, null, 2))

console.log(`Fetched ${cards.length} cards → ${outputFile}`)
if (added.length) console.log(`  Added:   ${added.length} (${added.slice(0, 5).join(', ')}${added.length > 5 ? '...' : ''})`)
if (removed.length) console.log(`  Removed: ${removed.length} (${removed.slice(0, 5).join(', ')}${removed.length > 5 ? '...' : ''})`)
if (!added.length && !removed.length) console.log('  No changes vs previous snapshot')
