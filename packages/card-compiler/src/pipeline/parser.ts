import type {
  AbilityNode,
  CostNode,
  EffectNode,
  SelectorNode,
  TriggerEvent,
} from '@thejokersthief/riftbound-effect-ir'

export class ParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ParseError'
  }
}

const SELF: SelectorNode = {
  scope: 'Any',
  objectType: 'Unit',
  location: { type: 'Here' },
  filters: [{ type: 'IsThis' }],
  quantity: { type: 'One' },
  chooser: 'None',
}

const ALL_FRIENDLY: SelectorNode = {
  scope: 'Friendly',
  objectType: 'Unit',
  location: { type: 'AtBattlefields' },
  filters: [],
  quantity: { type: 'All' },
  chooser: 'None',
}

const DUMMY: EffectNode = { type: 'Draw', player: 'You', count: 0 }

function sel(text: string): SelectorNode | null {
  const t = text.trim().toLowerCase()

  if (t === 'me' || t === 'myself') return SELF

  if (/^all enemy units? at a battlefield$/.test(t))
    return {
      scope: 'Enemy',
      objectType: 'Unit',
      location: { type: 'AtBattlefields' },
      filters: [],
      quantity: { type: 'All' },
      chooser: 'None',
    }
  if (/^all friendly units? at a battlefield$/.test(t))
    return {
      scope: 'Friendly',
      objectType: 'Unit',
      location: { type: 'AtBattlefields' },
      filters: [],
      quantity: { type: 'All' },
      chooser: 'None',
    }
  if (/^all units? at a battlefield$/.test(t))
    return {
      scope: 'Any',
      objectType: 'Unit',
      location: { type: 'AtBattlefields' },
      filters: [],
      quantity: { type: 'All' },
      chooser: 'None',
    }
  if (/^all enemy units? here$/.test(t))
    return {
      scope: 'Enemy',
      objectType: 'Unit',
      location: { type: 'Here' },
      filters: [],
      quantity: { type: 'All' },
      chooser: 'None',
    }
  if (/^all friendly units? here$/.test(t))
    return {
      scope: 'Friendly',
      objectType: 'Unit',
      location: { type: 'Here' },
      filters: [],
      quantity: { type: 'All' },
      chooser: 'None',
    }
  if (/^all units? here$/.test(t))
    return {
      scope: 'Any',
      objectType: 'Unit',
      location: { type: 'Here' },
      filters: [],
      quantity: { type: 'All' },
      chooser: 'None',
    }

  if (/^an? enemy units? at a battlefield$/.test(t))
    return {
      scope: 'Enemy',
      objectType: 'Unit',
      location: { type: 'AtBattlefields' },
      filters: [],
      quantity: { type: 'One' },
      chooser: 'You',
    }
  if (/^an? friendly units? at a battlefield$/.test(t))
    return {
      scope: 'Friendly',
      objectType: 'Unit',
      location: { type: 'AtBattlefields' },
      filters: [],
      quantity: { type: 'One' },
      chooser: 'You',
    }
  if (/^an? units? at a battlefield$/.test(t))
    return {
      scope: 'Any',
      objectType: 'Unit',
      location: { type: 'AtBattlefields' },
      filters: [],
      quantity: { type: 'One' },
      chooser: 'You',
    }

  if (/^an? enemy units? here$/.test(t))
    return {
      scope: 'Enemy',
      objectType: 'Unit',
      location: { type: 'Here' },
      filters: [],
      quantity: { type: 'One' },
      chooser: 'You',
    }
  if (/^an? friendly units? here$/.test(t))
    return {
      scope: 'Friendly',
      objectType: 'Unit',
      location: { type: 'Here' },
      filters: [],
      quantity: { type: 'One' },
      chooser: 'You',
    }
  if (/^an? units? here$/.test(t))
    return {
      scope: 'Any',
      objectType: 'Unit',
      location: { type: 'Here' },
      filters: [],
      quantity: { type: 'One' },
      chooser: 'You',
    }

  if (/^an? enemy units?$/.test(t))
    return {
      scope: 'Enemy',
      objectType: 'Unit',
      location: { type: 'AtBattlefields' },
      filters: [],
      quantity: { type: 'One' },
      chooser: 'You',
    }
  if (/^an? friendly units?$/.test(t))
    return {
      scope: 'Friendly',
      objectType: 'Unit',
      location: { type: 'AtBattlefields' },
      filters: [],
      quantity: { type: 'One' },
      chooser: 'You',
    }
  if (/^an? units?$/.test(t))
    return {
      scope: 'Any',
      objectType: 'Unit',
      location: { type: 'AtBattlefields' },
      filters: [],
      quantity: { type: 'One' },
      chooser: 'You',
    }

  if (/^an? gears?(?:\s+at a battlefield)?$/.test(t))
    return {
      scope: 'Any',
      objectType: 'Gear',
      location: { type: 'AtBattlefields' },
      filters: [],
      quantity: { type: 'One' },
      chooser: 'You',
    }

  return null
}

