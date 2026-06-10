export function normalize(text: string): string {
  let result = text.replace(/\n/g, ". ");
  result = result.replace(/\.(\s*\.)+/g, ".");
  result = result.replace(/\([^)]*\)/g, "");
  result = result.replace(/\s+/g, " ");
  // Remove whitespace before sentence-ending punctuation introduced by removing parentheticals
  result = result.replace(/ ([.,;!?])/g, "$1");
  return result.trim();
}
