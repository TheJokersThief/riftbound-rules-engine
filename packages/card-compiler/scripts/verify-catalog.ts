import { readFile } from 'fs/promises'
import { fileURLToPath } from 'url'

const compiledPath = new URL('../../card-catalog/data/compiled-catalog.json', import.meta.url)
const cardsPath = new URL('../../card-catalog/data/cards.json', import.meta.url)
const configPath = new URL('../compiler.config.json', import.meta.url)

const configRaw = JSON.parse(await readFile(fileURLToPath(configPath), 'utf-8')) as { parseRateThreshold: number }
const compiled = JSON.parse(await readFile(fileURLToPath(compiledPath), 'utf-8')) as Record<string, { type: string }>
const cards = JSON.parse(await readFile(fileURLToPath(cardsPath), 'utf-8')) as Record<string, unknown>

const cardIds = Object.keys(cards)
const compiledIds = Object.keys(compiled)

// Every card has an entry
const missing = cardIds.filter((id) => !compiledIds.includes(id))
if (missing.length > 0) {
  console.error(`Missing compiled entries for: ${missing.join(', ')}`)
  process.exit(1)
}

// Parse rate
const parsedCount = compiledIds.filter((id) => compiled[id]?.type === 'Compiled').length
const unparsedCount = compiledIds.filter((id) => compiled[id]?.type === 'Unparsed').length
const parseRate = parsedCount + unparsedCount === 0 ? 1 : parsedCount / (parsedCount + unparsedCount)

const threshold = configRaw.parseRateThreshold
if (parseRate < threshold) {
  console.error(
    `Parse rate ${(parseRate * 100).toFixed(1)}% is below threshold ${(threshold * 100).toFixed(1)}%`,
  )
  process.exit(1)
}

console.log(
  `verify-catalog: OK (parse rate ${(parseRate * 100).toFixed(1)}%, threshold ${(threshold * 100).toFixed(1)}%)`,
)
