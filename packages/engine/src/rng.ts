export function nextRng(state: { seed: number }): { value: number; next: { seed: number } } {
  let t = (state.seed + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, next: { seed: t } };
}

export function nextInt(
  state: { seed: number },
  max: number,
): { value: number; next: { seed: number } } {
  const { value, next } = nextRng(state);
  return { value: Math.floor(value * max), next };
}

export function shuffle<T>(
  arr: readonly T[],
  rng: { seed: number },
): { result: T[]; next: { seed: number } } {
  const result = [...arr];
  let current = rng;
  for (let i = result.length - 1; i > 0; i--) {
    const { value: j, next } = nextInt(current, i + 1);
    current = next;
    const temp = result[i]!;
    result[i] = result[j]!;
    result[j] = temp;
  }
  return { result, next: current };
}