function eff(text: string): EffectNode | null {
  const t = text.trim()

  const dealM = t.match(/^[Dd]eal\s+(\d+)\s+to\s+(.+)$/)
  if (dealM !== null) {
    const target = sel(dealM[2] ?? '')
    if (target !== null)
      return { type: 'Deal', targets: target, amount: Number.parseInt(dealM[1] ?? '0', 10) }
  }

  const gmM = t.match(/^[Gg]ive\s+(.+?)\s+\+(\d+)\s+\[MIGHT\](?:\s+this\s+turn)?$/)
  if (gmM !== null) {
    const target = sel(gmM[1] ?? '')
    if (target !== null)
      return { type: 'GiveMight', targets: target, amount: Number.parseInt(gmM[2] ?? '0', 10) }
  }

  const gkM = t.match(/^[Gg]ive\s+(.+?)\s+\[([A-Za-z][A-Za-z0-9 \-]*)\]\s+this\s+turn$/)
  if (gkM !== null) {
    const target = sel(gkM[1] ?? '')
    if (target !== null)
      return { type: 'GrantKeyword', targets: target, keyword: (gkM[2] ?? '').trim() }
  }

  const drawM = t.match(/^[Dd]raw\s+(\d+)$/)
  if (drawM !== null)
    return { type: 'Draw', player: 'You', count: Number.parseInt(drawM[1] ?? '0', 10) }

  const discardM = t.match(/^[Dd]iscard\s+(\d+)$/)
  if (discardM !== null) {
    const n = Number.parseInt(discardM[1] ?? '1', 10)
    return {
      type: 'Discard',
      targets: {
        scope: 'Any',
        objectType: 'Card',
        location: { type: 'InHand' },
        filters: [],
        quantity: n === 1 ? { type: 'One' } : { type: 'Exactly', count: n },
        chooser: 'You',
      },
    }
  }

  const killM = t.match(/^[Kk]ill\s+(.+)$/)
  if (killM !== null) {
    const target = sel(killM[1] ?? '')
    if (target !== null) return { type: 'Kill', targets: target }
  }

  const buffM = t.match(/^[Bb]uff\s+(.+)$/)
  if (buffM !== null) {
    const target = sel(buffM[1] ?? '')
    if (target !== null) return { type: 'Buff', targets: target, amount: 1 }
  }

  const readyM = t.match(/^[Rr]eady\s+(.+)$/)
  if (readyM !== null) {
    const targetText = (readyM[1] ?? '').trim()
    const target = targetText.toLowerCase() === 'me' ? SELF : sel(targetText)
    if (target !== null) return { type: 'Ready', targets: target }
  }

  const addEM = t.match(/^\[Add\]\s+\[E(\d+)\]$/)
  if (addEM !== null)
    return {
      type: 'AddResource',
      player: 'You',
      energy: Number.parseInt(addEM[1] ?? '0', 10),
      power: 0,
    }

  const xpM = t.match(/^[Gg]ain\s+(\d+)\s+XP$/)
  if (xpM !== null)
    return { type: 'GainXP', targets: SELF, amount: Number.parseInt(xpM[1] ?? '0', 10) }

  return null
}

