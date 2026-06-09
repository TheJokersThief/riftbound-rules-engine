/**
 * Normalize ability text before parsing.
 *
 * Steps:
 * 1. Remove parenthetical reminder text: /\([^)]*\)/g → ''
 * 2. Collapse whitespace: /\s+/g → ' '
 * 3. Trim
 *
 * Preserves :rb_*: tokens and [Keyword] tags as-is.
 */
export function normalize(text: string): string {
  let result = text.replace(/\([^)]*\)/g, '')
  result = result.replace(/\s+/g, ' ')
  // Remove whitespace before sentence-ending punctuation introduced by removing parentheticals
  result = result.replace(/ ([.,;!?])/g, '$1')
  return result.trim()
}
