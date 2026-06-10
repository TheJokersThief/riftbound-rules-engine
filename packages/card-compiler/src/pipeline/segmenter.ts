export function segment(text: string): string[] {
  if (!text) return []

  const sentinel = '\x00'

  let depth = 0
  let result = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '[') {
      depth++
      result += ch
    } else if (ch === ']') {
      depth = Math.max(0, depth - 1)
      result += ch
    } else if (ch === '.' && depth === 0) {
      const next = text[i + 1]
      if (next === ' ' || i === text.length - 1) {
        result += sentinel
        if (next === ' ') i++
      } else {
        result += ch
      }
    } else {
      result += ch
    }
  }

  return result
    .split(sentinel)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}
