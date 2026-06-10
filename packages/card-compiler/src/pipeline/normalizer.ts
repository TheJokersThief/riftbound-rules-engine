/**
 * Normalize ability text before parsing.
 *
 * Steps:
 * 1. Newlines (from HTML <br>) act as sentence separators → convert to ". "
 * 2. Deduplicate ".." that arises when a line already ended with "."
 * 3. Remove parenthetical reminder text: /\([^)]*\)/g → ''
 * 4. Collapse whitespace: /\s+/g → ' '
 * 5. Trim
 *
 * Preserves :rb_*: tokens and [Keyword] tags as-is.
 */
export function normalize(text: string): string {
  let result = text.replace(/\n/g, '. ')
  result = result.replace(/\.(\s*\.)+/g, '.')
  result = result.replace(/\([^)]*\)/g, '')
  result = result.replace(/\s+/g, ' ')
  // Remove whitespace before sentence-ending punctuation introduced by removing parentheticals
  result = result.replace(/ ([.,;!?])/g, '$1')
  return result.trim()
}