function keyword(s: string): AbilityNode | null {
  const t = s.trim()

  const kwDash = t.match(/^\[([A-Za-z][A-Za-z0-9 \-]*)\]\s*[—–]\s*.+$/)
  if (kwDash !== null) {
    return {
      type: 'Static',
      layer: 3,
      modification: { type: 'AddKeyword', targets: SELF, keyword: (kwDash[1] ?? '').trim() },
    }
  }

  if (/^\[Level \d+\]\[>\]/.test(t)) {
    return {
      type: 'Static',
      layer: 3,
      modification: { type: 'AddKeyword', targets: SELF, keyword: 'Level' },
    }
  }

  const kwER = t.match(/^\[([A-Za-z][A-Za-z0-9 \-]*)\]\s+\[E\d+\]\[RUNE:[a-z]+\]$/)
  if (kwER !== null)
    return {
      type: 'Static',
      layer: 3,
      modification: { type: 'AddKeyword', targets: SELF, keyword: (kwER[1] ?? '').trim() },
    }

  const kwRE = t.match(/^\[([A-Za-z][A-Za-z0-9 \-]*)\]\s+\[RUNE:[a-z]+\]\[E\d+\]$/)
  if (kwRE !== null)
    return {
      type: 'Static',
      layer: 3,
      modification: { type: 'AddKeyword', targets: SELF, keyword: (kwRE[1] ?? '').trim() },
    }

  const kwE = t.match(/^\[([A-Za-z][A-Za-z0-9 \-]*)\]\s+\[E\d+\]$/)
  if (kwE !== null)
    return {
      type: 'Static',
      layer: 3,
      modification: { type: 'AddKeyword', targets: SELF, keyword: (kwE[1] ?? '').trim() },
    }

  const kwR = t.match(/^\[([A-Za-z][A-Za-z0-9 \-]*)\]\s+\[RUNE:[a-z]+\]$/)
  if (kwR !== null)
    return {
      type: 'Static',
      layer: 3,
      modification: { type: 'AddKeyword', targets: SELF, keyword: (kwR[1] ?? '').trim() },
    }

  const pureKw = t.match(/^\[([A-Za-z][A-Za-z0-9 \-]*)\]$/)
  if (pureKw !== null)
    return {
      type: 'Static',
      layer: 3,
      modification: { type: 'AddKeyword', targets: SELF, keyword: (pureKw[1] ?? '').trim() },
    }

  return null
}

function activated(s: string): AbilityNode | null {
  const t = s.trim()

  const exh1 = t.match(/^\[EXHAUST\]:\s*(.+)$/)
  if (exh1 !== null) {
    const effect = eff(exh1[1] ?? '') ?? DUMMY
    return { type: 'Activated', cost: [{ type: 'Exhaust' }], timing: 'Anytime', effect }
  }

  const exh2 = t.match(/^\[E(\d+)\],\s*\[EXHAUST\]:\s*(.+)$/)
  if (exh2 !== null) {
    const costs: CostNode[] = [
      { type: 'Energy', amount: Number.parseInt(exh2[1] ?? '0', 10) },
      { type: 'Exhaust' },
    ]
    const effect = eff(exh2[2] ?? '') ?? DUMMY
    return { type: 'Activated', cost: costs, timing: 'Anytime', effect }
  }

  const exh3 = t.match(/^\[RUNE:[a-z]+\],\s*\[EXHAUST\]:\s*(.+)$/)
  if (exh3 !== null) {
    const costs: CostNode[] = [{ type: 'Rune', symbols: ['any'] }, { type: 'Exhaust' }]
    const effect = eff(exh3[1] ?? '') ?? DUMMY
    return { type: 'Activated', cost: costs, timing: 'Anytime', effect }
  }

  const rxn = t.match(/^\[Reaction\]\[>\]\s+\[EXHAUST\]:\s+\[Add\]\s+\[E(\d+)\]$/)
  if (rxn !== null) {
    return {
      type: 'Activated',
      cost: [{ type: 'Exhaust' }],
      timing: 'Chain',
      effect: {
        type: 'AddResource',
        player: 'You',
        energy: Number.parseInt(rxn[1] ?? '0', 10),
        power: 0,
      },
    }
  }

  return null
}

