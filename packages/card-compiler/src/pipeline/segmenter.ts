/**
 * Split normalized ability text into individual sentences (segments).
 *
 * Splits on '. ' (period+space) or '.' at end of string, but NOT inside [...] tags.
 * Returns non-empty trimmed segments.
 */
export function segment(text: string): string[] {
  if (!text) return []

  // Tokenize: split into runs of [bracket-content] and non-bracket content
  // We replace periods that are outside brackets with a sentinel, then split
  const sentinel = '\x00'

  // Walk the string character by character to find split points outside brackets
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
      // Check if followed by space or at end
      const next = text[i + 1]
      if (next === ' ' || i === text.length - 1) {
        result += sentinel
        // Skip the trailing space if present
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
