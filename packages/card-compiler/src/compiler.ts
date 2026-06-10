import type { CardCatalog, CardDefinition } from '@thejokersthief/riftbound-card-catalog'
import type { EffectProgram } from '@thejokersthief/riftbound-effect-ir'
import type { CardDefId } from '@thejokersthief/riftbound-protocol'
import { decompile } from './decompiler.js'
import type { FallbackRegistry } from './fallbacks/index.js'
import { normalize } from './pipeline/normalizer.js'
import { ParseError, parse } from './pipeline/parser.js'
import { segment } from './pipeline/segmenter.js'
import { ValidationError, validate } from './pipeline/validator.js'

export type CompiledCard =
  | { status: 'parsed'; defId: CardDefId; program: EffectProgram }
  | { status: 'fallback'; defId: CardDefId; program: EffectProgram }
  | { status: 'unparsed'; defId: CardDefId }

export type RoundTripFailure = {
  defId: CardDefId
  original: string
  decompiled: string
}

export type CoverageReport = {
  total: number
  parsed: number
  fallback: number
  unparsed: number
  unparsedIds: CardDefId[]
  roundTripFailures: RoundTripFailure[]
}

export type CompilationResult = {
  cards: CompiledCard[]
  parseRate: number
  coverageReport: CoverageReport
}

export interface Compiler {
  compile(def: CardDefinition): CompiledCard
  compileAll(catalog: CardCatalog): CompilationResult
  decompile(program: EffectProgram): string
}

export function createCompiler(fallbacks: FallbackRegistry): Compiler {
  function compile(def: CardDefinition): CompiledCard {
    const normalized = normalize(def.abilityText)
    if (normalized === '') {
      return { status: 'parsed', defId: def.id, program: { type: 'Compiled', abilities: [] } }
    }

    try {
      const segmented = segment(normalized)
      const abilities = parse(segmented)
      const validated = validate(abilities)
      const program: EffectProgram = { type: 'Compiled', abilities: validated }
      return { status: 'parsed', defId: def.id, program }
    } catch (err) {
      if (err instanceof ParseError || err instanceof ValidationError) {
        const fallback = fallbacks.get(def.id)
        if (fallback !== null) {
          return { status: 'fallback', defId: def.id, program: fallback }
        }
        return { status: 'unparsed', defId: def.id }
      }
      throw err
    }
  }

  function compileAll(catalog: CardCatalog): CompilationResult {
    const defs = catalog.all()
    const cards: CompiledCard[] = defs.map((def) => compile(def))

    // Round-trip check for parsed cards
    const roundTripFailures: RoundTripFailure[] = []
    for (const card of cards) {
      if (card.status === 'parsed') {
        const originalDef = defs.find((d) => d.id === card.defId)
        if (originalDef !== undefined) {
          const originalNormalized = normalize(originalDef.abilityText)
          const decompiled = decompile(card.program)
          const decompilNormalized = normalize(decompiled)
          if (originalNormalized !== decompilNormalized) {
            roundTripFailures.push({
              defId: card.defId,
              original: originalNormalized,
              decompiled: decompilNormalized,
            })
          }
        }
      }
    }

    const parsedCount = cards.filter((c) => c.status === 'parsed').length
    const fallbackCount = cards.filter((c) => c.status === 'fallback').length
    const unparsedCount = cards.filter((c) => c.status === 'unparsed').length

    const denominator = parsedCount + unparsedCount
    const parseRate = denominator === 0 ? 1 : parsedCount / denominator

    const unparsedIds = cards
      .filter((c): c is Extract<CompiledCard, { status: 'unparsed' }> => c.status === 'unparsed')
      .map((c) => c.defId)

    const coverageReport: CoverageReport = {
      total: cards.length,
      parsed: parsedCount,
      fallback: fallbackCount,
      unparsed: unparsedCount,
      unparsedIds,
      roundTripFailures,
    }

    return {
      cards,
      parseRate,
      coverageReport,
    }
  }

  return {
    compile,
    compileAll,
    decompile,
  }
}