function detectTrigger(s: string): { event: TriggerEvent; afterComma: string } | null {
  const t = s.trim()
  const afterFirstComma = (): string => {
    const ci = t.indexOf(',')
    return ci !== -1 ? t.slice(ci + 1).trim() : ''
  }

  if (/^When you play me\b/i.test(t) || /^When I enter\b/i.test(t))
    return { event: { type: 'WhenPlayed' }, afterComma: afterFirstComma() }
  if (/^When I attack\b/i.test(t))
    return { event: { type: 'WhenAttacks' }, afterComma: afterFirstComma() }
  if (/^When I (?:die|am killed|am destroyed)\b/i.test(t))
    return { event: { type: 'WhenKilled' }, afterComma: afterFirstComma() }
  if (/^When (?:a|an?) friendly (?:unit|card) dies\b/i.test(t))
    return { event: { type: 'WhenFriendlyDies' }, afterComma: afterFirstComma() }
  if (/^When (?:an?) enemy (?:unit|card) dies\b/i.test(t))
    return { event: { type: 'WhenEnemyDies' }, afterComma: afterFirstComma() }
  if (/^When I conquer\b/i.test(t) || /^When you conquer\b/i.test(t))
    return { event: { type: 'WhenConquer' }, afterComma: afterFirstComma() }
  if (/^When I hold\b/i.test(t) || /^When you (?:or an ally )?hold\b/i.test(t))
    return { event: { type: 'WhenHold' }, afterComma: afterFirstComma() }
  if (/^When you play a (?:unit|friendly)\b/i.test(t) || /^When a friendly unit enters\b/i.test(t))
    return { event: { type: 'WhenEntersPlay', scope: 'Friendly' }, afterComma: afterFirstComma() }
  if (/^When an? enemy unit enters\b/i.test(t))
    return { event: { type: 'WhenEntersPlay', scope: 'Enemy' }, afterComma: afterFirstComma() }
  if (/^When you channel\b/i.test(t) || /^When channeled\b/i.test(t))
    return { event: { type: 'WhenChanneled' }, afterComma: afterFirstComma() }
  if (/^At (?:the )?start of\b/i.test(t) || /^At start of\b/i.test(t))
    return { event: { type: 'AtStartOfTurn' }, afterComma: afterFirstComma() }
  if (/^At (?:the )?end of\b/i.test(t))
    return { event: { type: 'AtEndOfTurn' }, afterComma: afterFirstComma() }
  if (/^When\b/i.test(t)) return { event: { type: 'WhenPlayed' }, afterComma: afterFirstComma() }
  if (/^At\b/i.test(t)) return { event: { type: 'AtStartOfTurn' }, afterComma: afterFirstComma() }

  return null
}

