import { describe, it, expect } from 'vitest'
import { normalize } from './pipeline/normalizer.js'
import { segment } from './pipeline/segmenter.js'
import { parse, ParseError } from './pipeline/parser.js'
import { createCompiler } from './compiler.js'
import { decompile } from './decompiler.js'
import type { FallbackRegistry } from './fallbacks/index.js'
import type { CardDefinition, CardCatalog } from '@thejokersthief/riftbound-card-catalog'
import type { CardDefId } from '@thejokersthief/riftbound-protocol'
import type { EffectProgram } from '@thejokersthief/riftbound-effect-ir'

// ---------------------------------------------------------------------------
// normalizer
// ---------------------------------------------------------------------------

describe('normalize', () => {
  it('strips parenthetical reminder text', () => {
    expect(normalize('Deal 2 damage (to any target).')).toBe('Deal 2 damage.')
  })

  it('preserves :rb_action: tokens', () => {
    expect(normalize(':rb_action: Draw a card.')).toBe(':rb_action: Draw a card.')
  })

  it('collapses extra whitespace', () => {
    expect(normalize('Draw  a   card.')).toBe('Draw a card.')
  })

  it('trims leading and trailing whitespace', () => {
    expect(normalize('  Deal damage.  ')).toBe('Deal damage.')
  })
})

// ---------------------------------------------------------------------------
// segmenter
// ---------------------------------------------------------------------------

describe('segment', () => {
  it('splits on ". " correctly', () => {
    const result = segment('Draw a card. Deal 2 damage.')
    expect(result).toEqual(['Draw a card', 'Deal 2 damage'])
  })

  it('handles a single sentence with no split', () => {
    const result = segment('Draw a card.')
    expect(result).toEqual(['Draw a card'])
  })

  it('handles sentence without trailing period', () => {
    const result = segment('Draw a card')
    expect(result).toEqual(['Draw a card'])
  })

  it('returns empty array for empty string', () => {
    expect(segment('')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// parser
// ---------------------------------------------------------------------------

describe('parse', () => {
  it('throws ParseError for unrecognized text', () => {
    expect(() => parse(['Draw 2 cards'])).toThrow(ParseError)
  })

  it('throws ParseError for empty segments', () => {
    expect(() => parse([])).toThrow(ParseError)
  })
})

// ---------------------------------------------------------------------------
// compiler
// ---------------------------------------------------------------------------

function makeCardDef(overrides: Partial<CardDefinition> = {}): CardDefinition {
  return {
    id: 'test001' as CardDefId,
    name: 'Test Card',
    cardType: 'Unit',
    set: 'core',
    rarity: null,
    abilityText: 'When played, draw 2 cards.',
    might: 2,
    playCost: { energy: 1, power: 0, runes: [] },
    deckZone: 'Main',
    keywords: [],
    ...overrides,
  }
}

function makeCatalog(cards: CardDefinition[]): CardCatalog {
  return {
    get(id: CardDefId) {
      const card = cards.find((c) => c.id === id)
      if (!card) throw new Error(`Unknown card: ${id}`)
      return card
    },
    find(id: CardDefId) {
      return cards.find((c) => c.id === id) ?? null
    },
    all() {
      return cards
    },
  }
}

describe('compile', () => {
  it('returns { status: "unparsed" } for a card with empty ability text', () => {
    const compiler = createCompiler({ get: () => null })
    const def = makeCardDef({ abilityText: '' })
    const result = compiler.compile(def)
    expect(result.status).toBe('unparsed')
  })

  it('returns { status: "unparsed" } for a card with complex ability text (parser always throws)', () => {
    const compiler = createCompiler({ get: () => null })
    const def = makeCardDef({ abilityText: 'Your Units gain +1 might while this is in play.' })
    const result = compiler.compile(def)
    expect(result.status).toBe('unparsed')
  })

  it('returns { status: "fallback" } when a fallback is registered for the card', () => {
    const fallbackProgram: EffectProgram = { type: 'Unparsed' }
    const testFallback: FallbackRegistry = {
      get: (id) => (id === 'test001' ? fallbackProgram : null),
    }
    const compiler = createCompiler(testFallback)
    const def = makeCardDef({
      id: 'test001' as CardDefId,
      abilityText: 'Complex ability that parser cannot handle.',
    })
    const result = compiler.compile(def)
    expect(result.status).toBe('fallback')
    if (result.status === 'fallback') {
      expect(result.program).toBe(fallbackProgram)
    }
  })
})

describe('compileAll', () => {
  it('produces a valid CompilationResult from a 2-card fixture catalog', () => {
    const compiler = createCompiler({ get: () => null })

    const cards: CardDefinition[] = [
      makeCardDef({
        id: 'card001' as CardDefId,
        abilityText: 'When played, draw a card.',
      }),
      makeCardDef({
        id: 'card002' as CardDefId,
        abilityText: '',
      }),
    ]

    const catalog = makeCatalog(cards)
    const result = compiler.compileAll(catalog)

    expect(result.coverageReport.total).toBe(2)
    expect(result.coverageReport.unparsed).toBe(2) // parser always throws + empty
    expect(result.coverageReport.parsed).toBe(0)
    expect(result.coverageReport.fallback).toBe(0)
    expect(result.parseRate).toBe(0) // 0 parsed / (0 parsed + 2 unparsed)
    expect(result.cards).toHaveLength(2)
    expect(result.coverageReport.roundTripFailures).toHaveLength(0) // no parsed cards
  })
})

// ---------------------------------------------------------------------------
// decompiler
// ---------------------------------------------------------------------------

describe('decompile', () => {
  it('returns empty string for Unparsed program', () => {
    expect(decompile({ type: 'Unparsed' })).toBe('')
  })

  it('returns joined ability strings for Compiled program', () => {
    const program: EffectProgram = {
      type: 'Compiled',
      abilities: [
        {
          type: 'Triggered',
          event: { type: 'WhenPlayed' },
          effect: {
            type: 'Draw',
            player: 'You',
            count: 2,
          },
        },
      ],
    }
    const result = decompile(program)
    expect(result).toContain('draw 2 cards')
  })
})
