import type { EffectProgram, AbilityNode, EffectNode } from '@thejokersthief/riftbound-effect-ir'

export function decompile(program: EffectProgram): string {
  if (program.type === 'Unparsed') return ''
  return program.abilities.map(decompileAbility).join('. ')
}

function decompileAbility(node: AbilityNode): string {
  switch (node.type) {
    case 'Triggered':
      return `When triggered, ${decompileEffect(node.effect)}`
    case 'Activated':
      return `Activated: ${decompileEffect(node.effect)}`
    case 'Static':
      return '[Static effect]'
  }
}

function decompileEffect(node: EffectNode): string {
  switch (node.type) {
    case 'Draw': {
      const count = typeof node.count === 'number' ? node.count : 1
      return `draw ${count} card${count === 1 ? '' : 's'}`
    }
    case 'Deal': {
      const amount = typeof node.amount === 'number' ? node.amount : 0
      return `deal ${amount} damage`
    }
    case 'Sequence':
      return node.effects.map(decompileEffect).join(', then ')
    case 'Optional':
      return `optionally ${decompileEffect(node.effect)}`
    case 'ChooseOne':
      return `choose one: ${node.options.map(decompileEffect).join(' or ')}`
    case 'Conditional': {
      const base = `if condition, ${decompileEffect(node.then)}`
      return node.else !== undefined ? `${base}, else ${decompileEffect(node.else)}` : base
    }
    case 'ForEach':
      return `for each, ${decompileEffect(node.effect)}`
    default:
      return node.type.toLowerCase()
  }
}