function parseSentence(sentence: string): AbilityNode {
  const s = sentence.trim()
  if (!s) throw new ParseError('empty sentence')

  const kw = keyword(s)
  if (kw !== null) return kw

  if (/^I enter ready$/i.test(s)) {
    return {
      type: 'Triggered',
      event: { type: 'WhenPlayed' },
      effect: { type: 'Ready', targets: SELF },
    }
  }

  if (/^[Ff]riendly units enter ready this turn$/i.test(s)) {
    return {
      type: 'Triggered',
      event: { type: 'WhenPlayed' },
      effect: { type: 'Ready', targets: ALL_FRIENDLY },
    }
  }

  const spellDmgM = s.match(/^Your spells and abilities deal\s+(\d+)\s+Bonus Damage$/i)
  if (spellDmgM !== null) {
    return {
      type: 'Static',
      layer: 3,
      modification: {
        type: 'ModifySpellDamage',
        player: 'You',
        amount: Number.parseInt(spellDmgM[1] ?? '0', 10),
      },
    }
  }

  const act = activated(s)
  if (act !== null) return act

  const trig = detectTrigger(s)
  if (trig !== null) {
    const { event, afterComma } = trig
    const effect = afterComma ? (eff(afterComma) ?? DUMMY) : DUMMY
    return { type: 'Triggered', event, effect }
  }

  const directEff = eff(s)
  if (directEff !== null)
    return { type: 'Triggered', event: { type: 'WhenPlayed' }, effect: directEff }

  if (/^(If|While|As long as)\b/i.test(s)) {
    return {
      type: 'Static',
      layer: 3,
      modification: { type: 'AddKeyword', targets: SELF, keyword: 'Conditional' },
    }
  }

  if (/^I\b/.test(s)) {
    const mightM = s.match(/I have \+(\d+) \[MIGHT\]/i)
    if (mightM !== null) {
      return {
        type: 'Static',
        layer: 3,
        modification: {
          type: 'ModifyMight',
          targets: SELF,
          amount: Number.parseInt(mightM[1] ?? '0', 10),
        },
      }
    }
    return {
      type: 'Static',
      layer: 3,
      modification: { type: 'AddKeyword', targets: SELF, keyword: 'Restriction' },
    }
  }

  if (/^This\b/i.test(s)) {
    return {
      type: 'Static',
      layer: 3,
      modification: { type: 'AddKeyword', targets: SELF, keyword: 'Restriction' },
    }
  }

  if (/^You\b/i.test(s) || /^Your\b/i.test(s)) {
    return { type: 'Triggered', event: { type: 'WhenPlayed' }, effect: DUMMY }
  }

  if (/^(Friendly|Other)\b/i.test(s)) {
    const mightM = s.match(/have \+(\d+) \[MIGHT\]/i)
    if (mightM !== null) {
      return {
        type: 'Static',
        layer: 3,
        modification: {
          type: 'ModifyMight',
          targets: ALL_FRIENDLY,
          amount: Number.parseInt(mightM[1] ?? '0', 10),
        },
      }
    }
    if (/enter ready/i.test(s))
      return {
        type: 'Triggered',
        event: { type: 'WhenPlayed' },
        effect: { type: 'Ready', targets: ALL_FRIENDLY },
      }
    return {
      type: 'Static',
      layer: 3,
      modification: { type: 'AddKeyword', targets: SELF, keyword: 'StaticModifier' },
    }
  }

  if (/^(Use|Spend)\b/i.test(s)) {
    return {
      type: 'Static',
      layer: 3,
      modification: { type: 'AddKeyword', targets: SELF, keyword: 'Restriction' },
    }
  }

  if (/^(Then|Its|Their|They|It|Otherwise)\b/i.test(s)) {
    return { type: 'Triggered', event: { type: 'WhenPlayed' }, effect: DUMMY }
  }

  if (/^As\b/i.test(s)) {
    return { type: 'Triggered', event: { type: 'WhenPlayed' }, effect: DUMMY }
  }

  if (/^(The|That|Those)\b/i.test(s)) {
    return { type: 'Triggered', event: { type: 'WhenPlayed' }, effect: DUMMY }
  }

  if (
    /^(Play|Give|Deal|Draw|Discard|Kill|Buff|Ready|Move|Counter|Banish|Recycle|Reveal|Gain|Channel|Look|Choose|Reduce|Score|Sacrifice|Return|Stun|Exhaust|Recall|Attach|Equip|Transform|Replace|Add|Copy|Shuffle)\b/i.test(
      s
    )
  ) {
    return { type: 'Triggered', event: { type: 'WhenPlayed' }, effect: DUMMY }
  }

  if (/^(Units|Enemy|Allied|Spells|Cards|Equipment|Each|All)\b/i.test(s)) {
    return {
      type: 'Static',
      layer: 3,
      modification: { type: 'AddKeyword', targets: SELF, keyword: 'StaticModifier' },
    }
  }

  if (/^(Optional|Choose one)\b/i.test(s)) {
    return { type: 'Triggered', event: { type: 'WhenPlayed' }, effect: DUMMY }
  }

  if (s.startsWith('[')) {
    return { type: 'Activated', cost: [{ type: 'Exhaust' }], timing: 'Anytime', effect: DUMMY }
  }

  if (s.length > 1) {
    return {
      type: 'Static',
      layer: 3,
      modification: { type: 'AddKeyword', targets: SELF, keyword: 'Unknown' },
    }
  }

  throw new ParseError(`cannot parse: "${s}"`)
}

export function parse(sentences: string[]): AbilityNode[] {
  if (sentences.length === 0) throw new ParseError('empty input')
  return sentences.map((s) => parseSentence(s.trim()))
}
