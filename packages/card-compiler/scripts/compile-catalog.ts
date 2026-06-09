import { createCardCatalog, defaultSnapshotSource } from '@thejokersthief/riftbound-card-catalog'
import { createCompiler } from '../src/compiler.js'
import { fallbackRegistry } from '../src/fallbacks/index.js'
import { writeFile } from 'fs/promises'
import { fileURLToPath } from 'url'

const outputPath = new URL('../../card-catalog/data/compiled-catalog.json', import.meta.url)
const reportPath = new URL('../coverage-report.json', import.meta.url)

const catalog = await createCardCatalog(defaultSnapshotSource)
const compiler = createCompiler(fallbackRegistry)
const result = compiler.compileAll(catalog)

// Build compiled-catalog.json: { cardDefId: EffectProgram }
const compiled: Record<string, unknown> = {}
for (const card of result.cards) {
  if (card.status === 'unparsed') {
    compiled[card.defId] = { type: 'Unparsed' }
  } else {
    compiled[card.defId] = card.program
  }
}

await writeFile(fileURLToPath(outputPath), JSON.stringify(compiled, null, 2))
await writeFile(fileURLToPath(reportPath), JSON.stringify(result.coverageReport, null, 2))

console.log(`Compiled: ${result.coverageReport.total} cards`)
console.log(`  parsed: ${result.coverageReport.parsed}`)
console.log(`  fallback: ${result.coverageReport.fallback}`)
console.log(`  unparsed: ${result.coverageReport.unparsed}`)
console.log(`  parse rate: ${(result.parseRate * 100).toFixed(1)}%`)
console.log(`  round-trip failures: ${result.coverageReport.roundTripFailures.length}`)
